param(
  [string]$SourceInstallDir = 'C:\VMS-CameraServer',
  [string]$TargetInstallDir = 'V:\VMS-CameraServer',
  [string]$SourceDataDir = 'C:\VMSData',
  [string]$TargetDataDir = 'V:\VMSData',
  [string]$ServiceName = 'VMSCameraServer',
  [switch]$SkipAppCopy,
  [switch]$SkipDataCopy,
  [switch]$SkipServiceRestart
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg) { Write-Host "[VMS-MIGRATE] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[VMS-MIGRATE] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[VMS-MIGRATE] $msg" -ForegroundColor Yellow }

function Ensure-Admin {
  $isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
    [Security.Principal.WindowsBuiltinRole]::Administrator
  )
  if (-not $isAdmin) {
    throw 'Run this migration script as Administrator.'
  }
}

function Ensure-Directory([string]$Path) {
  New-Item -Path $Path -ItemType Directory -Force | Out-Null
}

function Invoke-Robocopy([string]$From, [string]$To, [string[]]$ExtraArgs = @()) {
  Ensure-Directory $To

  $baseArgs = @(
    $From,
    $To,
    '/E',
    '/COPY:DAT',
    '/DCOPY:DAT',
    '/R:2',
    '/W:2',
    '/NFL',
    '/NDL',
    '/NJH',
    '/NJS',
    '/NP'
  ) + $ExtraArgs

  & robocopy @baseArgs | Out-Null
  if ($LASTEXITCODE -gt 7) {
    throw "Robocopy failed ($LASTEXITCODE) from '$From' to '$To'."
  }
}

function Stop-VmsRuntime([string]$SvcName) {
  if (Get-Service -Name $SvcName -ErrorAction SilentlyContinue) {
    Write-Info "Stopping service: $SvcName"
    try { & sc.exe stop $SvcName | Out-Null } catch {}
  }

  $startupTaskName = "${SvcName}-Startup"
  if (Get-ScheduledTask -TaskName $startupTaskName -ErrorAction SilentlyContinue) {
    Write-Info "Stopping scheduled task (if running): $startupTaskName"
    try { Stop-ScheduledTask -TaskName $startupTaskName -ErrorAction SilentlyContinue | Out-Null } catch {}
  }

  $vmsNodes = Get-CimInstance Win32_Process -Filter "name = 'node.exe'" -ErrorAction SilentlyContinue |
    Where-Object {
      $_.CommandLine -match 'VMS-CameraServer|VMSData|server\.js'
    }

  foreach ($proc in $vmsNodes) {
    Write-Warn "Stopping stray node.exe PID $($proc.ProcessId)"
    try { Stop-Process -Id $proc.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
  }
}

function Ensure-Launcher([string]$InstallDir) {
  $launcherPath = Join-Path $InstallDir 'run-vms-server.cmd'
  $launcherContent = "@echo off`r`nsetlocal`r`nif not exist `"%~dp0backend\logs`" mkdir `"%~dp0backend\logs`"`r`ncd /d `"%~dp0backend`"`r`nnode server.js >> `"%~dp0backend\logs\server.log`" 2>&1`r`n"
  Set-Content -Path $launcherPath -Value $launcherContent -Encoding ASCII
  return $launcherPath
}

function Update-EnvStoragePaths([string]$EnvPath, [string]$DataRoot) {
  if (-not (Test-Path $EnvPath)) {
    return
  }

  $driveLetter = $DataRoot.Substring(0, 1).ToUpper()
  $normalizedRoot = "${driveLetter}:/" + ($DataRoot.Substring(3) -replace '\\', '/')

  $updates = @{
    '^DB_PATH=.*$' = "DB_PATH=${normalizedRoot}/db/vms.db"
    '^RECORDINGS_DIR=.*$' = "RECORDINGS_DIR=${normalizedRoot}/recordings"
    '^STREAMS_DIR=.*$' = "STREAMS_DIR=${normalizedRoot}/streams"
    '^SNAPSHOTS_DIR=.*$' = "SNAPSHOTS_DIR=${normalizedRoot}/snapshots"
    '^THUMBNAILS_DIR=.*$' = "THUMBNAILS_DIR=${normalizedRoot}/thumbnails"
  }

  $content = Get-Content $EnvPath -Raw
  foreach ($pattern in $updates.Keys) {
    if ($content -match $pattern) {
      $content = [regex]::Replace($content, $pattern, $updates[$pattern], [System.Text.RegularExpressions.RegexOptions]::Multiline)
    } else {
      $content = $content.TrimEnd("`r", "`n") + "`r`n" + $updates[$pattern] + "`r`n"
    }
  }

  Set-Content -Path $EnvPath -Value $content -Encoding UTF8
  Write-Ok "Updated storage paths in: $EnvPath"
}

function Ensure-Service([string]$SvcName, [string]$LauncherPath, [switch]$NoRestart) {
  $binPath = "cmd.exe /c `"$LauncherPath`""

  if (Get-Service -Name $SvcName -ErrorAction SilentlyContinue) {
    Write-Info "Reconfiguring existing service: $SvcName"
    $cfg = & sc.exe config $SvcName 'binPath=' $binPath 'start=' 'auto' 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to reconfigure service '$SvcName'. sc.exe output: $($cfg -join ' | ')"
    }
  } else {
    Write-Info "Creating service: $SvcName"
    $created = & sc.exe create $SvcName 'binPath=' $binPath 'start=' 'auto' 'DisplayName=' 'VMS Camera Server' 2>&1
    if ($LASTEXITCODE -ne 0) {
      throw "Failed to create service '$SvcName'. sc.exe output: $($created -join ' | ')"
    }
  }

  & sc.exe description $SvcName 'VMS Camera Server backend service' | Out-Null

  if ($NoRestart) {
    Write-Warn 'SkipServiceRestart was set. Service was configured but not started.'
    return
  }

  Write-Info "Starting service: $SvcName"
  $start = & sc.exe start $SvcName 2>&1
  if ($LASTEXITCODE -ne 0 -and -not (($start -join ' ') -match 'SERVICE_ALREADY_RUNNING')) {
    throw "Failed to start service '$SvcName'. sc.exe output: $($start -join ' | ')"
  }
}

