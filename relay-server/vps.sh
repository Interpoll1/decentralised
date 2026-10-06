#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# Interpoll — Cloud VPS Installer
# Targets: Ubuntu 22.04 / 24.04 (DigitalOcean, Hetzner, Vultr, Linode, OVH)
# Run as root on a fresh VPS
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

info()    { echo -e "${BLUE}[info]${NC}  $*"; }
success() { echo -e "${GREEN}[ok]${NC}    $*"; }
warn()    { echo -e "${YELLOW}[warn]${NC}  $*"; }
error()   { echo -e "${RED}[error]${NC} $*"; exit 1; }
step()    { echo -e "\n${BOLD}▶ $*${NC}"; }

[[ $EUID -ne 0 ]] && error "Run as root"

# ── Required config ────────────────────────────────────────────────────────────
# Pass as env vars or edit here before running
DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"

[[ -z "$DOMAIN" ]] && {
  read -rp "$(echo -e "${BOLD}Domain name${NC} (e.g. relay.example.com): ")" DOMAIN
}
[[ -z "$DOMAIN" ]] && error "DOMAIN is required for VPS install"

[[ -z "$EMAIL" ]] && {
  read -rp "$(echo -e "${BOLD}Admin email${NC} (for TLS cert): ")" EMAIL
}
[[ -z "$EMAIL" ]] && error "EMAIL is required for TLS cert"

# ── Optional config ────────────────────────────────────────────────────────────
RELAY_PORT="${RELAY_PORT:-8080}"
INSTALL_DIR="${INSTALL_DIR:-/opt/interpoll}"
DEPLOY_USER="${DEPLOY_USER:-interpoll}"
NODE_VERSION="20"
MYSQL_PASS="${MYSQL_PASS:-$(openssl rand -base64 32 | tr -d '/+=')}"
ADMIN_SECRET="${ADMIN_SECRET:-$(openssl rand -base64 32 | tr -d '/+=')}"
JWT_SECRET=$(openssl rand -base64 48 | tr -d '/+=')
VOTE_SECRET=$(openssl rand -base64 48 | tr -d '/+=')
ENABLE_TOR="${ENABLE_TOR:-false}"
REPO="https://github.com/interpoll/relay-server.git"

# ── Banner ─────────────────────────────────────────────────────────────────────
echo -e "${BOLD}"
cat << 'BANNER'
  ___       _                      _ _
 |_ _|_ __ | |_ ___ _ __ _ __   ___| | |
  | || '_ \| __/ _ \ '__| '_ \ / _ \ | |
  | || | | | ||  __/ |  | |_) |  __/ | |
 |___|_| |_|\__\___|_|  | .__/ \___|_|_|
                         |_|   Cloud VPS
BANNER
echo -e "${NC}"
info "Domain:  $DOMAIN"
info "Email:   $EMAIL"
info "Install: $INSTALL_DIR"
echo ""

# ── System update ──────────────────────────────────────────────────────────────
step "Updating system packages"
apt-get update -qq
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y -qq
apt-get install -y -qq \
  curl wget git build-essential \
  nginx certbot python3-certbot-nginx \
  ufw fail2ban \
  gnupg2 ca-certificates lsb-release \
  logrotate unattended-upgrades \
  htop ncdu

# ── Unattended upgrades (security patches auto-apply) ─────────────────────────
cat > /etc/apt/apt.conf.d/20auto-upgrades << 'AU'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
AU
success "Auto security updates enabled"

# ── Deploy user ────────────────────────────────────────────────────────────────
step "Creating deploy user: $DEPLOY_USER"
if ! id "$DEPLOY_USER" &>/dev/null; then
  useradd -m -s /bin/bash "$DEPLOY_USER"
fi
# Copy root SSH keys so deploy user can also SSH in
if [[ -f /root/.ssh/authorized_keys ]]; then
  mkdir -p /home/$DEPLOY_USER/.ssh
  cp /root/.ssh/authorized_keys /home/$DEPLOY_USER/.ssh/
  chown -R $DEPLOY_USER:$DEPLOY_USER /home/$DEPLOY_USER/.ssh
  chmod 700 /home/$DEPLOY_USER/.ssh
  chmod 600 /home/$DEPLOY_USER/.ssh/authorized_keys
fi
success "User $DEPLOY_USER ready"

# ── Node.js ────────────────────────────────────────────────────────────────────
step "Installing Node.js $NODE_VERSION"
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash - &>/dev/null
apt-get install -y -qq nodejs
success "Node $(node --version)"

# ── PM2 ────────────────────────────────────────────────────────────────────────
step "Installing PM2"
npm install -g pm2 &>/dev/null
success "PM2 $(pm2 --version)"

