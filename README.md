# VMS Camera Server

A professional, self-hosted Video Management System (VMS) for IP cameras — similar to Avigilon, Milestone XProtect, and iSpy/Agent DVR. Supports ONVIF camera discovery, live HLS streaming, continuous recording with 30-day retention, real-time event monitoring, user management, and remote access via a web browser.

---

## Features

| Feature | Description |
|---|---|
| **Camera Discovery** | ONVIF WS-Discovery — automatically finds IP cameras on your local network |
| **Live Streaming** | HLS streams via FFmpeg; 1×1, 2×2, 3×3, 4×4 grid layouts with expand on double-click |
| **Continuous Recording** | 10-minute MP4 segments stored locally; per-camera enable/disable |
| **30-Day Retention** | Automated nightly purge of recordings and events older than the configured threshold |
| **Event Management** | Create, filter, acknowledge, and delete events with severity levels |
| **User Management** | Role-based access (Admin / Operator / Viewer) with per-user activation |
| **First-Run Setup Wizard** | Web-based onboarding to create the first admin account and configure core limits |
| **Server Setup Panel** | Admin-managed ports, CORS, and public URL from the web UI with restart guidance |
| **Dashboard** | Live stats, 7-day recording activity chart, camera health grid |
| **Off-site Access** | Fully web-based UI accessible from any browser — works over VPN or port-forwarding |
| **Dark UI** | Professional dark theme built with Tailwind CSS |

---

## Prerequisites

| Requirement | Version |
|---|---|
| Node.js | 20.x or 22.x or 24.x |
| npm | 9+ |
| FFmpeg | Any recent version |

Install FFmpeg:
```bash
# Ubuntu / Debian
sudo apt install ffmpeg

# macOS
brew install ffmpeg
```

---

## Quick Start

### 1. Clone & run setup
```bash
git clone <repo-url>
cd VMS-CameraServer
chmod +x setup.sh && ./setup.sh
```

`setup.sh` will:
- Check Node.js and FFmpeg are installed
- Generate a `.env` file with a random `JWT_SECRET`
- Install all backend and frontend dependencies
- Create required data directories

### 2. Start in development mode
```bash
npm run dev
```

This starts the Docker stack, with nginx on port **8080** and the backend on port **3001**.

Open **http://localhost:8080** in your browser.

If you want the old local Vite/nodemon workflow, use `npm run dev:local`.

### 3. Complete the web setup wizard

On first run, the server requires setup before login.

1. Open **http://localhost:8080/setup**
2. Create your first admin account
3. Configure retention and core system limits
4. Continue to sign in using your new admin credentials

---

## Production Deployment (Docker)

### 1. Configure environment
```bash
test -f .env || cp .env.example .env
# Edit .env — set JWT_SECRET, CORS_ORIGINS, VMS_PORT, etc.
```

If `.env` already exists (for example from `setup.sh`), edit it in place instead of overwriting it.

### 2. Build and start
```bash
docker compose up -d --build
```

This builds the frontend into the nginx image, so port `8080` serves the new UI from nginx.

The application will be available on port **8080** (configurable via `VMS_PORT` in `.env`).

### 3. View logs
```bash
docker compose logs -f vms-backend
```

### 4. Keep it always running after reboot (Linux systemd)

From the project root:

```bash
chmod +x scripts/install-systemd-service.sh scripts/uninstall-systemd-service.sh
sudo ./scripts/install-systemd-service.sh
```

This creates and enables `vms-cameraserver.service`, which runs `docker compose up -d` at boot.

Useful commands:

```bash
sudo systemctl status vms-cameraserver
sudo journalctl -u vms-cameraserver -f
sudo systemctl restart vms-cameraserver
```

To remove auto-start:

```bash
sudo ./scripts/uninstall-systemd-service.sh
```

### 5. Keep it always running on Windows (PowerShell + Task Scheduler)

Run this from an elevated PowerShell window on the Windows host:

```powershell
cd V:\VMS-CameraServer
powershell -ExecutionPolicy Bypass -File .\scripts\install-startup-task.ps1 -ProjectPath "V:\VMS-CameraServer"
```

This creates a startup task named `VMS-CameraServer-Autostart` that runs:

```powershell
docker compose up -d
```

Useful commands:

```powershell
Get-ScheduledTask -TaskName 'VMS-CameraServer-Autostart'
Start-ScheduledTask -TaskName 'VMS-CameraServer-Autostart'
Unregister-ScheduledTask -TaskName 'VMS-CameraServer-Autostart' -Confirm:$false
```

### Fresh Start on V

If you are starting from scratch, use the V-drive Docker path only:

```powershell
# Run from the repo on V:\VMS-CameraServer
docker compose up -d --build
```

Then open `http://localhost:8080`.

Recommended folders:
- App source: `V:\VMS-CameraServer`
- Docker data: `V:\VMSData`

If you are on Windows, use the V-drive paths above and ignore any old server-installer guidance.

---

---

## Environment Variables

Copy `.env.example` to `.env` and adjust as needed.

