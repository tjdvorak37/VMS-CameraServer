#!/usr/bin/env bash
set -e

# ─── Colors ─────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; NC='\033[0m'
info()    { echo -e "${BLUE}[VMS]${NC} $*"; }
success() { echo -e "${GREEN}[VMS]${NC} $*"; }
warn()    { echo -e "${YELLOW}[VMS]${NC} $*"; }
error()   { echo -e "${RED}[VMS]${NC} $*"; exit 1; }

echo ""
echo -e "${BLUE}╔═══════════════════════════════════════════╗${NC}"
echo -e "${BLUE}║   VMS Pro - Video Management System       ║${NC}"
echo -e "${BLUE}║   Setup Script v1.0.0                     ║${NC}"
echo -e "${BLUE}╚═══════════════════════════════════════════╝${NC}"
echo ""

# ─── Prerequisites ───────────────────────────────────────────────────────────
info "Checking prerequisites..."

command -v node >/dev/null 2>&1 || error "Node.js is required. Install from https://nodejs.org/"
command -v npm  >/dev/null 2>&1 || error "npm is required."

NODE_VERSION=$(node -v | cut -d'.' -f1 | tr -d 'v')
if [ "$NODE_VERSION" -lt 18 ]; then
  error "Node.js 18+ is required (found $(node -v))"
fi

if ! command -v ffmpeg >/dev/null 2>&1; then
  warn "FFmpeg not found — live streaming and recording will not work."
  warn "Install FFmpeg: https://ffmpeg.org/download.html"
  warn "  Ubuntu/Debian: sudo apt install ffmpeg"
  warn "  macOS:         brew install ffmpeg"
else
  success "FFmpeg found: $(ffmpeg -version 2>&1 | head -1)"
fi

success "Node.js $(node -v) OK"

# ─── Environment file ────────────────────────────────────────────────────────
if [ ! -f .env ]; then
  info "Creating .env from .env.example..."
  cp .env.example .env
  # Generate a random JWT secret
  if command -v openssl >/dev/null 2>&1; then
    SECRET=$(openssl rand -hex 32)
    sed -i "s/change-me-to-a-very-long-random-secret-in-production/$SECRET/g" .env
    success "Generated secure JWT secret"
  else
    warn "openssl not found — please manually update JWT_SECRET in .env"
  fi
else
  info ".env already exists, skipping..."
fi

# ─── Install dependencies ────────────────────────────────────────────────────
info "Installing backend dependencies..."
cd backend && npm install
cd ..

info "Installing frontend dependencies..."
cd frontend && npm install
cd ..

info "Installing root dev dependencies..."
npm install --no-save concurrently 2>/dev/null || true

# ─── Create data directories ─────────────────────────────────────────────────
info "Creating data directories..."
mkdir -p backend/data/recordings backend/data/streams backend/data/snapshots backend/data/thumbnails

# ─── Summary ─────────────────────────────────────────────────────────────────
echo ""
success "Setup complete!"
echo ""
echo -e "  Start development:   ${BLUE}npm run dev${NC}"
echo -e "  Backend only:        ${BLUE}npm run dev:backend${NC}   → http://localhost:3001"
echo -e "  Frontend only:       ${BLUE}npm run dev:frontend${NC}  → http://localhost:5173"
echo -e "  Production build:    ${BLUE}npm run build && npm start${NC}"
echo -e "  Docker deployment:   ${BLUE}npm run docker:build${NC}"
echo ""
echo -e "  Default credentials: ${YELLOW}admin / Admin@1234${NC}"
echo -e "  ${RED}⚠ Change the default password after first login!${NC}"
echo ""
