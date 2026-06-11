$ErrorActionPreference = 'Stop'
$root = Split-Path $MyInvocation.MyCommand.Path -Parent | Split-Path -Parent
Set-Location $root
Write-Host "[VMS-FIX] Working in: $root" -ForegroundColor Cyan

$bullet  = [char]0x2022
$times   = [char]0x00D7
$mojibake1 = 'a' + [char]0x00e2 + [char]0x0080 + [char]0x00a2  # â€¢ variant 1
$mojibake2 = [char]0x00c3 + [char]0x00a2 + [char]0x00e2 + [char]0x0082 + [char]0x00ac + [char]0x00c2 + [char]0x00a2

# 1. Fix browser tab title
$ix = Join-Path $root 'frontend\index.html'
if (Test-Path $ix) {
  $raw   = Get-Content $ix -Raw -Encoding UTF8
  $fixed = [regex]::Replace($raw, '<title>[^<]*</title>', '<title>VMS - Video Management System</title>')
  Set-Content -Path $ix -Value $fixed -Encoding UTF8
  Write-Host "[VMS-FIX] index.html title updated." -ForegroundColor Green
}

# 2. Fix LiveView
$lv = Join-Path $root 'frontend\src\pages\LiveView.jsx'
if (Test-Path $lv) {
  $raw = Get-Content $lv -Raw -Encoding UTF8
  $raw = $raw.Replace($bullet, '|')
  $raw = $raw.Replace($times,  'x')

  if ($raw.IndexOf('onRotate=') -lt 0) {
    $old = 'cameraRotation={camera.rotation}'
    $ins = 'cameraRotation={camera.rotation}' + "`r`n" +
           "                  onRotate={() => rotateCamera(camera)}`r`n" +
           "                  rotateDisabled={!isOperator}`r`n" +
           "                  rotateTitle={isOperator ? 'Rotate camera' : 'Rotate requires operator or admin role'}"
    $raw = $raw.Replace($old, $ins)
    Write-Host "[VMS-FIX] LiveView onRotate injected." -ForegroundColor Green
  } else {
    Write-Host "[VMS-FIX] LiveView onRotate already present." -ForegroundColor Yellow
  }

  Set-Content -Path $lv -Value $raw -Encoding UTF8
}

# 3. Fix Login placeholder
$lg = Join-Path $root 'frontend\src\pages\Login.jsx'
if (Test-Path $lg) {
  $raw = Get-Content $lg -Raw -Encoding UTF8
  $raw = $raw.Replace($bullet, '*')
  Set-Content -Path $lg -Value $raw -Encoding UTF8
}

# 4. Fix CameraManagement separator
$cm = Join-Path $root 'frontend\src\pages\CameraManagement.jsx'
if (Test-Path $cm) {
  $raw = Get-Content $cm -Raw -Encoding UTF8
  $raw = $raw.Replace($bullet, '|')
  Set-Content -Path $cm -Value $raw -Encoding UTF8
}

# 5. Verify
Write-Host ""
Select-String -Path $lv -SimpleMatch "onRotate={"     | ForEach-Object { Write-Host "  OK: rotate wired"   -ForegroundColor Green }
Select-String -Path $ix -SimpleMatch "VMS - Video"    | ForEach-Object { Write-Host "  OK: title clean"    -ForegroundColor Green }

# 6. Rebuild + redeploy
Write-Host "[VMS-FIX] Building frontend..." -ForegroundColor Cyan
npm --prefix frontend run build

Write-Host "[VMS-FIX] Redeploying nginx..." -ForegroundColor Cyan
docker compose -p vms up -d --no-deps --force-recreate nginx

Write-Host ""
Write-Host "[VMS-FIX] Done. Hard-refresh browser with Ctrl+Shift+Delete then open http://localhost:8080/live" -ForegroundColor Green
