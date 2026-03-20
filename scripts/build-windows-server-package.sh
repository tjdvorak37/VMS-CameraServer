#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_ROOT="$ROOT_DIR/dist/windows-server-installer"
PKG_NAME="VMS-Server-Installer"
PKG_DIR="$OUT_ROOT/$PKG_NAME"
ZIP_PATH="$OUT_ROOT/${PKG_NAME}.zip"

echo "[VMS] Building frontend assets..."
npm --prefix "$ROOT_DIR/frontend" run build >/dev/null

echo "[VMS] Preparing package directory..."
rm -rf "$OUT_ROOT"
mkdir -p "$PKG_DIR"

cp -R \
  "$ROOT_DIR/backend" \
  "$ROOT_DIR/frontend" \
  "$ROOT_DIR/installer" \
  "$ROOT_DIR/docker-compose.yml" \
  "$ROOT_DIR/nginx.conf" \
  "$ROOT_DIR/package.json" \
  "$ROOT_DIR/package-lock.json" \
  "$ROOT_DIR/.env.example" \
  "$ROOT_DIR/README.md" \
  "$ROOT_DIR/setup.sh" \
  "$PKG_DIR/"

if [[ -f "$ROOT_DIR/desktop-client/dist/VMS-Desktop-Client-Setup.exe" ]]; then
  mkdir -p "$PKG_DIR/desktop-client"
  cp "$ROOT_DIR/desktop-client/dist/VMS-Desktop-Client-Setup.exe" "$PKG_DIR/desktop-client/"
fi

rm -rf \
  "$PKG_DIR/backend/node_modules" \
  "$PKG_DIR/frontend/node_modules" \
  "$PKG_DIR/node_modules" \
  "$PKG_DIR/.git"

cat > "$PKG_DIR/INSTALL-WINDOWS-SERVER.cmd" <<'EOF'
@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\windows\install-vms-server.ps1" -Mode Quick -ConfigureNow
endlocal
EOF

cat > "$PKG_DIR/INSTALL-WINDOWS-SERVER-WALKTHROUGH.cmd" <<'EOF'
@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\windows\install-vms-server.ps1" -Mode Guided -ConfigureNow
endlocal
EOF

cat > "$PKG_DIR/INSTALL-WINDOWS-CLIENT.cmd" <<'EOF'
@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\windows\install-vms-client.ps1" -LaunchAfterInstall
endlocal
EOF

cat > "$PKG_DIR/VMS-SETUP-LAUNCHER.cmd" <<'EOF'
@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0installer\windows\vms-setup-launcher.ps1"
endlocal
EOF

chmod +x "$PKG_DIR/INSTALL-WINDOWS-SERVER.cmd" || true
chmod +x "$PKG_DIR/INSTALL-WINDOWS-SERVER-WALKTHROUGH.cmd" || true
chmod +x "$PKG_DIR/INSTALL-WINDOWS-CLIENT.cmd" || true
chmod +x "$PKG_DIR/VMS-SETUP-LAUNCHER.cmd" || true

echo "[VMS] Creating zip archive..."
mkdir -p "$OUT_ROOT"
(
  cd "$OUT_ROOT"
  zip -rq "${PKG_NAME}.zip" "$PKG_NAME"
)

echo "[VMS] Package created: $ZIP_PATH"
sha256sum "$ZIP_PATH"
