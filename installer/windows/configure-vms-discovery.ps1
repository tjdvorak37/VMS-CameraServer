param(
  [string]$InstallDir = 'V:\VMS-CameraServer',
  [string[]]$Subnets = @(),
  [int]$DiscoveryMaxHosts = 4096,
  [int]$OnvifDiscoveryTimeoutMs = 12000,
  [int]$NetworkScanTimeoutMs = 5000,
  [string]$ServiceName = 'VMSCameraServer',
  [string]$StartupTaskName = 'VMSCameraServer-Startup',
  [string[]]$TestCameraIps = @(),
  [switch]$ShowLogTail,
  [int]$LogTailLines = 120,
  [switch]$FollowLogs
)

$ErrorActionPreference = 'Stop'

function Write-Info($msg) { Write-Host "[VMS-DISCOVERY] $msg" -ForegroundColor Cyan }
function Write-Ok($msg) { Write-Host "[VMS-DISCOVERY] $msg" -ForegroundColor Green }
function Write-Warn($msg) { Write-Host "[VMS-DISCOVERY] $msg" -ForegroundColor Yellow }

function Set-OrAppendEnvKey([string]$FilePath, [string]$Key, [string]$Value) {
  if (-not (Test-Path $FilePath)) {
    throw "Missing env file: $FilePath"
  }

  $content = Get-Content $FilePath -Raw
  $pattern = "(?m)^$([regex]::Escape($Key))=.*$"
  $line = "$Key=$Value"

  if ($content -match $pattern) {
    $content = [regex]::Replace($content, $pattern, $line)
  } else {
    $trimmed = $content.TrimEnd("`r", "`n")
    if ($trimmed.Length -gt 0) {
      $content = "$trimmed`r`n$line`r`n"
    } else {
      $content = "$line`r`n"
    }
  }

  Set-Content -Path $FilePath -Value $content -Encoding UTF8
}

function Wait-ForHealth([string]$BaseUrl, [int]$TimeoutSec = 60) {
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

function Get-ScState([string]$TargetServiceName) {
  $output = @(& sc.exe query $TargetServiceName 2>&1)
  $stateLine = $output | Select-String 'STATE\s*:' | Select-Object -First 1
  if (-not $stateLine) {
    return ''
  }

  $match = [regex]::Match([string]$stateLine.Line, 'STATE\s*:\s*\d+\s+([A-Z_]+)')
  if (-not $match.Success) {
    return ''
  }

  return [string]$match.Groups[1].Value
}

function Wait-ForServiceState([string]$TargetServiceName, [string]$DesiredState, [int]$TimeoutSec = 60) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    if ((Get-ScState $TargetServiceName) -eq $DesiredState) {
      return $true
    }
    Start-Sleep -Seconds 2
  }

  return $false
}

function Restart-ServiceSafe([string]$TargetServiceName) {
  & sc.exe stop $TargetServiceName | Out-Null
  if (-not (Wait-ForServiceState -TargetServiceName $TargetServiceName -DesiredState 'STOPPED' -TimeoutSec 60)) {
    $queryEx = @(& sc.exe queryex $TargetServiceName 2>&1)
    $pidLine = $queryEx | Select-String 'PID\s*:' | Select-Object -First 1
    $servicePid = 0
    if ($pidLine) {
      $pidMatch = [regex]::Match([string]$pidLine.Line, 'PID\s*:\s*(\d+)')
      if ($pidMatch.Success) {
        $servicePid = [int]$pidMatch.Groups[1].Value
      }
    }

    if ($servicePid -gt 0 -and $servicePid -ne $PID) {
      $proc = Get-Process -Id $servicePid -ErrorAction SilentlyContinue
      if ($proc -and ($proc.ProcessName -notmatch '^(powershell|pwsh|conhost)$')) {
        Write-Warn "Service $TargetServiceName was stuck stopping; forcing PID $servicePid ($($proc.ProcessName))."
        Stop-Process -Id $servicePid -Force -ErrorAction Stop
      }
    }

    if (-not (Wait-ForServiceState -TargetServiceName $TargetServiceName -DesiredState 'STOPPED' -TimeoutSec 15)) {
      throw "Service $TargetServiceName did not reach STOPPED state."
    }
  }

  & sc.exe start $TargetServiceName | Out-Null
  if (-not (Wait-ForServiceState -TargetServiceName $TargetServiceName -DesiredState 'RUNNING' -TimeoutSec 60)) {
    throw "Service $TargetServiceName did not reach RUNNING state."
  }
}

if ($Subnets.Count -eq 0) {
  Write-Warn 'No subnets were provided. Existing DISCOVERY_SUBNETS values will remain unchanged.'
}

