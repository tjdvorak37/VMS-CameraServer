param(
  [ValidateSet('Quick', 'Guided')]
  [string]$Mode = 'Quick',
  [switch]$ConfigureNow,
  [string]$InstallDir = 'V:\VMS-CameraServer',
  [string]$DataDrive = 'V:',
  [string]$ServiceName = 'VMSCameraServer',
  [string]$PublicBaseUrl = '',
  [string]$CorsOrigins = '',
  [string]$AdminUsername = 'admin',
  [string]$AdminEmail = 'admin@vms.local',
  [string]$AdminPassword = '',
  [int]$RetentionDays = 30,
  [int]$MaxCameras = 64,
  [int]$SnapshotInterval = 60,
  [string]$UsersCsvPath = '',
  [switch]$SkipService
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg) { Write-Host "[VMS] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[VMS] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[VMS] $msg" -ForegroundColor Yellow }

function New-RandomSecret([int]$Length = 72) {
  $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  $out = New-Object System.Text.StringBuilder
  1..$Length | ForEach-Object {
    [void]$out.Append($chars[(Get-Random -Minimum 0 -Maximum $chars.Length)])
  }
  $out.ToString()
}

function Ensure-Command($name, $hint) {
  if (-not (Get-Command $name -ErrorAction SilentlyContinue)) {
    throw "$name is required. $hint"
  }
}

function Read-OptionalValue([string]$Label, [string]$DefaultValue) {
  $prompt = if ([string]::IsNullOrWhiteSpace($DefaultValue)) {
    "$Label"
  } else {
    "$Label [$DefaultValue]"
  }

  $value = Read-Host $prompt
  if ([string]::IsNullOrWhiteSpace($value)) {
    return $DefaultValue
  }
  return $value.Trim()
}

function Read-OptionalInt([string]$Label, [int]$DefaultValue, [int]$Min, [int]$Max) {
  while ($true) {
    $candidate = Read-OptionalValue $Label ([string]$DefaultValue)
    $parsed = 0
    if ([int]::TryParse($candidate, [ref]$parsed) -and $parsed -ge $Min -and $parsed -le $Max) {
      return $parsed
    }
    Write-Warn "$Label must be between $Min and $Max"
  }
}

function Read-RequiredSecret([string]$Label) {
  while ($true) {
    $secure = Read-Host $Label -AsSecureString
    $ptr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
      $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringAuto($ptr)
    }
    finally {
      [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
    }

    if (-not [string]::IsNullOrWhiteSpace($plain)) {
      return $plain.Trim()
    }

    Write-Warn "$Label cannot be empty"
  }
}

function Wait-ForHealth([string]$BaseUrl, [int]$TimeoutSec = 90) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  $healthUrl = "$BaseUrl/api/health"

  while ((Get-Date) -lt $deadline) {
    try {
      $res = Invoke-RestMethod -Method Get -Uri $healthUrl -TimeoutSec 5
      if ($res.status -eq 'ok') {
        return $true
      }
    }
    catch {
      Start-Sleep -Seconds 2
    }
  }

  return $false
}

function Invoke-JsonPost([string]$Uri, $Payload, $Headers = @{}) {
  Invoke-RestMethod -Method Post -Uri $Uri -ContentType 'application/json' -Body ($Payload | ConvertTo-Json -Depth 8) -Headers $Headers
}

function Invoke-JsonPut([string]$Uri, $Payload, $Headers = @{}) {
  Invoke-RestMethod -Method Put -Uri $Uri -ContentType 'application/json' -Body ($Payload | ConvertTo-Json -Depth 8) -Headers $Headers
}

