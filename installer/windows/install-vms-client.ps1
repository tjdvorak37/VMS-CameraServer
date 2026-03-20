param(
  [string]$ServerUrl = '',
  [string]$InstallExePath = '',
  [switch]$LaunchAfterInstall
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg) { Write-Host "[VMS-CLIENT] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[VMS-CLIENT] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[VMS-CLIENT] $msg" -ForegroundColor Yellow }

function Normalize-ServerUrl([string]$Value) {
  if ([string]::IsNullOrWhiteSpace($Value)) {
    return ''
  }

  try {
    $uri = [Uri]$Value.Trim()
  }
  catch {
    return ''
  }

  if ($uri.Scheme -ne 'http' -and $uri.Scheme -ne 'https') {
    return ''
  }

  return $uri.AbsoluteUri.TrimEnd('/')
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if ([string]::IsNullOrWhiteSpace($InstallExePath)) {
  $InstallExePath = Join-Path $scriptDir 'VMS-Desktop-Client-Setup.exe'
}

$configPath = Join-Path $scriptDir 'server-config.json'
if ((-not $ServerUrl) -and (Test-Path $configPath)) {
  try {
    $cfg = Get-Content $configPath -Raw | ConvertFrom-Json
    $ServerUrl = [string]$cfg.serverUrl
  }
  catch {
    # Ignore and continue with manual prompt.
  }
}

$ServerUrl = Normalize-ServerUrl $ServerUrl
while ([string]::IsNullOrWhiteSpace($ServerUrl)) {
  $candidate = Read-Host 'Enter VMS server URL (example: http://vms-server:3001)'
  $ServerUrl = Normalize-ServerUrl $candidate
  if ([string]::IsNullOrWhiteSpace($ServerUrl)) {
    Write-Warn 'Please enter a valid http:// or https:// URL.'
  }
}

if (-not (Test-Path $InstallExePath)) {
  throw "Desktop installer not found: $InstallExePath"
}

Write-Info 'Running desktop client installer silently...'
$proc = Start-Process -FilePath $InstallExePath -ArgumentList '/S' -Wait -PassThru
if ($proc.ExitCode -ne 0) {
  throw "Desktop installer failed with exit code $($proc.ExitCode)"
}

$appDataConfigDir = Join-Path $env:APPDATA 'vms-desktop-client'
New-Item -Path $appDataConfigDir -ItemType Directory -Force | Out-Null

$configJson = @{
  serverUrl = $ServerUrl
} | ConvertTo-Json -Depth 4

Set-Content -Path (Join-Path $appDataConfigDir 'config.json') -Value $configJson -Encoding UTF8
Write-Ok "Desktop client configured for server: $ServerUrl"

if ($LaunchAfterInstall) {
  $candidatePaths = @(
    (Join-Path $env:ProgramFiles 'VMS Desktop Client\VMS-Desktop-Client.exe'),
    (Join-Path $env:ProgramFiles 'VMS-Desktop-Client\VMS-Desktop-Client.exe'),
    (Join-Path $env:LOCALAPPDATA 'Programs\VMS Desktop Client\VMS-Desktop-Client.exe')
  )

  foreach ($path in $candidatePaths) {
    if (Test-Path $path) {
      Start-Process -FilePath $path | Out-Null
      Write-Ok 'Desktop client launched.'
      break
    }
  }
}
