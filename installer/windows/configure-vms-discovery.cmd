@echo off
setlocal

set SCRIPT_DIR=%~dp0
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%configure-vms-discovery.ps1" %*
set EXITCODE=%ERRORLEVEL%
if not "%EXITCODE%"=="0" (
  echo [VMS-DISCOVERY] Script failed with exit code %EXITCODE%.
)
exit /b %EXITCODE%
