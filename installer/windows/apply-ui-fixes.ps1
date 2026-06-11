#Requires -Version 5.1
<#
.SYNOPSIS
  Applies all VMS UI source fixes, rebuilds frontend, and redeploys nginx.
  Run this from V:\VMS-CameraServer in an Admin PowerShell.
#>

$ErrorActionPreference = 'Stop'
$root   = Split-Path $MyInvocation.MyCommand.Path -Parent | Split-Path -Parent
Set-Location $root

Write-Host "[VMS-FIX] Working in: $root" -ForegroundColor Cyan

# ── 1. Fix browser tab title ────────────────────────────────────────────────
$ix = Join-Path $root 'frontend\index.html'
if (Test-Path $ix) {
  $raw = Get-Content $ix -Raw
  $fixed = [regex]::Replace($raw, '<title>[^<]*</title>', '<title>VMS - Video Management System</title>')
  if ($fixed -ne $raw) {
    Set-Content -Path $ix -Value $fixed -Encoding UTF8
    Write-Host "[VMS-FIX] index.html title fixed." -ForegroundColor Green
  } else {
    Write-Host "[VMS-FIX] index.html title already clean." -ForegroundColor Yellow
  }
}

# ── 2. Fix LiveView separators and wire rotate props ────────────────────────
$lv = Join-Path $root 'frontend\src\pages\LiveView.jsx'
if (Test-Path $lv) {
  $raw = Get-Content $lv -Raw -Encoding UTF8

  # Replace mojibake/unicode bullet with pipe
  $raw = $raw.Replace([char]0x2022, '|')         # •
  $raw = $raw.Replace('â€¢', '|')
  $raw = $raw.Replace([char]0x00D7, 'x')         # × multiplication sign in resolution

  # Inject rotate props into VideoPlayer if missing
  if ($raw.IndexOf('onRotate={() => rotateCamera(camera)}') -lt 0) {
    $old = 'cameraRotation={camera.rotation}'
    $new = @"
cameraRotation={camera.rotation}
                  onRotate={() => rotateCamera(camera)}
                  rotateDisabled={!isOperator}
                  rotateTitle={isOperator ? 'Rotate camera' : 'Rotate requires operator or admin role'}
"@
    $raw = $raw.Replace($old, $new.Trim([System.Environment]::NewLine.ToCharArray()))
    Write-Host "[VMS-FIX] LiveView onRotate props injected." -ForegroundColor Green
  } else {
    Write-Host "[VMS-FIX] LiveView onRotate already present." -ForegroundColor Yellow
  }

  Set-Content -Path $lv -Value $raw -Encoding UTF8
}

# ── 3. Fix Login page separator/password placeholder ────────────────────────
$lg = Join-Path $root 'frontend\src\pages\Login.jsx'
if (Test-Path $lg) {
  $raw = Get-Content $lg -Raw -Encoding UTF8
  $raw = $raw.Replace([char]0x2022, '*')
  $raw = $raw.Replace('â€¢', '*')
  Set-Content -Path $lg -Value $raw -Encoding UTF8
}

# ── 4. Fix CameraManagement separator ───────────────────────────────────────
$cm = Join-Path $root 'frontend\src\pages\CameraManagement.jsx'
if (Test-Path $cm) {
  $raw = Get-Content $cm -Raw -Encoding UTF8
  $raw = $raw.Replace([char]0x2022, '|')
  $raw = $raw.Replace('â€¢', '|')
  Set-Content -Path $cm -Value $raw -Encoding UTF8
}

# ── 5. Verify patches ────────────────────────────────────────────────────────
Write-Host ""
Write-Host "[VMS-FIX] Verification:" -ForegroundColor Cyan
Select-String -Path $lv  -SimpleMatch "onRotate={() => rotateCamera(camera)}" | ForEach-Object { Write-Host "  OK: LiveView onRotate wired" -ForegroundColor Green }
Select-String -Path $ix  -SimpleMatch "VMS - Video Management System"         | ForEach-Object { Write-Host "  OK: Tab title clean"          -ForegroundColor Green }

# ── 6. Rebuild frontend ──────────────────────────────────────────────────────
Write-Host ""
Write-Host "[VMS-FIX] Building frontend..." -ForegroundColor Cyan
npm --prefix frontend run build

# ── 7. Redeploy nginx ────────────────────────────────────────────────────────
Write-Host "[VMS-FIX] Redeploying nginx..." -ForegroundColor Cyan
docker compose -p vms up -d --no-deps --force-recreate nginx

Write-Host ""
Write-Host "[VMS-FIX] Done. Open http://localhost:8080/live and press Ctrl+Shift+Delete to clear browser cache." -ForegroundColor Green
