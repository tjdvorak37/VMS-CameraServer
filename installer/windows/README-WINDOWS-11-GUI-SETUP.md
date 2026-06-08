# Windows 11 GUI Setup Guide

This guide is for installing VMS Camera Server on Windows 11 using mostly the graphical interface.

Use this guide if:
- You want a mouse-first walkthrough.
- You are using the packaged Windows installer bundle.
- You are okay with the default installer behavior.

This guide assumes:
- You have Administrator access on the Windows 11 machine.
- Node.js 22 LTS is installed.
- FFmpeg is installed and available in PATH.
- You have a data drive ready as `V:` if you want to use the default storage layout.

If you do not have a `V:` drive or need custom install options, use the advanced guide in `README-WINDOWS-INSTALLER.md` instead.

---

## 1. Prepare the Windows 11 machine

Before running the installer:

1. Sign in with an administrator account.
2. Install **Node.js 22 LTS** from the official Node.js website.
3. Install **FFmpeg** and make sure `ffmpeg.exe` is available from anywhere in Command Prompt.
4. Confirm the machine has enough free space for recordings.
5. If you plan to keep recordings on a second drive, make sure that drive is attached and visible in File Explorer as `V:`.

Tip:
- You can check the drive letter in **File Explorer > This PC**.
- If the drive letter is different, use the guided walkthrough or the advanced installer guide to choose another drive.

---

## 2. Get the installer bundle onto the PC

On the Windows 11 machine:

1. Copy `VMS-Server-Installer.zip` onto the desktop or another easy-to-find folder.
2. Right-click the ZIP file.
3. Click **Extract All...**
4. Choose a destination folder.
5. Open the extracted folder.

Inside the extracted folder, you should see:
- `VMS-SETUP-LAUNCHER.cmd`
- `INSTALL-WINDOWS-SERVER.cmd`
- `INSTALL-WINDOWS-SERVER-WALKTHROUGH.cmd`
- `INSTALL-WINDOWS-CLIENT.cmd`
- the `installer` folder
- the `backend` and `frontend` folders

Screenshot placeholder:
- File Explorer open to the extracted `VMS-Server-Installer` folder showing `INSTALL-WINDOWS-SERVER.cmd`.

---

## 3. Run the installer as Administrator

Fastest option:
1. Double-click `VMS-SETUP-LAUNCHER.cmd`
2. Click either **One-Click Server Install + Provision** or **Guided Server Walkthrough**

Migration option for existing hosts:
1. Double-click `VMS-SETUP-LAUNCHER.cmd`
2. Click **Migrate Existing C: Install To V: (Safe Cutover)**
3. Keep old `C:` data in place for rollback until `V:` operation is verified stable

Direct option:

1. Right-click `INSTALL-WINDOWS-SERVER.cmd`.
2. Click **Run as administrator**.
3. If Windows shows a User Account Control prompt, click **Yes**.
4. Wait for the installer window to complete.

Direct migration option:
1. Right-click `INSTALL-WINDOWS-SERVER-MIGRATE-C-TO-V.cmd`.
2. Click **Run as administrator**.
3. Wait for the migration installer window to complete.

What the installer does:
- Copies the app into `V:\VMS-CameraServer`
- Creates storage folders under `V:\VMSData`
- Generates `.env` files with production values
- Installs backend dependencies
- Builds frontend assets if needed
- Opens Windows Firewall for TCP port `3001`
- Creates and starts the Windows service (`VMSCameraServer` by default; some installs use `vmscameraserver.exe`)
- Completes initial setup automatically in one-click mode
- Generates `V:\VMS-CameraServer\client-onboarding` for user-device installs

Screenshot placeholder:
- Right-click menu on `INSTALL-WINDOWS-SERVER.cmd` with **Run as administrator** highlighted.

---

## 4. Confirm the Windows service is running

1. Press the Windows key.
2. Type **Services**.
3. Open the **Services** app.
4. Find `VMSCameraServer` (or `vmscameraserver.exe`) in the list.
5. Confirm:
   - **Status** is `Running`
   - **Startup Type** is `Automatic`

If it is not running:
- Right-click the service and click **Start**.
- If it fails, rerun the installer as Administrator after checking Node.js and FFmpeg.

Screenshot placeholder:
- Services window showing `VMSCameraServer` (or `vmscameraserver.exe`) with Status `Running` and Startup Type `Automatic`.

---

## 5. Open the app in the browser

On the Windows machine itself:
- Open your browser and go to `http://localhost:3001/login`

From another PC on the same network:
- Open `http://<windows-pc-ip>:3001/login`

