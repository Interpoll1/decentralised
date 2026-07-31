#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────────
# InterPoll Community Relay — VPS Installer (Docker + Caddy + auto-TLS)
#
# Usage:
#   curl -fsSL https://interpoll.endless.sbs/install-relay-vps.sh | bash -s YOUR_DOMAIN
#
# Example:
#   curl -fsSL https://interpoll.endless.sbs/install-relay-vps.sh | bash -s relay.mysite.com
#
# Requirements:
#   - Ubuntu 20+ or Debian 11+ VPS
#   - A domain pointing at this server's IP (A record already set)
#   - Port 80 and 443 open
#
# What this installs:
#   - Docker + Docker Compose plugin
#   - Caddy reverse proxy (auto-TLS via Let's Encrypt)
#   - InterPoll Gun relay
#   - Systemd service for auto-restart
# ────────────────────────────────────────────────────────────────────────────────

set -euo pipefail

DOMAIN="${1:-}"
RELAY_DIR=/opt/interpoll-relay
RELAY_PORT=8765

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[interpoll]${NC} $*"; }
success() { echo -e "${GREEN}[interpoll]${NC} $*"; }
warn()    { echo -e "${YELLOW}[interpoll]${NC} $*"; }
error()   { echo -e "${RED}[interpoll]${NC} $*" >&2; exit 1; }

# ── Argument check ────────────────────────────────────────────────────────────
if [[ -z "$DOMAIN" ]]; then
  error "Usage: curl -fsSL .../install-relay-vps.sh | bash -s YOUR_DOMAIN\nExample: ... | bash -s relay.mysite.com"
fi

if [[ $EUID -ne 0 ]]; then
  error "This script must be run as root. Try: sudo bash"
fi

# ── Validate domain resolves to this server ───────────────────────────────────
info "Checking domain $DOMAIN..."
SERVER_IP=$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || echo "")
DOMAIN_IP=$(dig +short "$DOMAIN" A 2>/dev/null | head -1 || echo "")

if [[ -n "$SERVER_IP" && -n "$DOMAIN_IP" && "$SERVER_IP" != "$DOMAIN_IP" ]]; then
  warn "Domain $DOMAIN resolves to $DOMAIN_IP but this server is $SERVER_IP"
  warn "TLS certificate will fail if DNS is not pointing at this server."
  read -rp "Continue anyway? [y/N] " confirm
  [[ "${confirm,,}" == "y" ]] || exit 1
else
  success "Domain resolves correctly ✓"
fi

# ── Step 1: Docker ────────────────────────────────────────────────────────────
if command -v docker &>/dev/null; then
  success "Docker $(docker --version | awk '{print $3}' | tr -d ',') already installed ✓"
else
  info "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  success "Docker installed ✓"
fi

# ── Step 2: Create relay directory ────────────────────────────────────────────
info "Setting up relay in $RELAY_DIR..."
mkdir -p "$RELAY_DIR"/{radata,caddy-data}

# ── Step 3: Write relay.js ────────────────────────────────────────────────────
cat > "$RELAY_DIR/relay.js" << 'RELAY_EOF'
import Gun from 'gun';
import http from 'http';
import express from 'express';
import cors from 'cors';

const PORT = parseInt(process.env.PORT || '8765', 10);
const DATA_DIR = process.env.GUN_DATA_DIR || './radata';

const app = express();
app.use(cors({ origin: '*' }));
app.use(Gun.serve);
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

const server = http.createServer(app);
const gun = Gun({ web: server, file: DATA_DIR, axe: true });

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[relay] port=${PORT} data=${DATA_DIR}`);
});

process.on('SIGTERM', () => { server.close(() => process.exit(0)); });
RELAY_EOF

# ── Step 4: Write package.json ────────────────────────────────────────────────
cat > "$RELAY_DIR/package.json" << 'PKG_EOF'
{
  "name": "interpoll-relay",
  "version": "1.0.0",
  "type": "module",
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "gun": "^0.2020.1241"
  }
}
PKG_EOF

# ── Step 5: Write docker-compose.yml ─────────────────────────────────────────
cat > "$RELAY_DIR/docker-compose.yml" << COMPOSE_EOF
version: '3.9'

services:
  gun-relay:
    image: node:20-alpine
    working_dir: /app
    volumes:
      - ./relay.js:/app/relay.js
      - ./package.json:/app/package.json
      - ./radata:/app/radata
    environment:
      PORT: "${RELAY_PORT}"
      GUN_DATA_DIR: /app/radata
    expose:
      - "${RELAY_PORT}"
    restart: unless-stopped
    command: sh -c "npm install --omit=dev --silent && node relay.js"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://localhost:${RELAY_PORT}/health"]
      interval: 30s
      timeout: 5s
      retries: 3

  caddy:
    image: caddy:2-alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile
      - ./caddy-data:/data
    restart: unless-stopped
    depends_on:
      - gun-relay

COMPOSE_EOF

# ── Step 6: Write Caddyfile ───────────────────────────────────────────────────
cat > "$RELAY_DIR/Caddyfile" << CADDY_EOF
${DOMAIN} {
    reverse_proxy gun-relay:${RELAY_PORT}

    # Security headers
    header {
        X-Content-Type-Options nosniff
        X-Frame-Options DENY
        Referrer-Policy no-referrer
    }

    # CORS — Gun requires this open
    header Access-Control-Allow-Origin *
    header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    header Access-Control-Allow-Headers "Content-Type, Authorization"

    log {
        output file /data/access.log {
            roll_size 10mb
            roll_keep 5
        }
    }
}
CADDY_EOF

# ── Step 7: Open firewall ports ───────────────────────────────────────────────
if command -v ufw &>/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  info "Opening ports 80 and 443 in ufw..."
  ufw allow 80/tcp  > /dev/null
  ufw allow 443/tcp > /dev/null
  success "Firewall ports opened ✓"
fi

# ── Step 8: Start with Docker Compose ────────────────────────────────────────
info "Starting relay..."
cd "$RELAY_DIR"
docker compose up -d

# Wait for healthy
info "Waiting for relay to be healthy..."
for i in {1..30}; do
  if curl -sf "http://localhost:${RELAY_PORT}/health" &>/dev/null; then
    success "Relay is healthy ✓"
    break
  fi
  sleep 2
done

# ── Step 9: Systemd watchdog (restarts compose on reboot) ────────────────────
cat > /etc/systemd/system/interpoll-relay.service << SVCEOF
[Unit]
Description=InterPoll Community Relay (Docker Compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=${RELAY_DIR}
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
SVCEOF

systemctl daemon-reload
systemctl enable interpoll-relay

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
success "InterPoll community relay is live!"
echo ""
echo "  Your relay URL (share this with users):"
echo -e "  ${GREEN}https://${DOMAIN}/gun${NC}"
echo ""
echo "  Add it in the app:"
echo "  Settings → Network → Relay Peers → Add Peer"
echo ""
echo "  Useful commands:"
echo "    Status:   docker compose -f ${RELAY_DIR}/docker-compose.yml ps"
echo "    Logs:     docker compose -f ${RELAY_DIR}/docker-compose.yml logs -f"
echo "    Restart:  docker compose -f ${RELAY_DIR}/docker-compose.yml restart"
echo "    Update:   cd ${RELAY_DIR} && docker compose pull && docker compose up -d"
echo ""
echo "  Files are in: ${RELAY_DIR}/"
echo "  TLS certificate: managed automatically by Caddy"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
