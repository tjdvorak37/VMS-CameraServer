@echo off
setlocal

set SCRIPT_DIR=%~dp0
set CUTOVER_PS1=%SCRIPT_DIR%switch-vms-to-docker.ps1

if not exist "%CUTOVER_PS1%" (
  echo [VMS] ERROR: Cutover script not found:
  echo [VMS] %CUTOVER_PS1%
  pause
  exit /b 1
)

echo [VMS] Starting Docker cutover installer...
powershell -NoProfile -ExecutionPolicy Bypass -File "%CUTOVER_PS1%" %*
set PS_EXIT=%ERRORLEVEL%
if not "%PS_EXIT%"=="0" (
  echo.
  echo [VMS] Docker cutover failed with exit code %PS_EXIT%.
  pause
  exit /b 1
)

echo.
echo [VMS] Docker cutover completed successfully.
pause
