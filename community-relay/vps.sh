#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# InterPoll community relay — Cloud VPS installer (Docker + Caddy + auto-TLS)
#
#   curl -sSL https://interpoll.endless.sbs/vps.sh | sudo bash -s relay.example.com [email]
#
# Requirements: Ubuntu/Debian (or any distro get.docker.com supports), a domain
# whose A/AAAA record points at this server, and ports 80 + 443 free.
# Installs Docker if missing, builds the relay image, and runs it behind Caddy,
# which obtains and renews the Let's Encrypt certificate automatically.
# Re-running upgrades in place and keeps data (in /opt/interpoll-relay/radata).
#
# Env overrides: UPSTREAM_PEERS, INTERPOLL_BASE
# Uninstall: cd /opt/interpoll-relay && docker compose down && systemctl disable interpoll-relay
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

DOMAIN="${1:-${DOMAIN:-}}"
EMAIL="${2:-${EMAIL:-}}"
BASE="${INTERPOLL_BASE:-https://interpoll.endless.sbs}"
UPSTREAM_PEERS="${UPSTREAM_PEERS-https://interpoll2.endless.sbs/gun}"
DIR=/opt/interpoll-relay
PORT=8765

if [ -t 1 ]; then G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[0;34m'; N='\033[0m'; else G=; Y=; R=; B=; N=; fi
info() { printf "${B}[interpoll]${N} %s\n" "$*"; }
ok()   { printf "${G}[interpoll]${N} %s\n" "$*"; }
warn() { printf "${Y}[interpoll]${N} %s\n" "$*"; }
die()  { printf "${R}[interpoll]${N} %s\n" "$*" >&2; exit 1; }

[ "$(uname -s)" = Linux ] || die "This installer runs on the Linux server. SSH into your VPS first, then run it there."
[ -n "$DOMAIN" ] || die "Usage: curl -sSL $BASE/vps.sh | sudo bash -s relay.example.com [email]"
[ "$DOMAIN" != yourdomain.com ] || die "Replace 'yourdomain.com' with your real domain."
[[ "$DOMAIN" =~ ^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$ ]] || die "Invalid domain: $DOMAIN"
[ "$(id -u)" -eq 0 ] || die "Run as root: curl -sSL $BASE/vps.sh | sudo bash -s $DOMAIN"
command -v curl >/dev/null || { apt-get update -qq && apt-get install -y -qq curl; }

# ── DNS sanity check (warn only) ─────────────────────────────────────────────
SERVER_IP="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || true)"
DOMAIN_IP="$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)"
if [ -z "$DOMAIN_IP" ]; then
  warn "$DOMAIN does not resolve yet — Caddy will keep retrying the certificate until DNS is live."
elif [ -n "$SERVER_IP" ] && [ "$SERVER_IP" != "$DOMAIN_IP" ]; then
  warn "$DOMAIN resolves to $DOMAIN_IP but this server is $SERVER_IP — TLS will fail until DNS points here."
else
  ok "$DOMAIN resolves to this server ($SERVER_IP)"
fi

# ── Port check ───────────────────────────────────────────────────────────────
for p in 80 443; do
  if ss -ltnH "sport = :$p" 2>/dev/null | grep -q . && ! docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^interpoll-relay-caddy'; then
    die "Port $p is already in use (nginx/apache?). Free ports 80 and 443, or proxy $DOMAIN to 127.0.0.1:$PORT yourself and use install.sh instead."
  fi
done

# ── Docker ───────────────────────────────────────────────────────────────────
if ! command -v docker >/dev/null; then
  info "Installing Docker…"
  curl -fsSL https://get.docker.com | sh >/dev/null
fi
systemctl enable --now docker >/dev/null 2>&1 || true
docker compose version >/dev/null 2>&1 || die "Docker Compose plugin missing (install docker-compose-plugin)."
ok "Docker $(docker --version | awk '{print $3}' | tr -d ,)"

# ── Files ────────────────────────────────────────────────────────────────────
info "Writing $DIR"
mkdir -p "$DIR/app" "$DIR/radata" "$DIR/caddy-data" "$DIR/caddy-config"
curl -fsSL "$BASE/relay-kit/relay.js"     -o "$DIR/app/relay.js"
curl -fsSL "$BASE/relay-kit/package.json" -o "$DIR/app/package.json"

cat > "$DIR/app/Dockerfile" <<'EOF'
FROM node:20-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund --loglevel=error
COPY relay.js ./
ENV PORT=8765 GUN_DATA_DIR=/data
EXPOSE 8765
CMD ["node", "relay.js"]
EOF

cat > "$DIR/docker-compose.yml" <<EOF
name: interpoll-relay
services:
  relay:
    build: ./app
    container_name: interpoll-relay-gun
    restart: unless-stopped
    environment:
      UPSTREAM_PEERS: "${UPSTREAM_PEERS}"
    volumes:
      - ./radata:/data
    ports:
      - "127.0.0.1:${PORT}:${PORT}"
    healthcheck:
      test: ["CMD", "wget", "-qO-", "http://127.0.0.1:${PORT}/health"]
      interval: 30s
      timeout: 5s
      retries: 3
  caddy:
    image: caddy:2-alpine
    container_name: interpoll-relay-caddy
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
      - "443:443/udp"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./caddy-data:/data
      - ./caddy-config:/config
    depends_on:
      - relay
EOF

{
  if [ -n "$EMAIL" ]; then printf '{\n\temail %s\n}\n\n' "$EMAIL"; fi
  cat <<EOF
${DOMAIN} {
	encode gzip
	header {
		Access-Control-Allow-Origin *
		X-Content-Type-Options nosniff
		Referrer-Policy no-referrer
		-Server
	}
	reverse_proxy relay:${PORT}
}
EOF
} > "$DIR/Caddyfile"

# ── Firewall ─────────────────────────────────────────────────────────────────
if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q "Status: active"; then
  ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null; ufw allow 443/udp >/dev/null
  ok "Opened ports 80/443 in ufw"
fi

# ── Start ────────────────────────────────────────────────────────────────────
info "Building and starting containers…"
cd "$DIR"
docker compose up -d --build --remove-orphans

cat > /etc/systemd/system/interpoll-relay.service <<EOF
[Unit]
Description=InterPoll community relay (Docker Compose)
Requires=docker.service
After=docker.service network-online.target
Wants=network-online.target

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=300

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable interpoll-relay >/dev/null 2>&1

info "Waiting for the relay…"
for _ in $(seq 1 60); do curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 && break; sleep 2; done
curl -fsS "http://127.0.0.1:$PORT/health" >/dev/null 2>&1 || die "Relay did not start. Logs: docker compose -f $DIR/docker-compose.yml logs relay"
ok "Relay is running"

info "Waiting for the TLS certificate (up to 2 min)…"
TLS=no
for _ in $(seq 1 24); do
  if curl -fsS --max-time 5 "https://$DOMAIN/health" >/dev/null 2>&1; then TLS=yes; break; fi
  sleep 5
done

echo
echo "────────────────────────────────────────────────────────────"
if [ "$TLS" = yes ]; then
  ok "InterPoll relay is live:"
else
  warn "Relay is up, but https://$DOMAIN is not reachable yet (DNS or certificate pending)."
  warn "Check: docker compose -f $DIR/docker-compose.yml logs caddy"
  echo "  Once it works, your relay URL is:"
fi
printf "\n    ${G}https://%s/gun${N}\n\n" "$DOMAIN"
echo "  Add it in the app: Settings → Network → Relay Configuration"
echo "  Logs:    docker compose -f $DIR/docker-compose.yml logs -f"
echo "  Upgrade: re-run this command"
echo "────────────────────────────────────────────────────────────"
