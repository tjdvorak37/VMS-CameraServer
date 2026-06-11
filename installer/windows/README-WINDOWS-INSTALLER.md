# Windows Server Installer Bundle

## What this does

`install-vms-server.cmd` installs VMS Camera Server on Windows 11/Windows Server:

- Copies app files to `V:\VMS-CameraServer`
- Keeps the backend and launcher on `V:\VMS-CameraServer`
- Uses your data drive for database and recordings (default `V:`)
- Generates `.env` with production values
- Installs backend dependencies
- Uses existing frontend dist (or builds if missing)
- Opens firewall port `3001`
- Creates and starts a Windows service (`VMSCameraServer` by default; some installs use `vmscameraserver.exe`)
- Uses a real Windows service wrapper so the backend starts under Service Control Manager supervision
- Completes first-run setup automatically (admin + system limits)
- Applies Public Base URL and CORS values
- Builds a `client-onboarding` folder for user-device installs

`install-vms-server-migrate.cmd` performs a safe C: to V: migration cutover for existing installs.

## Prerequisites on target server

- Run installer as Administrator
- Node.js 22 LTS installed
- FFmpeg installed and in PATH
- Data drive prepared for storage (default `V:`)

## Default run

Double-click:

`installer\windows\install-vms-server.cmd`

This runs one-click mode (`-Mode Quick -ConfigureNow`).

One-click mode uses `V:\VMS-CameraServer` for the app and `V:\VMSData` for the database, recordings, streams, snapshots, and thumbnails.

For guided prompts (walkthrough mode), use:

`installer\windows\install-vms-server-walkthrough.cmd`

For existing installs currently on `C:`, use:

`installer\windows\install-vms-server-migrate.cmd`

Or launch a branded GUI menu:

`installer\windows\vms-setup-launcher.cmd`

From that same menu, use `Switch To Docker Deployment` to launch the Docker cutover flow without typing commands.

Guided mode prompts for the data drive, and scripted runs can override it with `-DataDrive`.

For a Windows 11 mouse-first walkthrough using the packaged installer bundle, see `README-WINDOWS-11-GUI-SETUP.md`.

For a shorter checklist version, see `README-WINDOWS-11-QUICK-INSTALL.md`.

## Optional arguments

Run from an elevated command prompt:

```cmd
installer\windows\install-vms-server.cmd -InstallDir "V:\VMS-CameraServer" -DataDrive "V:" -ServiceName "VMSCameraServer" -PublicBaseUrl "http://vms-hq:3001" -CorsOrigins "http://vms-hq:3001"
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

## Auto-start after reboot

The preferred path is Windows service auto-start. Use one variable so commands work for either service name:

```cmd
set SVC=vmscameraserver.exe
sc query %SVC%
```

If needed, detect available names first:

```cmd
sc query vmscameraserver.exe
sc query VMSCameraServer
```

If the installer reports a startup error, restart the service and check the backend log at `backend\logs\server.log`.

Validate service status with:

```cmd
sc query %SVC%
```

Manual service restart on existing installs:

```cmd
sc stop %SVC%
sc start %SVC%
```

Notes:
- If you place nginx/IIS in front of the backend, use that public URL instead of `:3001`.
- If you later change runtime server values in **Settings > Server Setup**, restart the service.
- If you are using the packaged ZIP, you can also launch `INSTALL-WINDOWS-SERVER.cmd` from the extracted folder.
- The packaged ZIP includes `INSTALL-WINDOWS-SERVER-WALKTHROUGH.cmd` for guided prompting.
- The packaged ZIP includes `INSTALL-WINDOWS-CLIENT.cmd` for direct desktop-client install on non-server devices.
- The packaged ZIP includes `VMS-SETUP-LAUNCHER.cmd` for one-window launch options.

Troubleshooting:
- If `run-vms-server.cmd` reports that the file is being used by another process, the backend is usually already running under the Windows service. Stop it with `sc stop %SVC%` before launching the batch file directly.

## Migration from C: to V:

Use the migration script when you already have an older Windows install on `C:` and want to safely cut over to `V:`.

Default run (elevated command prompt):

```cmd
installer\windows\migrate-vms-to-v-drive.cmd
```

Installer-style entry point (same migration flow):

```cmd
installer\windows\install-vms-server-migrate.cmd
```

Direct PowerShell run with explicit paths:

```powershell
powershell -ExecutionPolicy Bypass -File installer\windows\migrate-vms-to-v-drive.ps1 `
	-SourceInstallDir "C:\VMS-CameraServer" `
	-TargetInstallDir "V:\VMS-CameraServer" `
	-SourceDataDir "C:\VMSData" `
	-TargetDataDir "V:\VMSData" `
	-ServiceName "vmscameraserver.exe"
```

