param(
  [string]$InstallDir = 'V:\VMS-CameraServer',
  [string]$DataRoot = 'V:\VMSData',
  [int]$PublicPort = 8080,
  [string]$ComposeProjectName = 'vms',
  [switch]$SkipFrontendBuild,
  [switch]$RemoveLegacyInstall,
  [string[]]$LegacyServiceNames = @('VMSCameraServer', 'vmscameraserver.exe')
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg) { Write-Host "[VMS-DOCKER] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[VMS-DOCKER] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[VMS-DOCKER] $msg" -ForegroundColor Yellow }

function Ensure-Admin {
  $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltinRole]::Administrator
  )

  if (-not $isAdmin) {
    throw 'Run this script as Administrator.'
  }
}

function Ensure-Command([string]$Name, [string]$Hint) {
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "$Name is required. $Hint"
  }
}

function Ensure-Directory([string]$Path) {
  New-Item -Path $Path -ItemType Directory -Force | Out-Null
}

function New-RandomSecret([int]$Length = 72) {
  $chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  $out = New-Object System.Text.StringBuilder
  1..$Length | ForEach-Object {
    [void]$out.Append($chars[(Get-Random -Minimum 0 -Maximum $chars.Length)])
  }
  return $out.ToString()
}

function Stop-AndRemoveService([string]$ServiceName) {
  $svc = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue
  if (-not $svc) {
    return
  }

  Write-Info "Stopping legacy service: $ServiceName"
  try { & sc.exe stop $ServiceName | Out-Null } catch {}
  Start-Sleep -Seconds 2

  Write-Info "Removing legacy service: $ServiceName"
  try { & sc.exe delete $ServiceName | Out-Null } catch {}
}