$rootEnv = Join-Path $InstallDir '.env'
$backendEnv = Join-Path $InstallDir 'backend\.env'
$serverLog = Join-Path $InstallDir 'backend\logs\server.log'

Write-Info "Install directory: $InstallDir"
Write-Info "Root env: $rootEnv"
Write-Info "Backend env: $backendEnv"

if (-not (Test-Path $rootEnv)) {
  throw "Could not find $rootEnv"
}
if (-not (Test-Path $backendEnv)) {
  throw "Could not find $backendEnv"
}

$subnetValue = if ($Subnets.Count -gt 0) { ($Subnets | ForEach-Object { $_.Trim() } | Where-Object { $_ } | Select-Object -Unique) -join ',' } else { $null }

$targets = @($rootEnv, $backendEnv)
foreach ($envPath in $targets) {
  if ($subnetValue) {
    Set-OrAppendEnvKey -FilePath $envPath -Key 'DISCOVERY_SUBNETS' -Value $subnetValue
  }
  Set-OrAppendEnvKey -FilePath $envPath -Key 'DISCOVERY_MAX_HOSTS' -Value ([string]$DiscoveryMaxHosts)
  Set-OrAppendEnvKey -FilePath $envPath -Key 'ONVIF_DISCOVERY_TIMEOUT' -Value ([string]$OnvifDiscoveryTimeoutMs)
  Set-OrAppendEnvKey -FilePath $envPath -Key 'NETWORK_SCAN_TIMEOUT' -Value ([string]$NetworkScanTimeoutMs)
  Write-Ok "Updated discovery settings in: $envPath"
}

if (Get-Service -Name $ServiceName -ErrorAction SilentlyContinue) {
  Write-Info "Restarting Windows service: $ServiceName"
  try {
    Restart-ServiceSafe -TargetServiceName $ServiceName
    Write-Ok "Windows service restarted: $ServiceName"
  }
  catch {
    Write-Warn "Service restart failed for '$ServiceName': $($_.Exception.Message)"
    Write-Info "Falling back to startup task: $StartupTaskName"
    $runOutput = & schtasks /Run /TN $StartupTaskName 2>&1
    if ($LASTEXITCODE -ne 0) {
      Write-Warn "Could not run startup task '$StartupTaskName'. Output: $($runOutput -join ' | ')"
    } else {
      Write-Ok "Startup task triggered: $StartupTaskName"
    }
  }
} else {
  Write-Info "Service '$ServiceName' was not found. Restarting startup task: $StartupTaskName"
  $runOutput = & schtasks /Run /TN $StartupTaskName 2>&1
  if ($LASTEXITCODE -ne 0) {
    Write-Warn "Could not run startup task '$StartupTaskName'. Output: $($runOutput -join ' | ')"
  } else {
    Write-Ok "Startup task triggered: $StartupTaskName"
  }
}

Write-Info 'Waiting for backend health check...'
if (Wait-ForHealth -BaseUrl 'http://localhost:3001' -TimeoutSec 90) {
  Write-Ok 'Backend health check passed at http://localhost:3001/api/health'
} else {
  Write-Warn 'Backend health check did not pass in time. Review backend log below.'
}

if ($TestCameraIps.Count -gt 0) {
  Write-Info 'Running connectivity checks for provided camera IPs...'
  foreach ($ip in $TestCameraIps) {
    if ([string]::IsNullOrWhiteSpace($ip)) { continue }
    $cleanIp = $ip.Trim()
    Write-Host ''
    Write-Host "--- $cleanIp ---" -ForegroundColor DarkCyan
    Test-NetConnection $cleanIp -Port 554 | Select-Object ComputerName, RemotePort, TcpTestSucceeded
    Test-NetConnection $cleanIp -Port 80 | Select-Object ComputerName, RemotePort, TcpTestSucceeded
    Test-NetConnection $cleanIp -Port 3702 | Select-Object ComputerName, RemotePort, TcpTestSucceeded
  }
}

if ($ShowLogTail -or $FollowLogs) {
  if (Test-Path $serverLog) {
    Write-Info "Showing log tail from: $serverLog"
    if ($FollowLogs) {
      Get-Content $serverLog -Tail $LogTailLines -Wait
    } else {
      Get-Content $serverLog -Tail $LogTailLines
    }
  } else {
    Write-Warn "Log file not found: $serverLog"
  }
}

Write-Host ''
Write-Host 'Next step: In the VMS UI, run Camera Discovery and watch for [Discovery] lines in backend logs.' -ForegroundColor Yellow