What it does:
- Stops VMS service/tasks and stray Node backend processes.
- Copies app files to `V:\VMS-CameraServer` (excluding node_modules/build artifacts).
- Copies data from `C:\VMSData` and legacy `backend\data` into `V:\VMSData`.
- Normalizes `.env` and `backend\.env` storage paths to `V:/VMSData/...`.
- Rebinds and starts the backend via the Windows service that runs `V:\VMS-CameraServer\backend\server.js`.
- Verifies `http://localhost:3001/api/health`.

Safe-ops note:
- The migration script does not delete old `C:` data. Keep it until you verify stable operation on `V:`.

## Quick discovery tuning script (PowerShell)

If camera discovery is not finding devices, run this from an elevated terminal on the server:

```powershell
powershell -ExecutionPolicy Bypass -File installer\windows\configure-vms-discovery.ps1 `
	-InstallDir "V:\VMS-CameraServer" `
	-Subnets "192.168.10.0/24","192.168.20.0/24" `
	-DiscoveryMaxHosts 4096 `
	-OnvifDiscoveryTimeoutMs 12000 `
	-NetworkScanTimeoutMs 5000 `
	-TestCameraIps "192.168.10.50" `
	-ShowLogTail
```

CMD wrapper version:

```cmd
installer\windows\configure-vms-discovery.cmd -InstallDir "V:\VMS-CameraServer" -Subnets "192.168.10.0/24","192.168.20.0/24" -DiscoveryMaxHosts 4096 -OnvifDiscoveryTimeoutMs 12000 -NetworkScanTimeoutMs 5000 -TestCameraIps "192.168.10.50" -ShowLogTail
```

This script updates both `V:\VMS-CameraServer\.env` and `V:\VMS-CameraServer\backend\.env`, restarts the configured service name (for example `VMSCameraServer` or `vmscameraserver.exe`), checks health at `http://localhost:3001/api/health`, and can test camera reachability on ports `554`, `80`, and `3702`.

## Docker-first cutover on Windows (recommended for update stability)

If your machine has a mixed/legacy setup (manual Node + service + Docker), switch to one consistent deployment model:

```powershell
powershell -ExecutionPolicy Bypass -File installer\windows\switch-vms-to-docker.ps1 `
	-InstallDir "V:\VMS-CameraServer" `
	-DataRoot "V:\VMSData" `
	-PublicPort 8080
```

CMD launcher:

```cmd
installer\windows\switch-vms-to-docker.cmd
```

You can also start the same flow from the GUI menu with `Switch To Docker Deployment`.

The cutover script:
- Removes old Windows service installs (`VMSCameraServer`, `vmscameraserver.exe`) and startup task.
- Stops stale backend `node.exe` processes.
- Configures `.env` with Docker runtime values, including `VMS_DATA_ROOT`.
- Rebuilds frontend assets for nginx.
- Recreates Docker stack cleanly (`docker compose down --remove-orphans`, then `up -d --build`).

Optional old-path archive cleanup:

```powershell
powershell -ExecutionPolicy Bypass -File installer\windows\switch-vms-to-docker.ps1 -RemoveLegacyInstall
```