function Wait-ForHealth([string]$BaseUrl, [int]$TimeoutSec = 120) {
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

Ensure-Admin

if ($TargetInstallDir -notmatch '^[A-Za-z]:\\') {
  throw "TargetInstallDir must be an absolute Windows path. Got: $TargetInstallDir"
}
if ($TargetDataDir -notmatch '^[A-Za-z]:\\') {
  throw "TargetDataDir must be an absolute Windows path. Got: $TargetDataDir"
}

$targetDrive = $TargetDataDir.Substring(0, 2)
$targetDisk = Get-CimInstance Win32_LogicalDisk -Filter "DeviceID='$targetDrive'" -ErrorAction SilentlyContinue
if (-not $targetDisk) {
  throw "Target data drive not found: $targetDrive"
}

Write-Info "Source install: $SourceInstallDir"
Write-Info "Target install: $TargetInstallDir"
Write-Info "Source data: $SourceDataDir"
Write-Info "Target data: $TargetDataDir"

Stop-VmsRuntime $ServiceName

Write-Info 'Ensuring target directory structure...'
Ensure-Directory $TargetInstallDir
@(
  $TargetDataDir,
  (Join-Path $TargetDataDir 'db'),
  (Join-Path $TargetDataDir 'recordings'),
  (Join-Path $TargetDataDir 'streams'),
  (Join-Path $TargetDataDir 'snapshots'),
  (Join-Path $TargetDataDir 'thumbnails')
) | ForEach-Object { Ensure-Directory $_ }

if (-not $SkipAppCopy) {
  if (Test-Path $SourceInstallDir) {
    Write-Info 'Copying application files to target install directory...'
    $excludeDirs = @(
      '/XD',
      (Join-Path $SourceInstallDir '.git'),
      (Join-Path $SourceInstallDir 'node_modules'),
      (Join-Path $SourceInstallDir 'backend\node_modules'),
      (Join-Path $SourceInstallDir 'frontend\node_modules'),
      (Join-Path $SourceInstallDir 'desktop-client\node_modules'),
      (Join-Path $SourceInstallDir 'desktop-client\dist'),
      (Join-Path $SourceInstallDir 'dist')
    )
    Invoke-Robocopy $SourceInstallDir $TargetInstallDir $excludeDirs
  } else {
    Write-Warn "Source install path not found, skipping app copy: $SourceInstallDir"
  }
} else {
  Write-Warn 'SkipAppCopy was set. Application file copy skipped.'
}

if (-not $SkipDataCopy) {
  if (Test-Path $SourceDataDir) {
    Write-Info 'Copying VMSData to target data directory...'
    Invoke-Robocopy $SourceDataDir $TargetDataDir
  } else {
    Write-Warn "Source data path not found, skipping direct data copy: $SourceDataDir"
  }

  $legacyBackendData = Join-Path $SourceInstallDir 'backend\data'
  if (Test-Path $legacyBackendData) {
    Write-Info 'Copying legacy backend/data content into target data directory...'
    Invoke-Robocopy $legacyBackendData $TargetDataDir
  }
} else {
  Write-Warn 'SkipDataCopy was set. Data copy skipped.'
}

$rootEnv = Join-Path $TargetInstallDir '.env'
$backendEnv = Join-Path $TargetInstallDir 'backend\.env'
$envExample = Join-Path $TargetInstallDir '.env.example'

if (-not (Test-Path $rootEnv) -and (Test-Path $envExample)) {
  Copy-Item $envExample $rootEnv -Force
}
if (-not (Test-Path $backendEnv) -and (Test-Path $rootEnv)) {
  Copy-Item $rootEnv $backendEnv -Force
}

Update-EnvStoragePaths $rootEnv $TargetDataDir
Update-EnvStoragePaths $backendEnv $TargetDataDir

$launcherPath = Ensure-Launcher $TargetInstallDir
Ensure-Service $ServiceName $launcherPath -NoRestart:$SkipServiceRestart

if (-not $SkipServiceRestart) {
  Write-Info 'Waiting for health check...'
  if (Wait-ForHealth 'http://localhost:3001' 120) {
    Write-Ok 'Migration complete. Service is healthy on http://localhost:3001'
  } else {
    Write-Warn 'Service did not report healthy in time. Check backend log at:'
    Write-Warn (Join-Path $TargetInstallDir 'backend\logs\server.log')
    exit 1
  }
}

Write-Host ''
Write-Host 'Next safe cleanup steps (manual):' -ForegroundColor Yellow
Write-Host "1) Validate new writes under $TargetDataDir" -ForegroundColor Yellow
Write-Host "2) Confirm service path: sc qc $ServiceName" -ForegroundColor Yellow
Write-Host "3) Keep old C: paths for rollback until stable, then archive/remove." -ForegroundColor Yellow
