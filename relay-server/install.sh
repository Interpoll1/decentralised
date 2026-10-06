#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Interpoll — Home Server Installer
# Targets: Raspberry Pi 4/5, Ubuntu 22.04/24.04, Debian 12
# Run as root or with sudo
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}[info]${NC}  $*"; }
success() { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
error()   { echo -e "${RED}[error]${NC} $*"; exit 1; }
step()    { echo -e "\n${BOLD}▶ $*${NC}"; }

# ── Root check ─────────────────────────────────────────────────────────────────
[[ $EUID -ne 0 ]] && error "Run with sudo or as root"

# ── Config (edit or override via env) ─────────────────────────────────────────
INSTALL_DIR="${INSTALL_DIR:-/opt/interpoll}"
RELAY_PORT="${RELAY_PORT:-8080}"
DOMAIN="${DOMAIN:-}"                    # leave blank for LAN-only
ENABLE_TOR="${ENABLE_TOR:-false}"       # true = install Tor hidden service
MYSQL_PASS="${MYSQL_PASS:-$(openssl rand -base64 24 | tr -d '/+=')}"
NODE_VERSION="20"
REPO="https://github.com/interpoll/relay-server.git"

# ── Banner ─────────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
cat << 'BANNER'
  ___       _                      _ _
 |_ _|_ __ | |_ ___ _ __ _ __   ___| | |
  | || '_ \| __/ _ \ '__| '_ \ / _ \ | |
  | || | | | ||  __/ |  | |_) |  __/ | |
 |___|_| |_|\__\___|_|  | .__/ \___|_|_|
                         |_|   Home Server
BANNER
echo -e "${NC}"

# ── Detect OS / arch ──────────────────────────────────────────────────────────
step "Detecting system"
ARCH=$(uname -m)
OS_ID=$(grep -oP '(?<=^ID=).+' /etc/os-release | tr -d '"')
OS_VER=$(grep -oP '(?<=^VERSION_ID=).+' /etc/os-release | tr -d '"')
IS_RPI=false
[[ -f /proc/device-tree/model ]] && grep -qi "raspberry" /proc/device-tree/model 2>/dev/null && IS_RPI=true

info "OS: $OS_ID $OS_VER | Arch: $ARCH | RPi: $IS_RPI"
[[ "$OS_ID" =~ ^(ubuntu|debian|raspbian)$ ]] || warn "Untested OS — continuing anyway"

# ── System packages ────────────────────────────────────────────────────────────
step "Installing system packages"
apt-get update -qq
apt-get install -y -qq \
  curl wget git build-essential \
  nginx certbot python3-certbot-nginx \
  ufw fail2ban \
  gnupg2 ca-certificates lsb-release

