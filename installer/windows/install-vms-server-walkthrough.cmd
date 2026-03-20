@echo off
setlocal

set SCRIPT_DIR=%~dp0
echo [VMS] Starting guided Windows server installer walkthrough...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%install-vms-server.ps1" -Mode Guided -ConfigureNow %*
if errorlevel 1 (
  echo.
  echo [VMS] Guided installer failed. Review the errors above.
  pause
  exit /b 1
)

echo.
echo [VMS] Guided installer completed successfully.
pause