If the page does not load:
- Confirm the `VMSCameraServer` or `vmscameraserver.exe` service is running.
- Confirm Windows Firewall allowed port `3001`.
- Confirm no other app is already using port `3001`.

Screenshot placeholder:
- Browser open to `http://localhost:3001/login` on the Windows 11 machine.

---

## 6. Guided walkthrough option for proprietary values

If you need prompts during install for proprietary details (admin account, URL, limits), run:

1. `INSTALL-WINDOWS-SERVER-WALKTHROUGH.cmd`
2. Fill in prompts for:
   - Data drive letter for recordings and storage
   - Admin username/email/password
   - Public base URL
   - CORS origins
   - Optional users CSV import

Use this guided mode when one-click defaults are not appropriate for your site.

---

## 7. Review server settings in the app

After signing in:

1. Open **Settings**.
2. Open the **Server Setup** section.
3. Review:
   - Node environment
   - Backend port
   - Public port
   - CORS origins
   - Public Base URL

Recommended:
- Set **Public Base URL** to the real address users will type, for example:
  - `http://frontdesk-pc:3001`
  - `https://vms.company.local`

This is especially useful for desktop client config exports.

Screenshot placeholder:
- Settings page open to the **Server Setup** section with Public Base URL visible.

---

## 8. Deploy desktop app to non-server user devices

After server install:

1. Open `V:\VMS-CameraServer\client-onboarding`
2. Copy that folder to each user PC
3. Run `INSTALL-VMS-CLIENT.cmd` on each user PC

This installs the desktop app and points it at your server automatically.

## 9. Restart the service after runtime changes

If you change runtime settings in **Settings > Server Setup**, restart the service.

GUI steps:

1. Open **Services**.
2. Right-click `VMSCameraServer` (or `vmscameraserver.exe`).
3. Click **Restart**.

Use this after changing values such as:
- Port
- CORS origins
- Segment duration
- Environment mode

Screenshot placeholder:
- Services window context menu for `VMSCameraServer` (or `vmscameraserver.exe`) with **Restart** visible.

---

## 10. Confirm auto-start after Windows updates/reboot

To ensure the host and backend recover automatically after patch reboots:

1. Open **Command Prompt** as Administrator.
2. Set your service name once:
   - `set SVC=vmscameraserver.exe`
3. Check service status:
   - `sc query %SVC%`
4. If `%SVC%` is unknown, test:
   - `sc query vmscameraserver.exe`
   - `sc query VMSCameraServer`
   - Then set `%SVC%` to the one that exists.
5. If the service is missing, rerun the installer as Administrator.
6. Optional immediate test without reboot:
   - `sc start %SVC%`

Notes:
- Windows can auto-start services/tasks after OS restarts, but cannot power on a physically powered-off machine by itself.
- For power-loss recovery, enable your BIOS/UEFI option such as **Restore on AC Power Loss**.

---

## 11. Recommended post-install checks

After installation, verify the basics:

1. Open the dashboard successfully.
2. Add one test camera.
3. Confirm live video works.
4. Confirm recordings are written to the data drive.
5. Confirm you can log out and back in.
6. Confirm the service restarts after a reboot.

---

## 12. Troubleshooting

### Installer says Node.js is missing
- Install Node.js 22 LTS.
- Close the installer window.
- Run the installer again as Administrator.

### Installer says FFmpeg is missing
- Install FFmpeg.
- Make sure `ffmpeg.exe` is in PATH.
- Run the installer again.

### No `V:` drive exists
- Use the guided walkthrough or the advanced installer guide and specify a custom data drive.

### Browser cannot open `http://localhost:3001/login`
- Confirm `VMSCameraServer` is running.
- Confirm Windows Firewall rule exists for port `3001`.
- Confirm another app is not already using port `3001`.

### Users cannot connect from desktop app
- Confirm `Public Base URL` is correct in `Settings > Server Setup`.
- Recopy the latest `client-onboarding` folder to user PCs.
- Re-run `INSTALL-VMS-CLIENT.cmd` on the user device.

### Other PCs cannot connect
- Use the Windows machine IP address instead of `localhost`.
- Confirm the PC and client are on the same network.
- Confirm port `3001` is allowed through the firewall.

---

## 13. When to use the advanced Windows guide instead

Use `README-WINDOWS-INSTALLER.md` instead of this guide if you need:
- A different install directory
- A different data drive
- A custom Windows service name
- A service-less install
- A more script-driven setup process

If you just want the shortest possible checklist, use `README-WINDOWS-11-QUICK-INSTALL.md`.

