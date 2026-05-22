@echo off
setlocal

set SCRIPT_DIR=%~dp0

echo [VMS] Starting migration installer (C: to V:)...
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%migrate-vms-to-v-drive.ps1" %*
if errorlevel 1 (
  echo.
  echo [VMS] Migration installer failed. Review the errors above.
  pause
  exit /b 1
)

echo.
echo [VMS] Migration installer completed successfully.
pause
