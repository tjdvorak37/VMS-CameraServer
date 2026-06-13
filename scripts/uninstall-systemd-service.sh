#!/usr/bin/env bash

set -euo pipefail

if [[ "${EUID}" -ne 0 ]]; then
  echo "Run this script with sudo: sudo ./scripts/uninstall-systemd-service.sh"
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "systemd is not available on this host."
  exit 1
fi

SERVICE_NAME="vms-cameraserver"
SERVICE_PATH="/etc/systemd/system/${SERVICE_NAME}.service"

if systemctl list-unit-files | grep -q "^${SERVICE_NAME}\\.service"; then
  systemctl disable --now "${SERVICE_NAME}" || true
fi

if [[ -f "${SERVICE_PATH}" ]]; then
  rm -f "${SERVICE_PATH}"
fi

systemctl daemon-reload

echo "Removed ${SERVICE_NAME}."