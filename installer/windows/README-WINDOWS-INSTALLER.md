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

## Prerequisites on target server

- Run installer as Administrator
- Node.js 22 LTS installed
- FFmpeg installed and in PATH
- 2nd data drive prepared (default `E:`)

## Default run

Double-click:

`installer\windows\install-vms-server.cmd`

For a Windows 11 mouse-first walkthrough using the packaged installer bundle, see `README-WINDOWS-11-GUI-SETUP.md`.

For a shorter checklist version, see `README-WINDOWS-11-QUICK-INSTALL.md`.

## Optional arguments

Run from an elevated command prompt:

```cmd
installer\windows\install-vms-server.cmd -InstallDir "D:\Apps\VMS" -DataDrive "F:" -ServiceName "VMSCameraServer"
```

Skip service creation:

```cmd
installer\windows\install-vms-server.cmd -SkipService
```

## After installation

1. Open `http://<server-ip>:3001/setup` in a browser.
2. Complete the first-run setup wizard to create the initial admin account.
3. Sign in at `http://<server-ip>:3001/login` with the credentials you configured.

Notes:
- If you place nginx/IIS in front of the backend, use that public URL instead of `:3001`.
- If you later change runtime server values in **Settings > Server Setup**, restart the backend service.
- If you are using the packaged ZIP, you can also launch `INSTALL-WINDOWS-SERVER.cmd` from the extracted folder.
