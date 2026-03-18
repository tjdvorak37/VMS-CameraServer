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
- You have a data drive ready as `E:` if you want to use the default storage layout.

If you do not have an `E:` drive or need custom install options, use the advanced guide in `README-WINDOWS-INSTALLER.md` instead.

---

## 1. Prepare the Windows 11 machine

Before running the installer:

1. Sign in with an administrator account.
2. Install **Node.js 22 LTS** from the official Node.js website.
3. Install **FFmpeg** and make sure `ffmpeg.exe` is available from anywhere in Command Prompt.
4. Confirm the machine has enough free space for recordings.
5. If you plan to keep recordings on a second drive, make sure that drive is attached and visible in File Explorer as `E:`.

Tip:
- You can check the drive letter in **File Explorer > This PC**.
- If the drive letter is different, use the advanced installer guide instead of this GUI-only walkthrough.

---

## 2. Get the installer bundle onto the PC

On the Windows 11 machine:

1. Copy `VMS-Server-Installer.zip` onto the desktop or another easy-to-find folder.
2. Right-click the ZIP file.
3. Click **Extract All...**
4. Choose a destination folder.
5. Open the extracted folder.

Inside the extracted folder, you should see:
- `INSTALL-WINDOWS-SERVER.cmd`
- the `installer` folder
- the `backend` and `frontend` folders

Screenshot placeholder:
- File Explorer open to the extracted `VMS-Server-Installer` folder showing `INSTALL-WINDOWS-SERVER.cmd`.

---

## 3. Run the installer as Administrator

1. Right-click `INSTALL-WINDOWS-SERVER.cmd`.
2. Click **Run as administrator**.
3. If Windows shows a User Account Control prompt, click **Yes**.
4. Wait for the installer window to complete.

What the installer does:
- Copies the app into `C:\VMS-CameraServer`
- Creates storage folders under `E:\VMSData`
- Generates `.env` files with production values
- Installs backend dependencies
- Builds frontend assets if needed
- Opens Windows Firewall for TCP port `3001`
- Creates and starts the `VMSCameraServer` Windows service

Screenshot placeholder:
- Right-click menu on `INSTALL-WINDOWS-SERVER.cmd` with **Run as administrator** highlighted.

---

## 4. Confirm the Windows service is running

1. Press the Windows key.
2. Type **Services**.
3. Open the **Services** app.
4. Find `VMSCameraServer` in the list.
5. Confirm:
   - **Status** is `Running`
   - **Startup Type** is `Automatic`

If it is not running:
- Right-click the service and click **Start**.
- If it fails, rerun the installer as Administrator after checking Node.js and FFmpeg.

Screenshot placeholder:
- Services window showing `VMSCameraServer` with Status `Running` and Startup Type `Automatic`.

---

## 5. Open the app in the browser

On the Windows machine itself:
- Open your browser and go to `http://localhost:3001/setup`

From another PC on the same network:
- Open `http://<windows-pc-ip>:3001/setup`

If the page does not load:
- Confirm the `VMSCameraServer` service is running.
- Confirm Windows Firewall allowed port `3001`.
- Confirm no other app is already using port `3001`.

Screenshot placeholder:
- Browser open to `http://localhost:3001/setup` on the Windows 11 machine.

---

## 6. Complete first-run setup

The first page you should use is `/setup`, not `/login`.

In the setup wizard:

1. Create your first admin username.
2. Enter the admin email address.
3. Create a strong admin password.
4. Review retention and system limit defaults.
5. Finish setup.

After that:
- Go to `/login`
- Sign in with the admin account you just created

Important:
- The installer does **not** rely on a fixed default password anymore.
- If any old message mentions `admin / Admin@1234`, ignore it and use the setup wizard flow.

Screenshot placeholder:
- First-run setup wizard showing the admin account form.

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

## 8. Restart the service after runtime changes

If you change runtime settings in **Settings > Server Setup**, restart the service.

GUI steps:

1. Open **Services**.
2. Right-click `VMSCameraServer`.
3. Click **Restart**.

Use this after changing values such as:
- Port
- CORS origins
- Segment duration
- Environment mode

Screenshot placeholder:
- Services window context menu for `VMSCameraServer` with **Restart** visible.

---

## 9. Recommended post-install checks

After installation, verify the basics:

1. Open the dashboard successfully.
2. Add one test camera.
3. Confirm live video works.
4. Confirm recordings are written to the data drive.
5. Confirm you can log out and back in.
6. Confirm the service restarts after a reboot.

---

## 10. Troubleshooting

### Installer says Node.js is missing
- Install Node.js 22 LTS.
- Close the installer window.
- Run the installer again as Administrator.

### Installer says FFmpeg is missing
- Install FFmpeg.
- Make sure `ffmpeg.exe` is in PATH.
- Run the installer again.

### No `E:` drive exists
- Use the advanced installer guide and specify a custom data drive.

### Browser cannot open `http://localhost:3001/setup`
- Confirm `VMSCameraServer` is running.
- Confirm Windows Firewall rule exists for port `3001`.
- Confirm another app is not already using port `3001`.

### Other PCs cannot connect
- Use the Windows machine IP address instead of `localhost`.
- Confirm the PC and client are on the same network.
- Confirm port `3001` is allowed through the firewall.

---

## 11. When to use the advanced Windows guide instead

Use `README-WINDOWS-INSTALLER.md` instead of this guide if you need:
- A different install directory
- A different data drive
- A custom Windows service name
- A service-less install
- A more script-driven setup process

If you just want the shortest possible checklist, use `README-WINDOWS-11-QUICK-INSTALL.md`.