function New-ClientOnboardingPackage([string]$InstallPath, [string]$ServerUrl) {
  $onboardingDir = Join-Path $InstallPath 'client-onboarding'
  New-Item -Path $onboardingDir -ItemType Directory -Force | Out-Null

  $desktopInstallerSource = Join-Path $InstallPath 'desktop-client\VMS-Desktop-Client-Setup.exe'
  if (Test-Path $desktopInstallerSource) {
    Copy-Item $desktopInstallerSource (Join-Path $onboardingDir 'VMS-Desktop-Client-Setup.exe') -Force
  } else {
    Write-Warn 'Desktop client installer not found in package. Build desktop-client installer before creating the server bundle for full onboarding output.'
  }

  $clientInstallScriptSource = Join-Path $InstallPath 'installer\windows\install-vms-client.ps1'
  $clientInstallCmdSource = Join-Path $InstallPath 'installer\windows\install-vms-client.cmd'

  if (Test-Path $clientInstallScriptSource) {
    Copy-Item $clientInstallScriptSource (Join-Path $onboardingDir 'install-vms-client.ps1') -Force
  }
  if (Test-Path $clientInstallCmdSource) {
    Copy-Item $clientInstallCmdSource (Join-Path $onboardingDir 'INSTALL-VMS-CLIENT.cmd') -Force
  }

  $serverConfig = @{
    app = 'VMS Desktop Client'
    version = 1
    serverUrl = $ServerUrl
    generatedAt = (Get-Date).ToString('o')
  } | ConvertTo-Json -Depth 5

  Set-Content -Path (Join-Path $onboardingDir 'server-config.json') -Value $serverConfig -Encoding UTF8

  $template = @"
username,email,password,role
operator1,operator1@company.local,ChangeMe123!,operator
viewer1,viewer1@company.local,ChangeMe123!,viewer
"@
  Set-Content -Path (Join-Path $onboardingDir 'users-template.csv') -Value $template -Encoding ASCII

  $readme = @"
VMS Client Onboarding Package

1. Optional: edit users-template.csv and import users from the server installer using -UsersCsvPath.
  1a. If users were imported, temporary passwords are in provisioned-user-credentials.csv and must be rotated at first login.
2. Copy this folder to user devices.
3. On each user device run INSTALL-VMS-CLIENT.cmd.
4. The desktop client opens already pointed to: $ServerUrl

Manual URL fallback:
- Open VMS Desktop Client
- Connection Settings
- Enter: $ServerUrl
"@
  Set-Content -Path (Join-Path $onboardingDir 'README.txt') -Value $readme -Encoding ASCII

  return $onboardingDir
}

function Import-ProvisionUsers([string]$CsvPath, [string]$BaseUrl, [string]$AuthToken, [string]$InstallPath) {
  if ([string]::IsNullOrWhiteSpace($CsvPath)) {
    return @{ created = 0; credentialsPath = '' }
  }

  if (-not (Test-Path $CsvPath)) {
    throw "Users CSV not found: $CsvPath"
  }

  $rows = Import-Csv -Path $CsvPath
  if ($rows.Count -eq 0) {
    return @{ created = 0; credentialsPath = '' }
  }

  $created = 0
  $credentials = @()
  foreach ($row in $rows) {
    $username = [string]$row.username
    $email = [string]$row.email
    $password = [string]$row.password
    $role = [string]$row.role

    if ([string]::IsNullOrWhiteSpace($username) -or [string]::IsNullOrWhiteSpace($email)) {
      Write-Warn "Skipping invalid row in users CSV (username/email required)."
      continue
    }

    if ([string]::IsNullOrWhiteSpace($password)) {
      $password = New-RandomSecret 16
    }

    if ($role -notin @('admin', 'operator', 'viewer')) {
      $role = 'viewer'
    }

    try {
      Invoke-JsonPost "$BaseUrl/api/users" @{
        username = $username.Trim()
        email = $email.Trim()
        password = $password
        role = $role
        must_change_password = $true
      } @{ Authorization = "Bearer $AuthToken" } | Out-Null

      $credentials += [PSCustomObject]@{
        username = $username.Trim()
        email = $email.Trim()
        role = $role
        temporary_password = $password
        must_change_password = 'true'
      }

      $created += 1
      Write-Info "Created user: $username"
    }
    catch {
      Write-Warn "User create failed for ${username}: $($_.Exception.Message)"
    }
  }

  $credentialsPath = ''
  if ($credentials.Count -gt 0) {
    $secureDir = Join-Path $InstallPath 'client-onboarding'
    New-Item -Path $secureDir -ItemType Directory -Force | Out-Null
    $credentialsPath = Join-Path $secureDir 'provisioned-user-credentials.csv'
    $credentials | Export-Csv -Path $credentialsPath -NoTypeInformation -Encoding UTF8
  }

  return @{ created = $created; credentialsPath = $credentialsPath }
}

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltinRole]::Administrator
)
if (-not $isAdmin) {
  throw 'Run this installer as Administrator.'
}

