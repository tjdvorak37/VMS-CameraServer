# Windows 11 Quick Install

This is the shortest Windows 11 setup path for VMS Camera Server using the packaged installer bundle.

Use this if:
- You want the fastest install checklist.
- You are okay with default paths.
- You have an `E:` drive available for data.

If you need custom paths or installer arguments, use `README-WINDOWS-INSTALLER.md`.

---

## Quick Steps

1. Install prerequisites:
- Node.js 22 LTS
- FFmpeg in PATH
- Administrator access on the PC

2. Copy `VMS-Server-Installer.zip` to the Windows 11 machine.

3. Right-click the ZIP and click **Extract All...**

4. Open the extracted folder.

5. Run `VMS-SETUP-LAUNCHER.cmd` and choose **One-Click Server Install + Provision**.

6. Wait for the installer to finish.

7. Sign in at:
- `http://localhost:3001/login`

8. Open **Settings > Server Setup** and confirm **Public Base URL**.

9. Open `C:\VMS-CameraServer\client-onboarding` and copy that folder to each user device.

10. On each user device, run `INSTALL-VMS-CLIENT.cmd`.

11. If you later change runtime settings in **Server Setup**, restart the `VMSCameraServer` service from the Windows **Services** app.

---

## Default installer behavior

The packaged installer normally:
- installs to `C:\VMS-CameraServer`
- stores data under `E:\VMSData`
- opens Windows Firewall for TCP `3001`
- creates the `VMSCameraServer` Windows service
- auto-completes setup with admin defaults (one-click mode)
- creates a `client-onboarding` folder for user devices
- supports CSV user provisioning with forced first-login password reset

---

## Quick checks

- Browser opens `http://localhost:3001/login`
- `VMSCameraServer` shows as `Running` in Services
- You can sign in after setup
- Recordings are written to the data drive

---

## Need more detail?

- GUI walkthrough: `README-WINDOWS-11-GUI-SETUP.md`
- Advanced installer/options: `README-WINDOWS-INSTALLER.md`
