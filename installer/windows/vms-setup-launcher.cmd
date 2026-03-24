@echo off
setlocal
set SCRIPT_DIR=%~dp0
powershell -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT_DIR%vms-setup-launcher.ps1"
if errorlevel 1 (
	echo.
	echo [VMS] Setup launcher failed to start. Review errors above.
	pause
	exit /b 1
)
endlocal
