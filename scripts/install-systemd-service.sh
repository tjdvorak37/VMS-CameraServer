#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo: sudo ./scripts/install-systemd-service.sh"
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not in PATH."
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd is not available on this host."
  exit 1
fi

DOCKER_BIN="$(command -v docker)"
SERVICE_NAME="vms-cameraserver"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cat > "${SERVICE_PATH}" <<EOF
[Unit]
Description=VMS Camera Server (Docker Compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${PROJECT_ROOT}
ExecStart=${DOCKER_BIN} compose up -d
ExecStop=${DOCKER_BIN} compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now "${SERVICE_NAME}"

echo "Installed and started ${SERVICE_NAME}."
echo
echo "Check status:"
echo "  sudo systemctl status ${SERVICE_NAME}"
echo "Follow logs:"
echo "  sudo journalctl -u ${SERVICE_NAME} -f"