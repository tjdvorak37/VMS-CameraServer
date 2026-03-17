param(
  [string]$InstallDir = 'C:\VMS-CameraServer',
  [string]$DataDrive = 'E:',
  [string]$ServiceName = 'VMSCameraServer',
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

$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole(
  [Security.Principal.WindowsBuiltinRole]::Administrator
)
if (-not $isAdmin) {
  throw 'Run this installer as Administrator.'
}

if ($DataDrive.Length -eq 1) {
  $DataDrive = "$DataDrive:"
}
if ($DataDrive -notmatch '^[A-Za-z]:$') {
  throw 'DataDrive must be a drive letter such as E: or D:'
}

$driveLetter = $DataDrive.Substring(0, 1).ToUpper()
$dataRoot = "$DataDrive\VMSData"
$dbDir = "$dataRoot\db"
$recordingsDir = "$dataRoot\recordings"
$streamsDir = "$dataRoot\streams"
$snapshotsDir = "$dataRoot\snapshots"
$thumbnailsDir = "$dataRoot\thumbnails"

$dbPathEnv = "$driveLetter:/VMSData/db/vms.db"
$recordingsPathEnv = "$driveLetter:/VMSData/recordings"
$streamsPathEnv = "$driveLetter:/VMSData/streams"
$snapshotsPathEnv = "$driveLetter:/VMSData/snapshots"
$thumbnailsPathEnv = "$driveLetter:/VMSData/thumbnails"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourceRoot = (Resolve-Path (Join-Path $scriptDir '..\..')).Path

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
$launcherContent = "@echo off`r`ncd /d \"%~dp0backend\"`r`nnode server.js`r`n"
Set-Content -Path $launcherPath -Value $launcherContent -Encoding ASCII

if (-not $SkipService) {
  Write-Info "Configuring Windows service: $ServiceName"

  if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
    Write-Warn "Service $ServiceName already exists. Replacing it..."
    try { & sc.exe stop $ServiceName | Out-Null } catch {}
    Start-Sleep -Seconds 2
    & sc.exe delete $ServiceName | Out-Null
    Start-Sleep -Seconds 2
  }

  $binPath = "cmd.exe /c \"$launcherPath\""
  & sc.exe create $ServiceName "binPath= $binPath" "start= auto" "DisplayName= VMS Camera Server" | Out-Null
  & sc.exe description $ServiceName 'VMS Camera Server backend service' | Out-Null
  & sc.exe start $ServiceName | Out-Null
  Write-Ok "Service started: $ServiceName"
} else {
  Write-Warn 'SkipService was set. Service creation skipped.'
}

Write-Ok 'Installation complete.'
Write-Host ''
Write-Host "URL: http://localhost:3001" -ForegroundColor Green
Write-Host "Install path: $InstallDir" -ForegroundColor Green
Write-Host "Data path: $dataRoot" -ForegroundColor Green
Write-Host ''
Write-Host 'Default login: admin / Admin@1234 (change immediately after first login)' -ForegroundColor Yellow