# ── Node.js ────────────────────────────────────────────────────────────────────
step "Installing Node.js $NODE_VERSION"
if ! command -v node &>/dev/null || [[ $(node -e "process.exit(parseInt(process.version.slice(1)) < $NODE_VERSION ? 1 : 0)" 2>&1; echo $?) -eq 1 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - &>/dev/null
  apt-get install -y -qq nodejs
fi
NODE_VER=$(node --version)
success "Node $NODE_VER"

# ── PM2 ────────────────────────────────────────────────────────────────────────
step "Installing PM2"
npm install -g pm2 &>/dev/null
success "PM2 $(pm2 --version)"

# ── MySQL ──────────────────────────────────────────────────────────────────────
step "Installing MySQL"
if ! command -v mysql &>/dev/null; then
  apt-get install -y -qq mysql-server
  systemctl enable --now mysql
fi

# Secure and create DB
mysql -u root << SQL
  CREATE DATABASE IF NOT EXISTS interpoll CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER IF NOT EXISTS 'interpoll'@'localhost' IDENTIFIED BY '${MYSQL_PASS}';
  GRANT ALL PRIVILEGES ON interpoll.* TO 'interpoll'@'localhost';
  FLUSH PRIVILEGES;
SQL
success "MySQL ready"

# ── Install dir ────────────────────────────────────────────────────────────────
step "Setting up $INSTALL_DIR"
mkdir -p "$INSTALL_DIR"/{relay-server,data,logs}
useradd -r -s /bin/false -d "$INSTALL_DIR" interpoll 2>/dev/null || true

# ── Relay server ───────────────────────────────────────────────────────────────
step "Installing relay server"
cd "$INSTALL_DIR/relay-server"

if [[ -d .git ]]; then
  git pull --quiet
else
  git clone --quiet --depth 1 "$REPO" . 2>/dev/null || {
    warn "Git clone failed — copying bundled files instead"
  }
fi

npm install --omit=dev --quiet 2>/dev/null || npm install --quiet

# ── Environment file ───────────────────────────────────────────────────────────
step "Writing .env"
LOCAL_IP=$(hostname -I | awk '{print $1}')
JWT_SECRET=$(openssl rand -base64 48 | tr -d '/+=')
VOTE_SECRET=$(openssl rand -base64 48 | tr -d '/+=')

cat > "$INSTALL_DIR/relay-server/.env" << ENV
PORT=${RELAY_PORT}
DOMAIN=${DOMAIN:-http://$LOCAL_IP:$RELAY_PORT}
FRONTEND_ORIGIN=${DOMAIN:-http://$LOCAL_IP:$RELAY_PORT}
SERVER_ORIGIN=${DOMAIN:-http://$LOCAL_IP:$RELAY_PORT}

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=interpoll
MYSQL_PASSWORD=${MYSQL_PASS}
MYSQL_DATABASE=interpoll

JWT_SECRET=${JWT_SECRET}
VOTE_RESERVATION_SECRET=${VOTE_SECRET}

RELAY_LABEL=Home Relay
# RELAY_PUBKEY=          # optional Nostr pubkey for attestation
# ADMIN_SECRET=          # set a strong secret to access /admin/* routes
# GOOGLE_CLIENT_ID=      # OAuth — leave blank to disable
# GOOGLE_CLIENT_SECRET=
# MS_CLIENT_ID=
# MS_CLIENT_SECRET=
ENV

chmod 600 "$INSTALL_DIR/relay-server/.env"
success ".env written"

# ── PM2 ecosystem ─────────────────────────────────────────────────────────────
step "Configuring PM2"
cat > "$INSTALL_DIR/relay-server/ecosystem.config.cjs" << 'ECO'
module.exports = {
  apps: [{
    name:        'relay-server',
    script:      'index.js',
    cwd:         __dirname,
    interpreter: 'node',
    node_args:   '--experimental-vm-modules',
    env_file:    '.env',
    max_memory_restart: '512M',
    error_file:  '/opt/interpoll/logs/relay-error.log',
    out_file:    '/opt/interpoll/logs/relay-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 3000,
    max_restarts:  10,
  }],
};
ECO

cd "$INSTALL_DIR/relay-server"
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup systemd -u root --hp /root | tail -1 | bash &>/dev/null || true
success "PM2 configured"

# ── Nginx ──────────────────────────────────────────────────────────────────────
step "Configuring nginx"
cat > /etc/nginx/sites-available/interpoll << NGINX
map \$http_upgrade \$connection_upgrade {
  default upgrade;
  ''      close;
}

server {
  listen 80;
  server_name ${DOMAIN:-_};

  # WebSocket
  location /gun {
    proxy_pass         http://127.0.0.1:${RELAY_PORT};
    proxy_http_version 1.1;
    proxy_set_header   Upgrade \$http_upgrade;
    proxy_set_header   Connection \$connection_upgrade;
    proxy_set_header   Host \$host;
    proxy_read_timeout 3600s;
  }

  location / {
    proxy_pass       http://127.0.0.1:${RELAY_PORT};
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  }
}
NGINX

ln -sf /etc/nginx/sites-available/interpoll /etc/nginx/sites-enabled/interpoll
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
success "Nginx configured"

# ── TLS (only if domain provided) ──────────────────────────────────────────────
if [[ -n "$DOMAIN" ]]; then
  step "Obtaining TLS certificate for $DOMAIN"
  certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos \
    --email "admin@${DOMAIN}" --redirect 2>/dev/null && success "TLS enabled" || \
    warn "Certbot failed — run manually: certbot --nginx -d $DOMAIN"
fi

# ── Tor hidden service (optional) ─────────────────────────────────────────────
if [[ "$ENABLE_TOR" == "true" ]]; then
  step "Setting up Tor hidden service"
  apt-get install -y -qq tor
  cat >> /etc/tor/torrc << TOR

HiddenServiceDir /var/lib/tor/interpoll/
HiddenServicePort 80 127.0.0.1:${RELAY_PORT}
TOR
  systemctl restart tor
  sleep 3
  ONION=$(cat /var/lib/tor/interpoll/hostname 2>/dev/null || echo "pending…")
  success "Tor hidden service: $ONION"
fi

# ── Firewall ───────────────────────────────────────────────────────────────────
step "Configuring firewall"
ufw --force reset &>/dev/null
ufw default deny incoming &>/dev/null
ufw default allow outgoing &>/dev/null
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
[[ "$ENABLE_TOR" == "true" ]] && ufw allow 9001/tcp
ufw --force enable &>/dev/null
success "Firewall active"

# ── Fail2ban ───────────────────────────────────────────────────────────────────
cat > /etc/fail2ban/jail.local << F2B
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true

[nginx-http-auth]
enabled = true
F2B
systemctl enable --now fail2ban &>/dev/null
success "Fail2ban active"

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  Interpoll home server installed successfully!${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Relay URL:   ${BOLD}${DOMAIN:-http://$LOCAL_IP:$RELAY_PORT}${NC}"
echo -e "  WebSocket:   ${BOLD}${DOMAIN:+wss://}${DOMAIN:-ws://$LOCAL_IP:$RELAY_PORT}${NC}"
echo -e "  Install dir: ${BOLD}$INSTALL_DIR${NC}"
echo -e "  MySQL pass:  ${BOLD}$MYSQL_PASS${NC}  ← save this"
echo -e "  Logs:        ${BOLD}pm2 logs relay-server${NC}"
echo -e "  Status:      ${BOLD}pm2 status${NC}"
echo ""
echo -e "  Add to Interpoll app:"
echo -e "  ${BOLD}Settings → Relays → Add relay → paste your URL${NC}"
echo ""
[[ "$ENABLE_TOR" == "true" ]] && echo -e "  Tor address: ${BOLD}$ONION${NC}\n"
echo -e "  Edit config: ${BOLD}$INSTALL_DIR/relay-server/.env${NC}"
echo -e "  then:        ${BOLD}pm2 restart relay-server${NC}"
echo ""