if ($Mode -eq 'Guided') {
  $ConfigureNow = $true
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path

$requiredPackagePaths = @(
  'backend\package.json',
  'frontend\package.json',
  'installer\windows\install-vms-server.ps1',
  '.env.example'
)

$missingPackagePaths = @()
foreach ($relativePath in $requiredPackagePaths) {
  if (-not (Test-Path (Join-Path $sourceRoot $relativePath))) {
    $missingPackagePaths += $relativePath
  }
}

if ($missingPackagePaths.Count -gt 0) {
  throw "Invalid installer location. Could not find expected package files under source root '$sourceRoot'. Launch the installer from the extracted VMS-Server-Installer folder (for example: VMS-SETUP-LAUNCHER.cmd or INSTALL-WINDOWS-SERVER-WALKTHROUGH.cmd). Missing: $($missingPackagePaths -join ', ')"
}

if ($Mode -eq 'Guided') {
  Write-Host ''
  Write-Host 'VMS Guided Provisioning' -ForegroundColor Yellow
  Write-Host 'Press Enter to accept defaults.' -ForegroundColor Yellow
  Write-Host ''

  $InstallDir = Read-OptionalValue 'Install directory' $InstallDir
  $DataDrive = Read-OptionalValue 'Data drive letter' $DataDrive
  if ($DataDrive.Length -eq 1) { $DataDrive = "${DataDrive}:" }
  $ServiceName = Read-OptionalValue 'Windows service name' $ServiceName

  $AdminUsername = Read-OptionalValue 'Admin username' $AdminUsername
  $AdminEmail = Read-OptionalValue 'Admin email' $AdminEmail
  $AdminPassword = Read-RequiredSecret 'Admin password'

  $RetentionDays = Read-OptionalInt 'Retention days' $RetentionDays 1 3650
  $MaxCameras = Read-OptionalInt 'Max cameras' $MaxCameras 1 1024
  $SnapshotInterval = Read-OptionalInt 'Snapshot interval seconds' $SnapshotInterval 10 86400

  $hostname = $env:COMPUTERNAME
  $PublicBaseUrl = Read-OptionalValue 'Public base URL' ("http://${hostname}:3001")
  $CorsOrigins = Read-OptionalValue 'CORS origins (comma separated)' $PublicBaseUrl

  $usersPrompt = Read-OptionalValue 'Optional users CSV path (blank to skip)' $UsersCsvPath
  $UsersCsvPath = $usersPrompt
}

if ($DataDrive.Length -eq 1) {
  $DataDrive = "${DataDrive}:"
}
if ($DataDrive -notmatch '^[A-Za-z]:$') {
  throw 'DataDrive must be a drive letter such as V: or D:'
}
if ($ServiceName -notmatch '^[A-Za-z0-9_-]+$') {
  throw "ServiceName '$ServiceName' is invalid. Use only letters, numbers, underscore, or dash (example: VMSCarroll or VMS_Carroll)."
}

$logicalDisk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$DataDrive'" -ErrorAction SilentlyContinue
if (-not $logicalDisk) {
  throw "DataDrive $DataDrive was not found on this system."
}
if ($logicalDisk.DriveType -eq 4 -and -not $SkipService) {
  throw "DataDrive $DataDrive is a mapped network drive. Windows services running as LocalSystem usually cannot access mapped drive letters. Use a local fixed disk for DataDrive, or run with -SkipService and start backend manually under a user account with access."
}

$driveLetter = $DataDrive.Substring(0, 1).ToUpper()
$dataRoot = "$DataDrive\VMSData"
$dbDir = "$dataRoot\db"
$recordingsDir = "$dataRoot\recordings"
$streamsDir = "$dataRoot\streams"
$snapshotsDir = "$dataRoot\snapshots"
$thumbnailsDir = "$dataRoot\thumbnails"

$dbPathEnv = "${driveLetter}:/VMSData/db/vms.db"
$recordingsPathEnv = "${driveLetter}:/VMSData/recordings"
$streamsPathEnv = "${driveLetter}:/VMSData/streams"
$snapshotsPathEnv = "${driveLetter}:/VMSData/snapshots"
$thumbnailsPathEnv = "${driveLetter}:/VMSData/thumbnails"

Write-Info "Source package: $sourceRoot"
Write-Info "Install directory: $InstallDir"
Write-Info "Data root: $dataRoot"

Ensure-Command node 'Install Node.js 22 LTS and retry.'
Ensure-Command npm 'Install npm (comes with Node.js) and retry.'
Ensure-Command ffmpeg 'Install FFmpeg and ensure ffmpeg.exe is in PATH.'

Write-Info 'Copying package files...'
New-Item -Path $InstallDir -ItemType Directory -Force | Out-Null

$excludeDirs = @(
  (Join-Path $sourceRoot '.git'),
  (Join-Path $sourceRoot 'node_modules'),
  (Join-Path $sourceRoot 'backend\node_modules'),
  (Join-Path $sourceRoot 'frontend\node_modules'),
  (Join-Path $sourceRoot 'desktop-client\node_modules'),
  (Join-Path $sourceRoot 'desktop-client\dist'),
  (Join-Path $sourceRoot 'dist')
)

$robocopyArgs = @(
  $sourceRoot,
  $InstallDir,
  '/E',
  '/R:2',
  '/W:2',
  '/NFL',
  '/NDL',
  '/NJH',
  '/NJS',
  '/NP',
  '/XD'
) + $excludeDirs

& robocopy @robocopyArgs | Out-Null
if ($LASTEXITCODE -gt 7) {
  throw "File copy failed with robocopy exit code $LASTEXITCODE"
}

Write-Info 'Preparing storage directories on data drive...'
@($dbDir, $recordingsDir, $streamsDir, $snapshotsDir, $thumbnailsDir) | ForEach-Object {
  New-Item -Path $_ -ItemType Directory -Force | Out-Null
}

$envExample = Join-Path $InstallDir '.env.example'
if (-not (Test-Path $envExample)) {
  throw "Missing .env.example at $envExample"
}

$envContent = Get-Content $envExample -Raw
$jwtSecret = New-RandomSecret
$replacements = @{
  '^JWT_SECRET=.*$' = "JWT_SECRET=$jwtSecret"
  '^NODE_ENV=.*$' = 'NODE_ENV=production'
  '^PORT=.*$' = 'PORT=3001'
  '^CORS_ORIGINS=.*$' = 'CORS_ORIGINS=http://localhost:3001'
  '^DB_PATH=.*$' = "DB_PATH=$dbPathEnv"
  '^RECORDINGS_DIR=.*$' = "RECORDINGS_DIR=$recordingsPathEnv"
  '^STREAMS_DIR=.*$' = "STREAMS_DIR=$streamsPathEnv"
  '^SNAPSHOTS_DIR=.*$' = "SNAPSHOTS_DIR=$snapshotsPathEnv"
  '^THUMBNAILS_DIR=.*$' = "THUMBNAILS_DIR=$thumbnailsPathEnv"
}

foreach ($pattern in $replacements.Keys) {
  $envContent = [regex]::Replace($envContent, $pattern, $replacements[$pattern], [System.Text.RegularExpressions.RegexOptions]::Multiline)
}

$rootEnvPath = Join-Path $InstallDir '.env'
$backendEnvPath = Join-Path $InstallDir 'backend\.env'
Set-Content -Path $rootEnvPath -Value $envContent -Encoding UTF8
Set-Content -Path $backendEnvPath -Value $envContent -Encoding UTF8
Write-Ok 'Environment files generated.'

Push-Location $InstallDir
try {
  Write-Info 'Installing backend dependencies...'
  npm install --prefix backend --omit=dev

  $frontendIndex = Join-Path $InstallDir 'frontend\dist\index.html'
  if (-not (Test-Path $frontendIndex)) {
    Write-Info 'Frontend dist not found. Installing frontend dependencies and building assets...'
    npm install --prefix frontend
    npm --prefix frontend run build
  } else {
    Write-Info 'Frontend dist detected. Skipping frontend rebuild.'
  }
}
finally {
  Pop-Location
}

Write-Info 'Ensuring firewall rule for TCP 3001...'
if (-not (Get-NetFirewallRule -DisplayName 'VMS TCP 3001' -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName 'VMS TCP 3001' -Direction Inbound -Protocol TCP -LocalPort 3001 -Action Allow | Out-Null
  Write-Ok 'Firewall rule created: VMS TCP 3001'
} else {
  Write-Info 'Firewall rule already exists: VMS TCP 3001'
}

$launcherPath = Join-Path $InstallDir 'run-vms-server.cmd'
$backendLogDir = Join-Path $InstallDir 'backend\logs'
$backendLogPath = Join-Path $backendLogDir 'server.log'
$startupTaskName = "${ServiceName}-Startup"
$launcherContent = "@echo off`r`nsetlocal`r`nif not exist `"%~dp0backend\logs`" mkdir `"%~dp0backend\logs`"`r`ncd /d `"%~dp0backend`"`r`nnode server.js >> `"%~dp0backend\logs\server.log`" 2>&1`r`n"
Set-Content -Path $launcherPath -Value $launcherContent -Encoding ASCII

$backendStartedOutsideService = $false

if (-not $SkipService) {
  Write-Info "Configuring Windows service: $ServiceName"

  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Warn "Service $ServiceName already exists. Replacing it..."
    try { & sc.exe stop $ServiceName | Out-Null } catch {}
    Start-Sleep -Seconds 2
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
  }

  $binPath = "cmd.exe /c `"$launcherPath`""
  $createOutput = & sc.exe create $ServiceName 'binPath=' $binPath 'start=' 'auto' 'DisplayName=' 'VMS Camera Server' 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to create Windows service '$ServiceName'. sc.exe output: $($createOutput -join ' | ')"
  }

  $descriptionOutput = & sc.exe description $ServiceName 'VMS Camera Server backend service' 2>&1
  if ($LASTEXITCODE -ne 0) {
    throw "Failed to set description for service '$ServiceName'. sc.exe output: $($descriptionOutput -join ' | ')"
  }

  Start-Sleep -Seconds 1

  $startOutput = & sc.exe start $ServiceName 2>&1
  if ($LASTEXITCODE -ne 0) {
    $startText = $startOutput -join ' | '
    if ($startText -match 'FAILED 1053') {
      Write-Warn "Service start returned 1053 for '$ServiceName'. Falling back to direct backend start for provisioning."

      try {
        $taskAction = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$launcherPath`""
        $taskTrigger = New-ScheduledTaskTrigger -AtStartup
        $taskPrincipal = New-ScheduledTaskPrincipal -UserId 'SYSTEM' -LogonType ServiceAccount -RunLevel Highest
        Register-ScheduledTask -TaskName $startupTaskName -Action $taskAction -Trigger $taskTrigger -Principal $taskPrincipal -Force | Out-Null
        Write-Ok "Registered startup task for reboot auto-start: $startupTaskName"
      }
      catch {
        Write-Warn "Could not register startup task '$startupTaskName': $($_.Exception.Message)"
      }

      Start-Process -FilePath 'cmd.exe' -ArgumentList @('/c', $launcherPath) -WorkingDirectory $InstallDir -WindowStyle Hidden | Out-Null
      Start-Sleep -Seconds 3
      $backendStartedOutsideService = $true
    } else {
      throw "Failed to start service '$ServiceName'. sc.exe output: $startText. Check backend log at $backendLogPath"
    }
  }

  if (-not $backendStartedOutsideService) {
    Start-Sleep -Seconds 3
    $serviceState = (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue)
    if (-not $serviceState -or $serviceState.Status -ne 'Running') {
      $stateLabel = if ($serviceState) { [string]$serviceState.Status } else { 'NotFound' }
      throw "Service $ServiceName is not running after start (state: $stateLabel). Check backend log at $backendLogPath"
    }

    Write-Ok "Service started: $ServiceName"
  } else {
    Write-Warn "Backend started outside Windows service for provisioning only. Review service configuration after install."
  }
} else {
  Write-Warn 'SkipService was set. Service creation skipped.'
}

$baseUrl = 'http://localhost:3001'
$provisioningRan = $false
$createdUsersCount = 0
$provisionedCredentialsPath = ''

if ($ConfigureNow) {
  Write-Info 'Waiting for backend health before provisioning...'
  if (-not (Wait-ForHealth $baseUrl 120)) {
    if (-not $SkipService -and -not $backendStartedOutsideService) {
      $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
      if ($svc) {
        Write-Warn "Service state at health timeout: $($svc.Status)"
      }
    }

    if (Test-Path $backendLogPath) {
      Write-Warn "Backend log tail ($backendLogPath):"
      Get-Content $backendLogPath -Tail 40 | ForEach-Object { Write-Host $_ -ForegroundColor Yellow }
    } else {
      Write-Warn "Backend log not found at $backendLogPath"
    }

    throw 'Backend did not become healthy in time. Provisioning aborted.'
  }

  $status = Invoke-RestMethod -Method Get -Uri "$baseUrl/api/setup/status"
  $canRunAuthenticatedProvisioning = $true

  if (-not $status.setupCompleted) {
    if ([string]::IsNullOrWhiteSpace($AdminPassword)) {
      if ($Mode -eq 'Guided') {
        $AdminPassword = Read-RequiredSecret 'Admin password'
      } else {
        $AdminPassword = New-RandomSecret 20
        Write-Warn "Admin password was auto-generated for one-click mode: $AdminPassword"
      }
    }

    Write-Info 'Completing initial setup (admin + system limits)...'
    Invoke-JsonPost "$baseUrl/api/setup/complete" @{
      username = $AdminUsername
      email = $AdminEmail
      password = $AdminPassword
      retention_days = $RetentionDays
      max_cameras = $MaxCameras
      snapshot_interval = $SnapshotInterval
    } | Out-Null
    Write-Ok 'Initial setup completed automatically.'
  } else {
    Write-Warn 'Setup already completed. Skipping setup completion step.'

    if ([string]::IsNullOrWhiteSpace($AdminPassword)) {
      if ($Mode -eq 'Guided') {
        $AdminPassword = Read-RequiredSecret 'Existing admin password (required to apply server config/import users)'
      } else {
        $canRunAuthenticatedProvisioning = $false
        Write-Warn 'Admin password was not supplied, so authenticated provisioning steps will be skipped in one-click mode.'
        Write-Warn 'To apply server-config or import users now, rerun with -Mode Guided or pass -AdminPassword.'
      }
    }
  }

  if ([string]::IsNullOrWhiteSpace($PublicBaseUrl)) {
    $hostname = $env:COMPUTERNAME
    $PublicBaseUrl = "http://${hostname}:3001"
  }
  if ([string]::IsNullOrWhiteSpace($CorsOrigins)) {
    $CorsOrigins = $PublicBaseUrl
  }

  if ($canRunAuthenticatedProvisioning) {
    Write-Info 'Logging in as admin to apply server configuration and import users...'
    $login = Invoke-JsonPost "$baseUrl/api/auth/login" @{
      username = $AdminUsername
      password = $AdminPassword
    }

    $token = [string]$login.token
    if ([string]::IsNullOrWhiteSpace($token)) {
      throw 'Admin login token was not returned. Cannot continue provisioning.'
    }

    Invoke-JsonPut "$baseUrl/api/setup/server-config" @{
      public_base_url = $PublicBaseUrl
      cors_origins = $CorsOrigins
    } @{ Authorization = "Bearer $token" } | Out-Null
    Write-Ok 'Server public URL and CORS configuration updated.'

    $importResult = Import-ProvisionUsers $UsersCsvPath $baseUrl $token $InstallDir
    $createdUsersCount = [int]$importResult.created
    $provisionedCredentialsPath = [string]$importResult.credentialsPath
    if ($createdUsersCount -gt 0) {
      Write-Ok "Created $createdUsersCount users from CSV."
    }

    $onboardingDir = New-ClientOnboardingPackage $InstallDir $PublicBaseUrl
    Write-Ok "Client onboarding package created: $onboardingDir"

    $provisioningRan = $true
  } else {
    Write-Warn 'Authenticated provisioning steps were skipped.'
    Write-Warn 'Run INSTALL-WINDOWS-SERVER-WALKTHROUGH.cmd as Administrator to enter existing admin credentials and finish provisioning.'
  }
}

Write-Ok 'Installation complete.'
Write-Host ''
Write-Host "URL: http://localhost:3001" -ForegroundColor Green
Write-Host "Install path: $InstallDir" -ForegroundColor Green
Write-Host "Data path: $dataRoot" -ForegroundColor Green
Write-Host ''

if ($provisioningRan) {
  Write-Host "Admin username: $AdminUsername" -ForegroundColor Green
  Write-Host "Admin email: $AdminEmail" -ForegroundColor Green
  Write-Host "Public base URL: $PublicBaseUrl" -ForegroundColor Green
  if ($createdUsersCount -gt 0) {
    Write-Host "Users created from CSV: $createdUsersCount" -ForegroundColor Green
    if (-not [string]::IsNullOrWhiteSpace($provisionedCredentialsPath)) {
      Write-Host "Temporary credentials file: $provisionedCredentialsPath" -ForegroundColor Yellow
      Write-Host 'Distribute temporary passwords securely and delete this file after onboarding.' -ForegroundColor Yellow
    }
  }
  Write-Host "Desktop onboarding package: $InstallDir\\client-onboarding" -ForegroundColor Yellow
  Write-Host 'Copy that folder to user devices and run INSTALL-VMS-CLIENT.cmd there.' -ForegroundColor Yellow

  if ($backendStartedOutsideService) {
    Write-Host "Startup fallback task: $startupTaskName" -ForegroundColor Yellow
    Write-Host 'This task starts backend automatically at reboot because Windows service start returned 1053.' -ForegroundColor Yellow
  }
} else {
  Write-Host 'Next step: open http://localhost:3001/login and complete provisioning manually if needed.' -ForegroundColor Yellow
  Write-Host 'Use installer/windows/install-vms-server-walkthrough.cmd for guided proprietary setup prompts.' -ForegroundColor Yellow
}