# ── MySQL ──────────────────────────────────────────────────────────────────────
step "Installing MySQL"
apt-get install -y -qq mysql-server
systemctl enable --now mysql

mysql -u root << SQL
  CREATE DATABASE IF NOT EXISTS interpoll CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
  CREATE USER IF NOT EXISTS 'interpoll'@'127.0.0.1' IDENTIFIED BY '${MYSQL_PASS}';
  GRANT ALL PRIVILEGES ON interpoll.* TO 'interpoll'@'127.0.0.1';

  -- Lock down root
  DELETE FROM mysql.user WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1');
  DELETE FROM mysql.user WHERE User='';
  DROP DATABASE IF EXISTS test;
  FLUSH PRIVILEGES;
SQL

# MySQL performance tuning for a relay workload
cat > /etc/mysql/conf.d/interpoll.cnf << MYCNF
[mysqld]
innodb_buffer_pool_size     = 256M
innodb_log_file_size        = 64M
innodb_flush_log_at_trx_commit = 2
query_cache_type            = 0
max_connections             = 200
wait_timeout                = 300
interactive_timeout         = 300
slow_query_log              = 1
slow_query_log_file         = /var/log/mysql/slow.log
long_query_time             = 2
MYCNF
systemctl restart mysql
success "MySQL ready"

# ── Install dir + relay ────────────────────────────────────────────────────────
step "Installing relay server"
mkdir -p "$INSTALL_DIR"/{relay-server,data,logs}
chown -R $DEPLOY_USER:$DEPLOY_USER "$INSTALL_DIR"

cd "$INSTALL_DIR/relay-server"
if [[ -d .git ]]; then
  sudo -u $DEPLOY_USER git pull --quiet
else
  sudo -u $DEPLOY_USER git clone --quiet --depth 1 "$REPO" . 2>/dev/null || \
    warn "Git clone failed — upload relay files to $INSTALL_DIR/relay-server manually"
fi

sudo -u $DEPLOY_USER npm install --omit=dev --quiet 2>/dev/null || \
  sudo -u $DEPLOY_USER npm install --quiet

# ── .env ──────────────────────────────────────────────────────────────────────
step "Writing .env"
cat > "$INSTALL_DIR/relay-server/.env" << ENV
PORT=${RELAY_PORT}
DOMAIN=https://${DOMAIN}
FRONTEND_ORIGIN=https://${DOMAIN}
SERVER_ORIGIN=https://${DOMAIN}

MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=interpoll
MYSQL_PASSWORD=${MYSQL_PASS}
MYSQL_DATABASE=interpoll

JWT_SECRET=${JWT_SECRET}
VOTE_RESERVATION_SECRET=${VOTE_SECRET}
ADMIN_SECRET=${ADMIN_SECRET}

RELAY_LABEL=${DOMAIN}
# RELAY_PUBKEY=          # optional Nostr pubkey
# GOOGLE_CLIENT_ID=      # OAuth
# GOOGLE_CLIENT_SECRET=
# MS_CLIENT_ID=
# MS_CLIENT_SECRET=
# FILEBASE_ACCESS_KEY=   # video uploads
# FILEBASE_SECRET_KEY=
# FILEBASE_BUCKET=
ENV

chmod 600 "$INSTALL_DIR/relay-server/.env"
chown $DEPLOY_USER:$DEPLOY_USER "$INSTALL_DIR/relay-server/.env"
success ".env written"

# ── PM2 ecosystem ─────────────────────────────────────────────────────────────
step "Configuring PM2"
cat > "$INSTALL_DIR/relay-server/ecosystem.config.cjs" << ECO
module.exports = {
  apps: [{
    name:        'relay-server',
    script:      'index.js',
    cwd:         '$INSTALL_DIR/relay-server',
    interpreter: 'node',
    node_args:   '--experimental-vm-modules',
    env_file:    '$INSTALL_DIR/relay-server/.env',
    max_memory_restart: '768M',
    error_file:  '$INSTALL_DIR/logs/relay-error.log',
    out_file:    '$INSTALL_DIR/logs/relay-out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    restart_delay: 3000,
    max_restarts:  20,
    exp_backoff_restart_delay: 100,
  }],
};
ECO

chown $DEPLOY_USER:$DEPLOY_USER "$INSTALL_DIR/relay-server/ecosystem.config.cjs"
sudo -u $DEPLOY_USER pm2 start "$INSTALL_DIR/relay-server/ecosystem.config.cjs"
sudo -u $DEPLOY_USER pm2 save

# PM2 auto-start on boot
env PATH=$PATH:/usr/bin pm2 startup systemd -u $DEPLOY_USER \
  --hp /home/$DEPLOY_USER | tail -1 | bash &>/dev/null || true
success "PM2 configured"