| Variable | Default | Description |
|---|---|---|
| `JWT_SECRET` | *(required)* | Secret key for signing JWT tokens — use a long random string |
| `ADMIN_BOOTSTRAP_PASSWORD` | *(required on first boot)* | Password used to create the initial admin account |
| `PORT` | `3001` | Backend API port |
| `NODE_ENV` | `production` | `development` or `production` |
| `VMS_PORT` | `8080` | Public-facing nginx port (Docker only) |
| `CORS_ORIGINS` | `http://localhost:5173,http://localhost:3001` | Comma-separated allowed origins |
| `DB_PATH` | `./data/vms.db` | Path to the SQLite database file |
| `RECORDINGS_DIR` | `./data/recordings` | Directory for recorded video segments |
| `STREAMS_DIR` | `./data/streams` | Directory for HLS live stream files |
| `SNAPSHOTS_DIR` | `./data/snapshots` | Directory for camera snapshots |
| `RETENTION_DAYS` | `30` | Days of recordings to keep |
| `SEGMENT_DURATION` | `600` | Recording segment length in seconds |
| `JWT_EXPIRES_IN` | `24h` | JWT token lifetime |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                    Browser (React + Vite)                │
│   Dashboard · Live View · Recordings · Events · Users    │
└──────────────────────┬──────────────────────────────────┘
					   │ HTTP/WebSocket
┌──────────────────────▼──────────────────────────────────┐
│              Express API Server (Node.js)                │
│  Auth · Cameras · Streams · Recordings · Events · Users  │
│  ┌─────────────┐  ┌──────────────┐  ┌────────────────┐  │
│  │ StreamMgr   │  │ RecordingMgr │  │ RetentionSvc   │  │
│  │ (HLS/FFmpeg)│  │ (MP4 segs)   │  │ (cron purge)   │  │
│  └─────────────┘  └──────────────┘  └────────────────┘  │
│  ┌─────────────┐  ┌──────────────┐                       │
│  │DiscoverySvc │  │ SQLite DB    │                       │
│  │ (ONVIF UDP) │  │ (better-sql3)│                       │
│  └─────────────┘  └──────────────┘                       │
└─────────────────────────────────────────────────────────┘
					   │ RTSP
┌──────────────────────▼──────────────────────────────────┐
│              IP Cameras (ONVIF / RTSP)                   │
└─────────────────────────────────────────────────────────┘
```

### Key components

| File | Role |
|---|---|
| `backend/server.js` | Express server entry point; WebSocket; graceful shutdown |
| `backend/config/database.js` | SQLite schema init + bootstrap user/settings seeding |
| `backend/services/streamManager.js` | Starts/stops FFmpeg HLS processes per camera |
| `backend/services/recordingManager.js` | Segmented MP4 recording; syncs file system to DB at startup |
| `backend/services/discoveryService.js` | ONVIF WS-Discovery via UDP multicast probe |
| `backend/services/retentionService.js` | node-cron daily job to purge old recordings |
| `frontend/src/pages/LiveView.jsx` | Camera grid with layout switcher and HLS playback |
| `frontend/src/pages/Recordings.jsx` | Filterable list with in-browser video playback |
| `frontend/src/components/VideoPlayer.jsx` | HLS.js player with auto-retry and auth header injection |

---

## Adding Cameras

### Automatic discovery (ONVIF)
1. Go to **Camera Management** → click **Discover Cameras**
2. Cameras found on the local network will appear in the list
3. Select one and click **Add** — fill in the RTSP credentials if prompted

### Manual entry
RTSP URL formats by manufacturer:

| Manufacturer | URL Format |
|---|---|
| Hikvision | `rtsp://user:pass@<ip>:554/Streaming/Channels/101` |
| Dahua | `rtsp://user:pass@<ip>:554/cam/realmonitor?channel=1&subtype=0` |
| Axis | `rtsp://user:pass@<ip>/axis-media/media.amp` |
| Reolink | `rtsp://user:pass@<ip>:554/h264Preview_01_main` |
| Amcrest | `rtsp://user:pass@<ip>:554/cam/realmonitor?channel=1&subtype=0` |
| Generic ONVIF | `rtsp://user:pass@<ip>:554/stream1` |

---

## Off-site Access

The VMS is fully browser-based, so any of the following works:

**Option 1 — Port forwarding (simple)**  
Forward your router's external port to the VMS host on port 8080 (Docker) or 3001 (dev). Use HTTPS via a reverse proxy (Caddy, nginx, Cloudflare Tunnel) in production.

**Option 2 — VPN (recommended)**  
Run WireGuard or Tailscale on the VMS host. Remote users connect via VPN and access the internal IP/port directly — no ports exposed to the internet.

**Option 3 — Cloudflare Tunnel (zero config)**  
```bash
cloudflared tunnel --url http://localhost:8080
```

---

## User Roles

| Role | Capabilities |
|---|---|
| **Admin** | Full access: cameras, recordings, events, users, settings |
| **Operator** | View cameras, recordings, events; acknowledge events; cannot manage users or settings |
| **Viewer** | View live streams and recordings only |

---

## API Reference (summary)

All endpoints require `Authorization: Bearer <token>` except first-run setup and login routes.

| Method | Endpoint | Description |
|---|---|---|
| GET | `/api/setup/status` | Get first-run setup status |
| POST | `/api/setup/complete` | Complete first-run setup and create admin credentials |
| POST | `/api/auth/login` | Obtain JWT token |
| GET | `/api/auth/me` | Current user info |
| GET | `/api/cameras` | List all cameras |
| POST | `/api/cameras/discover` | Run ONVIF discovery |
| GET | `/api/streams/:id/live.m3u8` | HLS playlist for live view |
| GET | `/api/recordings` | List recordings (paginated) |
| GET | `/api/recordings/:id/play` | Stream recording (range requests) |
| GET | `/api/events` | List events |
| PUT | `/api/events/:id/acknowledge` | Acknowledge an event |
| GET | `/api/dashboard` | Summary stats |
| GET | `/api/users` | List users (admin) |

---

## License

MIT