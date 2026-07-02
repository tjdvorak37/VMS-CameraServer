param(
    [string]$ProjectPath = "",
    [switch]$FullRebuild
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ([string]::IsNullOrWhiteSpace($ProjectPath)) {
    $ProjectPath = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
} else {
    $ProjectPath = (Resolve-Path $ProjectPath).Path
}

Write-Host ""
Write-Host "=== VMS-CameraServer Update ===" -ForegroundColor Cyan
Write-Host "Project: $ProjectPath"
Write-Host ""

Set-Location $ProjectPath

# --- Git pull ---
Write-Host "[1/3] Pulling latest code from GitHub..." -ForegroundColor Yellow
$before = git rev-parse HEAD 2>$null
git pull origin main
$after = git rev-parse HEAD 2>$null

if ($before -eq $after -and -not $FullRebuild) {
    Write-Host "Already up to date. No rebuild needed." -ForegroundColor Green
    Write-Host ""
    Write-Host "Tip: Use -FullRebuild to force a rebuild anyway."
    exit 0
}

# Detect if frontend changed
$frontendChanged = $FullRebuild -or (git diff --name-only $before $after 2>$null | Where-Object { $_ -like "frontend/*" })
$backendChanged  = $FullRebuild -or (git diff --name-only $before $after 2>$null | Where-Object { $_ -like "backend/*" })

# --- Rebuild ---
Write-Host ""
Write-Host "[2/3] Rebuilding containers..." -ForegroundColor Yellow

if ($frontendChanged) {
    Write-Host "  Frontend changed — rebuilding nginx..." -ForegroundColor Gray
    docker compose build --no-cache nginx
} else {
    Write-Host "  No frontend changes — skipping nginx rebuild." -ForegroundColor Gray
}

if ($backendChanged) {
    Write-Host "  Backend changed — rebuilding backend..." -ForegroundColor Gray
    docker compose build --no-cache backend
} else {
    Write-Host "  No backend changes — skipping backend rebuild." -ForegroundColor Gray
}

# --- Restart ---
Write-Host ""
Write-Host "[3/3] Restarting services..." -ForegroundColor Yellow
docker compose up -d

Write-Host ""
Write-Host "=== Done! ===" -ForegroundColor Green
Write-Host "Hard-refresh your browser (Ctrl+Shift+R) to see changes."
Write-Host ""
