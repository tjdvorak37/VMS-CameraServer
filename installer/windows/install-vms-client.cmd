@echo off
setlocal

set SCRIPT_DIR=%~dp0
echo [VMS-CLIENT] Installing VMS Desktop Client...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-vms-client.ps1" -LaunchAfterInstall %*
if errorlevel 1 (
  echo.
  echo [VMS-CLIENT] Client install failed. Review the errors above.
  pause
  exit /b 1
)

echo.
echo [VMS-CLIENT] Client install completed successfully.
pause
