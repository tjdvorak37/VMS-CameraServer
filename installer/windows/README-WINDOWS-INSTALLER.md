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

## Optional arguments

Run from an elevated command prompt:

```cmd
installer\windows\install-vms-server.cmd -InstallDir "D:\Apps\VMS" -DataDrive "F:" -ServiceName "VMSCameraServer"
```

Skip service creation:

```cmd
installer\windows\install-vms-server.cmd -SkipService
```