# ── Nginx ──────────────────────────────────────────────────────────────────────
step "Configuring nginx"
cat > /etc/nginx/sites-available/interpoll << NGINX
map \$http_upgrade \$connection_upgrade {
  default upgrade;
  ''      close;
}

# Rate limiting
limit_req_zone \$binary_remote_addr zone=relay_api:10m rate=30r/s;
limit_req_zone \$binary_remote_addr zone=relay_auth:10m rate=5r/m;
limit_conn_zone \$binary_remote_addr zone=relay_conn:10m;

server {
  listen 80;
  server_name ${DOMAIN};
  return 301 https://\$host\$request_uri;
}

server {
  listen 443 ssl http2;
  server_name ${DOMAIN};

  ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
  ssl_protocols       TLSv1.2 TLSv1.3;
  ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
  ssl_prefer_server_ciphers off;
  ssl_session_cache   shared:SSL:10m;
  ssl_session_timeout 1d;
  ssl_stapling        on;
  ssl_stapling_verify on;

  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
  add_header X-Frame-Options DENY always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer always;

  client_max_body_size 32M;

  # Limits
  limit_conn relay_conn 50;

  # WebSocket — Gun + relay WS (no rate limit, handled in relay)
  location ~ ^/(gun|ws) {
    proxy_pass         http://127.0.0.1:${RELAY_PORT};
    proxy_http_version 1.1;
    proxy_set_header   Upgrade \$http_upgrade;
    proxy_set_header   Connection \$connection_upgrade;
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }

  # Auth endpoints — strict rate limit
  location ~ ^/auth/ {
    limit_req zone=relay_auth burst=10 nodelay;
    proxy_pass       http://127.0.0.1:${RELAY_PORT};
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  }

  # API
  location /api/ {
    limit_req zone=relay_api burst=60 nodelay;
    proxy_pass       http://127.0.0.1:${RELAY_PORT};
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_read_timeout 30s;
  }

  # Admin — restrict to trusted IPs (edit as needed)
  location /admin/ {
    # allow 1.2.3.4;       # your IP
    # deny all;
    proxy_pass       http://127.0.0.1:${RELAY_PORT};
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
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

# ── TLS ────────────────────────────────────────────────────────────────────────
step "Obtaining TLS certificate"
# Temporarily serve HTTP for ACME challenge before nginx has the cert
sed -i 's|ssl_certificate|#ssl_certificate|g; s|ssl_protocols|#ssl_protocols|g; s|ssl_ciphers|#ssl_ciphers|g; s|ssl_prefer|#ssl_prefer|g; s|ssl_session|#ssl_session|g; s|ssl_stapling|#ssl_stapling|g; s|listen 443|#listen 443|g; s|return 301|#return 301|g' \
  /etc/nginx/sites-available/interpoll 2>/dev/null || true

nginx -t && systemctl reload nginx

certbot certonly --nginx -d "$DOMAIN" --non-interactive \
  --agree-tos --email "$EMAIL" --redirect || {
  warn "Certbot failed — check DNS points to this server, then run:"
  warn "  certbot --nginx -d $DOMAIN --email $EMAIL"
}

# Restore full nginx config
cat > /etc/nginx/sites-available/interpoll << NGINX2
map \$http_upgrade \$connection_upgrade {
  default upgrade;
  ''      close;
}

limit_req_zone \$binary_remote_addr zone=relay_api:10m  rate=30r/s;
limit_req_zone \$binary_remote_addr zone=relay_auth:10m rate=5r/m;
limit_conn_zone \$binary_remote_addr zone=relay_conn:10m;

server {
  listen 80;
  server_name ${DOMAIN};
  return 301 https://\$host\$request_uri;
}

server {
  listen 443 ssl http2;
  server_name ${DOMAIN};

  ssl_certificate     /etc/letsencrypt/live/${DOMAIN}/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/${DOMAIN}/privkey.pem;
  ssl_protocols       TLSv1.2 TLSv1.3;
  ssl_ciphers         ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384;
  ssl_prefer_server_ciphers off;
  ssl_session_cache   shared:SSL:10m;
  ssl_session_timeout 1d;
  ssl_stapling        on;
  ssl_stapling_verify on;

  add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
  add_header X-Frame-Options DENY always;
  add_header X-Content-Type-Options nosniff always;
  add_header Referrer-Policy no-referrer always;

  client_max_body_size 32M;
  limit_conn relay_conn 50;

  location ~ ^/(gun|ws) {
    proxy_pass         http://127.0.0.1:${RELAY_PORT};
    proxy_http_version 1.1;
    proxy_set_header   Upgrade \$http_upgrade;
    proxy_set_header   Connection \$connection_upgrade;
    proxy_set_header   Host \$host;
    proxy_set_header   X-Real-IP \$remote_addr;
    proxy_set_header   X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
  }

  location ~ ^/auth/ {
    limit_req zone=relay_auth burst=10 nodelay;
    proxy_pass       http://127.0.0.1:${RELAY_PORT};
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  }

  location /api/ {
    limit_req zone=relay_api burst=60 nodelay;
    proxy_pass       http://127.0.0.1:${RELAY_PORT};
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
    proxy_read_timeout 30s;
  }

  location /admin/ {
    # allow 1.2.3.4;
    # deny all;
    proxy_pass       http://127.0.0.1:${RELAY_PORT};
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
  }

  location / {
    proxy_pass       http://127.0.0.1:${RELAY_PORT};
    proxy_set_header Host \$host;
    proxy_set_header X-Real-IP \$remote_addr;
    proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
  }
}
NGINX2

nginx -t && systemctl reload nginx
success "Nginx + TLS configured"

# ── Tor hidden service (optional) ─────────────────────────────────────────────
ONION=""
if [[ "$ENABLE_TOR" == "true" ]]; then
  step "Setting up Tor hidden service"
  apt-get install -y -qq tor
  cat >> /etc/tor/torrc << TOR

HiddenServiceDir /var/lib/tor/interpoll/
HiddenServicePort 80  127.0.0.1:${RELAY_PORT}
HiddenServicePort 443 127.0.0.1:${RELAY_PORT}
TOR
  systemctl restart tor
  sleep 5
  ONION=$(cat /var/lib/tor/interpoll/hostname 2>/dev/null || echo "pending — check /var/lib/tor/interpoll/hostname")
  success "Tor: $ONION"
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
success "UFW active"

# ── Fail2ban ───────────────────────────────────────────────────────────────────
cat > /etc/fail2ban/jail.local << F2B
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5

[sshd]
enabled  = true

[nginx-http-auth]
enabled  = true

[nginx-limit-req]
enabled  = true
port     = http,https
logpath  = /var/log/nginx/error.log
maxretry = 10
F2B
systemctl enable --now fail2ban &>/dev/null
success "Fail2ban active"

# ── Log rotation ───────────────────────────────────────────────────────────────
cat > /etc/logrotate.d/interpoll << LR
${INSTALL_DIR}/logs/*.log {
  daily
  rotate 14
  compress
  delaycompress
  missingok
  notifempty
  sharedscripts
  postrotate
    sudo -u ${DEPLOY_USER} pm2 reloadLogs
  endscript
}
LR
success "Log rotation configured"

# ── Health check cron ──────────────────────────────────────────────────────────
cat > /etc/cron.d/interpoll-health << CRON
*/5 * * * * ${DEPLOY_USER} curl -sf http://127.0.0.1:${RELAY_PORT}/api/health > /dev/null || pm2 restart relay-server
CRON
success "Health check cron active"

# ── Save credentials ───────────────────────────────────────────────────────────
CREDS_FILE="$INSTALL_DIR/credentials.txt"
cat > "$CREDS_FILE" << CREDS
# Interpoll VPS credentials — keep safe, delete after noting down
# Generated: $(date)

DOMAIN:        ${DOMAIN}
MYSQL_USER:    interpoll
MYSQL_PASS:    ${MYSQL_PASS}
ADMIN_SECRET:  ${ADMIN_SECRET}
INSTALL_DIR:   ${INSTALL_DIR}
DEPLOY_USER:   ${DEPLOY_USER}
$([ -n "$ONION" ] && echo "TOR_ONION:     $ONION")
CREDS
chmod 600 "$CREDS_FILE"

# ── Done ───────────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  Interpoll VPS installed successfully!${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Relay URL:     ${BOLD}https://${DOMAIN}${NC}"
echo -e "  WebSocket:     ${BOLD}wss://${DOMAIN}${NC}"
echo -e "  Health check:  ${BOLD}https://${DOMAIN}/api/health${NC}"
echo -e "  Relay info:    ${BOLD}https://${DOMAIN}/api/relay-info${NC}"
[[ -n "$ONION" ]] && \
echo -e "  Tor address:   ${BOLD}${ONION}${NC}"
echo ""
echo -e "  Credentials saved to: ${BOLD}${CREDS_FILE}${NC}"
echo ""
echo -e "  Useful commands:"
echo -e "    ${BOLD}pm2 logs relay-server${NC}     — live logs"
echo -e "    ${BOLD}pm2 status${NC}                — process status"
echo -e "    ${BOLD}pm2 restart relay-server${NC}  — restart after .env changes"
echo -e "    ${BOLD}nano ${INSTALL_DIR}/relay-server/.env${NC}"
echo ""
echo -e "  Add to Interpoll app:"
echo -e "    ${BOLD}Settings → Relays → Add relay → https://${DOMAIN}${NC}"
echo ""