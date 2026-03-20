@echo off
setlocal

set SCRIPT_DIR=%~dp0

echo [VMS] Starting one-click Windows server installer...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-vms-server.ps1" -Mode Quick -ConfigureNow %*
if errorlevel 1 (
  echo.
  echo [VMS] Installer failed. Review the errors above.
  pause
  exit /b 1
)

echo.
echo [VMS] Installer completed successfully.
pause
