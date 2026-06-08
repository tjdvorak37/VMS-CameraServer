@echo off
setlocal

set SCRIPT_DIR=%~dp0
set INSTALLER_PS1=%SCRIPT_DIR%install-vms-server.ps1

if not exist "%INSTALLER_PS1%" (
  echo [VMS] ERROR: Guided installer script not found:
  echo [VMS] %INSTALLER_PS1%
  echo [VMS] Run this command from the extracted VMS-Server-Installer folder using INSTALL-WINDOWS-SERVER-WALKTHROUGH.cmd.
  pause
  exit /b 1
)

echo [VMS] Starting guided Windows server installer walkthrough...
powershell -NoProfile -ExecutionPolicy Bypass -File "%INSTALLER_PS1%" -Mode Guided -ConfigureNow %*
set PS_EXIT=%ERRORLEVEL%
if not "%PS_EXIT%"=="0" (
  echo.
  echo [VMS] Guided installer failed with exit code %PS_EXIT%. Review the errors above.
  pause
  exit /b 1
)

echo.
echo [VMS] Guided installer completed successfully.
pause
