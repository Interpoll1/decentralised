#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────────
# InterPoll Community Relay — Home Server Installer
# Supports: Ubuntu 20+, Debian 11+, Raspberry Pi OS (Bullseye / Bookworm)
#
# What this script does:
#   1. Installs Node.js 20 LTS via NodeSource (if not already installed)
#   2. Creates /opt/interpoll-relay with relay.js and package.json
#   3. Installs the relay as a systemd service (auto-starts on reboot)
#   4. Prints your local relay URL
#
# Usage:
#   curl -fsSL https://interpoll.endless.sbs/install-relay.sh | bash
#
# To uninstall:
#   sudo systemctl stop interpoll-relay && sudo systemctl disable interpoll-relay
#   sudo rm -rf /opt/interpoll-relay /etc/systemd/system/interpoll-relay.service
# ────────────────────────────────────────────────────────────────────────────────

set -euo pipefail

RELAY_PORT=8765
RELAY_DIR=/opt/interpoll-relay
SERVICE_NAME=interpoll-relay

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

info()    { echo -e "${BLUE}[interpoll]${NC} $*"; }
success() { echo -e "${GREEN}[interpoll]${NC} $*"; }
warn()    { echo -e "${YELLOW}[interpoll]${NC} $*"; }
error()   { echo -e "${RED}[interpoll]${NC} $*" >&2; exit 1; }

# ── Root check ────────────────────────────────────────────────────────────────
if [[ $EUID -ne 0 ]]; then
  warn "Not running as root — will use sudo for system commands"
  SUDO=sudo
else
  SUDO=""
fi

# ── OS check ──────────────────────────────────────────────────────────────────
if ! command -v apt-get &>/dev/null; then
  error "This installer requires a Debian/Ubuntu-based system (apt-get not found)."
fi

info "Starting InterPoll relay installer..."
echo ""

# ── Step 1: Node.js ───────────────────────────────────────────────────────────
if command -v node &>/dev/null; then
  NODE_VER=$(node --version | sed 's/v//' | cut -d. -f1)
  if [[ "$NODE_VER" -ge 18 ]]; then
    success "Node.js $(node --version) already installed ✓"
  else
    warn "Node.js $(node --version) is too old (need 18+). Upgrading..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
    $SUDO apt-get install -y nodejs
  fi
else
  info "Installing Node.js 20 LTS..."
  curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash -
  $SUDO apt-get install -y nodejs
  success "Node.js $(node --version) installed ✓"
fi

# ── Step 2: Create relay directory ────────────────────────────────────────────
info "Setting up relay in $RELAY_DIR..."
$SUDO mkdir -p "$RELAY_DIR"
$SUDO chown -R "${USER:-root}:${USER:-root}" "$RELAY_DIR" 2>/dev/null || true

# ── Step 3: Write relay.js ────────────────────────────────────────────────────
cat > "$RELAY_DIR/relay.js" << 'RELAY_EOF'
import Gun from 'gun';
import http from 'http';
import express from 'express';
import cors from 'cors';

const PORT = parseInt(process.env.PORT || '8765', 10);
const DATA_DIR = process.env.GUN_DATA_DIR || './radata';

const app = express();

// Gun requires open CORS — it uses long-polling as a fallback transport
app.use(cors({ origin: '*' }));
app.use(Gun.serve);

// Health check endpoint (used by the app to probe relay status)
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', peers: Object.keys(gun?._.opt?.peers || {}).length });
});

const server = http.createServer(app);

const gun = Gun({
  web: server,
  file: DATA_DIR,
  axe: true,        // join the AXE peer-relay mesh
  multicast: false, // LAN multicast off by default (enable if all peers are on LAN)
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[InterPoll relay] Running on port ${PORT}`);
  console.log(`[InterPoll relay] Gun data: ${DATA_DIR}`);
});

process.on('SIGTERM', () => { server.close(); process.exit(0); });
process.on('SIGINT',  () => { server.close(); process.exit(0); });
RELAY_EOF

# ── Step 4: Write package.json ────────────────────────────────────────────────
cat > "$RELAY_DIR/package.json" << 'PKG_EOF'
{
  "name": "interpoll-community-relay",
  "version": "1.0.0",
  "type": "module",
  "main": "relay.js",
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "gun": "^0.2020.1241"
  }
}
PKG_EOF

# ── Step 5: npm install ───────────────────────────────────────────────────────
info "Installing relay dependencies..."
cd "$RELAY_DIR"
npm install --omit=dev --silent
success "Dependencies installed ✓"

# ── Step 6: systemd service ───────────────────────────────────────────────────
info "Installing as a system service..."

$SUDO tee /etc/systemd/system/${SERVICE_NAME}.service > /dev/null << SERVICE_EOF
[Unit]
Description=InterPoll Community Gun Relay
After=network.target

[Service]
Type=simple
User=${USER:-nobody}
WorkingDirectory=${RELAY_DIR}
Environment=PORT=${RELAY_PORT}
Environment=GUN_DATA_DIR=${RELAY_DIR}/radata
ExecStart=$(command -v node) ${RELAY_DIR}/relay.js
Restart=on-failure
RestartSec=5
StandardOutput=journal
StandardError=journal
SyslogIdentifier=interpoll-relay

[Install]
WantedBy=multi-user.target
SERVICE_EOF

$SUDO systemctl daemon-reload
$SUDO systemctl enable "$SERVICE_NAME"
$SUDO systemctl start  "$SERVICE_NAME"

sleep 2

if $SUDO systemctl is-active --quiet "$SERVICE_NAME"; then
  success "Service is running ✓"
else
  error "Service failed to start. Check logs: journalctl -u $SERVICE_NAME -n 50"
fi

# ── Step 7: Find local IP ─────────────────────────────────────────────────────
LOCAL_IP=$(hostname -I 2>/dev/null | awk '{print $1}' || echo "127.0.0.1")

# ── Step 8: Open firewall port (if ufw is active) ────────────────────────────
if command -v ufw &>/dev/null && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
  info "Opening port $RELAY_PORT in ufw firewall..."
  $SUDO ufw allow "$RELAY_PORT"/tcp > /dev/null
  success "Firewall port opened ✓"
fi

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
success "InterPoll relay is running!"
echo ""
echo "  Your local relay URL:"
echo -e "  ${GREEN}http://${LOCAL_IP}:${RELAY_PORT}/gun${NC}"
echo ""
echo "  Add this in the app:"
echo "  Settings → Network → Relay Peers → Add Peer"
echo ""
echo "  Useful commands:"
echo "    Status:  sudo systemctl status $SERVICE_NAME"
echo "    Logs:    journalctl -u $SERVICE_NAME -f"
echo "    Restart: sudo systemctl restart $SERVICE_NAME"
echo "    Stop:    sudo systemctl stop $SERVICE_NAME"
echo ""
echo "  Want internet access? Forward port $RELAY_PORT in your"
echo "  router to ${LOCAL_IP}, then use your public IP instead."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
