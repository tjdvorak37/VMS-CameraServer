# Windows Server Installer Bundle

## What this does

`install-vms-server.cmd` installs VMS Camera Server on Windows 11/Windows Server:

- Copies app files to `C:\VMS-CameraServer`
- Uses your data drive for database and recordings (default `E:`)
- Generates `.env` with production values
- Installs backend dependencies
- Uses existing frontend dist (or builds if missing)
- Opens firewall port `3001`
- Creates and starts a Windows service (`VMSCameraServer`)
- Completes first-run setup automatically (admin + system limits)
- Applies Public Base URL and CORS values
- Builds a `client-onboarding` folder for user-device installs

## Prerequisites on target server

- Run installer as Administrator
- Node.js 22 LTS installed
- FFmpeg installed and in PATH
- 2nd data drive prepared (default `E:`)

## Default run

Double-click:

`installer\windows\install-vms-server.cmd`

This runs one-click mode (`-Mode Quick -ConfigureNow`).

For guided prompts (walkthrough mode), use:

`installer\windows\install-vms-server-walkthrough.cmd`

Or launch a branded GUI menu:

`installer\windows\vms-setup-launcher.cmd`

For a Windows 11 mouse-first walkthrough using the packaged installer bundle, see `README-WINDOWS-11-GUI-SETUP.md`.

For a shorter checklist version, see `README-WINDOWS-11-QUICK-INSTALL.md`.

## Optional arguments

Run from an elevated command prompt:

```cmd
installer\windows\install-vms-server.cmd -InstallDir "D:\Apps\VMS" -DataDrive "F:" -ServiceName "VMSCameraServer" -PublicBaseUrl "http://vms-hq:3001" -CorsOrigins "http://vms-hq:3001"
```

Skip service creation:

```cmd
installer\windows\install-vms-server.cmd -SkipService
```

Import users during setup from CSV:

```cmd
installer\windows\install-vms-server.cmd -UsersCsvPath "C:\Install\users.csv"
```

CSV schema:

```csv
username,email,password,role
operator1,operator1@company.local,ChangeMe123!,operator
viewer1,viewer1@company.local,ChangeMe123!,viewer
```

Notes for secure onboarding:
- `password` can be provided or left blank. If blank, installer generates a temporary password.
- CSV-imported users are created with `must_change_password=true` and must set a new password on first login.
- Installer writes `client-onboarding\provisioned-user-credentials.csv` for temporary credentials; distribute securely and delete after onboarding.

## After installation

1. Sign in at `http://<server-ip>:3001/login` with the configured admin credentials.
2. Review **Settings > Server Setup** and adjust runtime values if needed.
3. Open `<InstallDir>\client-onboarding`.
4. Copy that folder to each user device and run `INSTALL-VMS-CLIENT.cmd` there.

Notes:
- If you place nginx/IIS in front of the backend, use that public URL instead of `:3001`.
- If you later change runtime server values in **Settings > Server Setup**, restart the backend service.
- If you are using the packaged ZIP, you can also launch `INSTALL-WINDOWS-SERVER.cmd` from the extracted folder.
- The packaged ZIP includes `INSTALL-WINDOWS-SERVER-WALKTHROUGH.cmd` for guided prompting.
- The packaged ZIP includes `INSTALL-WINDOWS-CLIENT.cmd` for direct desktop-client install on non-server devices.
- The packaged ZIP includes `VMS-SETUP-LAUNCHER.cmd` for one-window launch options.