function Stop-LegacyProcesses([string]$InstallPath) {
  $installHint = [regex]::Escape($InstallPath)
  $nodeProcs = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -match 'server\.js' -or
      $_.CommandLine -match 'VMS-CameraServer' -or
      $_.CommandLine -match $installHint
    }

  foreach ($proc in $nodeProcs) {
    Write-Warn "Stopping legacy backend process PID $($proc.ProcessId)"
    try { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
}

function Update-OrAddEnvVar([string]$FilePath, [string]$Key, [string]$Value) {
  $escapedKey = [regex]::Escape($Key)
  $pattern = "(?m)^$escapedKey=.*$"
  $line = "$Key=$Value"

  $content = ''
  if (Test-Path $FilePath) {
    $content = Get-Content $FilePath -Raw
  }

  if ($content -match $pattern) {
    $content = [regex]::Replace($content, $pattern, $line)
  } else {
    if ($content -and -not $content.EndsWith("`n")) {
      $content += "`r`n"
    }
    $content += "$line`r`n"
  }

  Set-Content -Path $FilePath -Value $content -Encoding UTF8
}

function Convert-WindowsPathToCompose([string]$Path) {
  $trimmed = $Path.Trim()
  if ($trimmed -notmatch '^[A-Za-z]:\\') {
    throw "Path must be absolute with drive letter. Got: $Path"
  }

  $drive = $trimmed.Substring(0, 1).ToUpper()
  $rest = $trimmed.Substring(3) -replace '\\', '/'
  return "${drive}:/$rest"
}

function Sync-PrimaryDatabase([string]$RootPath) {
  $primaryDb = Join-Path $RootPath 'vms.db'
  $nestedDb = Join-Path (Join-Path $RootPath 'db') 'vms.db'

  if (-not (Test-Path $nestedDb)) {
    return
  }

  $nestedInfo = Get-Item $nestedDb
  $hasPrimary = Test-Path $primaryDb
  $primaryInfo = if ($hasPrimary) { Get-Item $primaryDb } else { $null }

  # If primary DB is missing or very small while nested DB has real data, promote nested DB.
  $shouldPromote = (-not $hasPrimary) -or (
    $primaryInfo.Length -lt 65536 -and $nestedInfo.Length -gt $primaryInfo.Length
  )

  if (-not $shouldPromote) {
    return
  }

  if ($hasPrimary) {
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $backupPath = Join-Path $RootPath "vms.db.backup-$stamp"
    Copy-Item -Path $primaryDb -Destination $backupPath -Force
    Write-Warn "Backed up existing primary DB to $backupPath"
  }

  Copy-Item -Path $nestedDb -Destination $primaryDb -Force
  Write-Ok "Primary DB synced from nested DB: $nestedDb -> $primaryDb"
}

Ensure-Admin

if (-not (Test-Path $InstallDir)) {
  throw "InstallDir not found: $InstallDir"
}

Ensure-Command docker 'Install Docker Desktop and ensure the docker CLI is available in PATH.'
Ensure-Command npm 'Install Node.js LTS with npm.'

Write-Info 'Checking Docker daemon status...'
$dockerVersion = & docker version --format '{{.Server.Version}}' 2>$null
if ($LASTEXITCODE -ne 0 -or [string]::IsNullOrWhiteSpace($dockerVersion)) {
  throw 'Docker daemon is not running. Start Docker Desktop and rerun.'
}

Write-Ok "Docker daemon is running (Server $dockerVersion)."

$composeCheck = & docker compose version 2>$null
if ($LASTEXITCODE -ne 0) {
  throw 'docker compose is required. Update Docker Desktop to a version that includes Compose v2.'
}

Write-Info 'Stopping/removing legacy Windows service install if present...'
foreach ($serviceName in $LegacyServiceNames) {
  Stop-AndRemoveService $serviceName
}

$startupTaskName = 'VMSCameraServer-Startup'
if (Get-ScheduledTask -TaskName $startupTaskName -ErrorAction SilentlyContinue) {
  Write-Info "Removing legacy scheduled task: $startupTaskName"
  try { Unregister-ScheduledTask -TaskName $startupTaskName -Confirm:$false -ErrorAction SilentlyContinue | Out-Null } catch {}
}

Stop-LegacyProcesses $InstallDir

Write-Info 'Preparing data directories on target data drive...'
Ensure-Directory $DataRoot
@('db', 'recordings', 'streams', 'snapshots', 'thumbnails') |
  ForEach-Object { Ensure-Directory (Join-Path $DataRoot $_) }

Sync-PrimaryDatabase $DataRoot

$envFile = Join-Path $InstallDir '.env'
$envExample = Join-Path $InstallDir '.env.example'

if (-not (Test-Path $envFile)) {
  if (Test-Path $envExample) {
    Copy-Item $envExample $envFile -Force
  } else {
    Set-Content -Path $envFile -Value '' -Encoding UTF8
  }
}

$dataRootForCompose = Convert-WindowsPathToCompose $DataRoot

Update-OrAddEnvVar $envFile 'NODE_ENV' 'production'
Update-OrAddEnvVar $envFile 'PORT' '3001'
Update-OrAddEnvVar $envFile 'VMS_PORT' ([string]$PublicPort)
Update-OrAddEnvVar $envFile 'VMS_DATA_ROOT' $dataRootForCompose

$currentEnv = Get-Content $envFile -Raw
if ($currentEnv -match '(?m)^JWT_SECRET\s*=\s*(change-me-to-a-very-long-random-secret-in-production)?\s*$') {
  Update-OrAddEnvVar $envFile 'JWT_SECRET' (New-RandomSecret)
}

if (-not ($currentEnv -match '(?m)^CORS_ORIGINS=')) {
  Update-OrAddEnvVar $envFile 'CORS_ORIGINS' ("http://localhost:$PublicPort,http://127.0.0.1:$PublicPort")
}

if (-not $SkipFrontendBuild) {
  Write-Info 'Building frontend static assets for nginx...'
  Push-Location $InstallDir
  try {
    npm run build
  }
  finally {
    Pop-Location
  }
} else {
  Write-Warn 'SkipFrontendBuild set. Reusing existing frontend/dist.'
}

Write-Info 'Removing previous Docker deployment for a clean cutover...'
Push-Location $InstallDir
try {
  & docker compose -p $ComposeProjectName down --remove-orphans

  Write-Info 'Starting Docker stack (backend + nginx)...'
  & docker compose -p $ComposeProjectName up -d --build

  if ($LASTEXITCODE -ne 0) {
    throw 'docker compose up failed. Review docker output for details.'
  }
}
finally {
  Pop-Location
}

Write-Info "Ensuring Windows Firewall allows TCP $PublicPort..."
try {
  $ruleName = "VMS Docker HTTP $PublicPort"
  if (-not (Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $ruleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $PublicPort | Out-Null
  }
}
catch {
  Write-Warn 'Firewall rule creation failed. Add inbound allow rule manually if needed.'
}

if ($RemoveLegacyInstall) {
  $legacyPath = 'C:\VMS-CameraServer'
  if (Test-Path $legacyPath) {
    $archiveRoot = 'C:\VMS-Archive'
    Ensure-Directory $archiveRoot
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    $archivePath = Join-Path $archiveRoot "VMS-CameraServer-$stamp"

    Write-Warn "Archiving legacy install from $legacyPath to $archivePath"
    Move-Item -Path $legacyPath -Destination $archivePath -Force
  }
}

Write-Host ''
Write-Ok 'Docker cutover complete.'
Write-Host "Server URL: http://localhost:$PublicPort" -ForegroundColor Green
Write-Host "Data root:  $DataRoot" -ForegroundColor Green
Write-Host ''
Write-Host 'Verification commands:' -ForegroundColor Yellow
Write-Host "  docker compose -p $ComposeProjectName ps" -ForegroundColor Yellow
Write-Host "  docker compose -p $ComposeProjectName logs -f backend" -ForegroundColor Yellow
Write-Host "  docker compose -p $ComposeProjectName logs -f nginx" -ForegroundColor Yellow
