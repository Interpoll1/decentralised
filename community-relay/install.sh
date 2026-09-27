#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# InterPoll community relay — Home server installer (Linux / Raspberry Pi / macOS)
#
#   curl -sSL https://interpoll.endless.sbs/install.sh | bash
#
# Installs Node.js if missing, downloads the relay, and runs it as a service
# that starts on boot (systemd on Linux, launchd on macOS). Prints the relay
# URL when done. Re-running it upgrades in place and keeps your data.
#
# Env overrides: RELAY_PORT (8765), UPSTREAM_PEERS, INTERPOLL_BASE
# Uninstall (Linux):  sudo systemctl disable --now interpoll-relay && sudo rm -rf /opt/interpoll-relay /etc/systemd/system/interpoll-relay.service
# Uninstall (macOS):  launchctl unload ~/Library/LaunchAgents/sbs.endless.interpoll-relay.plist && rm -rf ~/.interpoll-relay ~/Library/LaunchAgents/sbs.endless.interpoll-relay.plist
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

BASE="${INTERPOLL_BASE:-https://interpoll.endless.sbs}"
RELAY_PORT="${RELAY_PORT:-8765}"
UPSTREAM_PEERS="${UPSTREAM_PEERS-https://interpoll2.endless.sbs/gun}"
SERVICE=interpoll-relay
NODE_MAJOR_MIN=18

if [ -t 1 ]; then G='\033[0;32m'; Y='\033[1;33m'; R='\033[0;31m'; B='\033[0;34m'; N='\033[0m'; else G=; Y=; R=; B=; N=; fi
info() { printf "${B}[interpoll]${N} %s\n" "$*"; }
ok()   { printf "${G}[interpoll]${N} %s\n" "$*"; }
warn() { printf "${Y}[interpoll]${N} %s\n" "$*"; }
die()  { printf "${R}[interpoll]${N} %s\n" "$*" >&2; exit 1; }

OS="$(uname -s)"
case "$OS" in Linux|Darwin) ;; *) die "Unsupported OS: $OS (use install.ps1 on Windows)";; esac
command -v curl >/dev/null || die "curl is required"

SUDO=""
if [ "$OS" = Linux ] && [ "$(id -u)" -ne 0 ]; then
  command -v sudo >/dev/null || die "Run as root or install sudo"
  SUDO=sudo
fi

# ── Node.js ──────────────────────────────────────────────────────────────────
node_ok() { command -v node >/dev/null && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge "$NODE_MAJOR_MIN" ]; }

if node_ok; then
  ok "Node.js $(node -v) found"
elif [ "$OS" = Darwin ]; then
  command -v brew >/dev/null || die "Install Homebrew (https://brew.sh) or Node.js 20+ (https://nodejs.org), then re-run."
  info "Installing Node.js via Homebrew…"
  brew install node
else
  info "Installing Node.js 20…"
  if command -v apt-get >/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | $SUDO bash - >/dev/null
    $SUDO apt-get install -y nodejs >/dev/null
  elif command -v dnf >/dev/null; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | $SUDO bash - >/dev/null
    $SUDO dnf install -y nodejs >/dev/null
  elif command -v pacman >/dev/null; then
    $SUDO pacman -Sy --noconfirm nodejs npm >/dev/null
  elif command -v apk >/dev/null; then
    $SUDO apk add --no-cache nodejs npm >/dev/null
  else
    die "No supported package manager found — install Node.js 20+ manually and re-run."
  fi
fi
node_ok || die "Node.js ${NODE_MAJOR_MIN}+ is required (found: $(node -v 2>/dev/null || echo none))"
NODE_BIN="$(command -v node)"
NPM_BIN="$(command -v npm)"

# ── Files ────────────────────────────────────────────────────────────────────
if [ "$OS" = Darwin ]; then DIR="$HOME/.interpoll-relay"; else DIR=/opt/interpoll-relay; fi
info "Installing relay into $DIR"
$SUDO mkdir -p "$DIR/radata"
TMP="$(mktemp -d)"; trap 'rm -rf "$TMP"' EXIT
curl -fsSL "$BASE/relay-kit/relay.js"     -o "$TMP/relay.js"     || die "Download failed: $BASE/relay-kit/relay.js"
curl -fsSL "$BASE/relay-kit/package.json" -o "$TMP/package.json" || die "Download failed: $BASE/relay-kit/package.json"
$SUDO cp "$TMP/relay.js" "$TMP/package.json" "$DIR/"

if [ "$OS" = Linux ]; then
  RUN_USER="${SUDO_USER:-$(id -un)}"
  if [ "$RUN_USER" = root ]; then
    id interpoll >/dev/null 2>&1 || $SUDO useradd --system --home-dir "$DIR" --shell /usr/sbin/nologin interpoll 2>/dev/null \
      || $SUDO useradd -r -d "$DIR" -s /sbin/nologin interpoll
    RUN_USER=interpoll
  fi
  $SUDO chown -R "$RUN_USER" "$DIR"
  info "Installing dependencies…"
  (cd "$DIR" && $SUDO env HOME="$TMP" "$NPM_BIN" install --omit=dev --no-audit --no-fund --loglevel=error)
  $SUDO chown -R "$RUN_USER" "$DIR"
else
  info "Installing dependencies…"
  (cd "$DIR" && "$NPM_BIN" install --omit=dev --no-audit --no-fund --loglevel=error)
fi
ok "Dependencies installed"

# ── Service ──────────────────────────────────────────────────────────────────
if [ "$OS" = Linux ]; then
  command -v systemctl >/dev/null || die "systemd not found. Start manually: cd $DIR && PORT=$RELAY_PORT node relay.js"
  $SUDO tee /etc/systemd/system/$SERVICE.service >/dev/null <<EOF
[Unit]
Description=InterPoll community Gun relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$RUN_USER
WorkingDirectory=$DIR
Environment=PORT=$RELAY_PORT
Environment=GUN_DATA_DIR=$DIR/radata
Environment=UPSTREAM_PEERS=$UPSTREAM_PEERS
ExecStart=$NODE_BIN $DIR/relay.js
Restart=always
RestartSec=5
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF
  $SUDO systemctl daemon-reload
  $SUDO systemctl enable $SERVICE >/dev/null 2>&1
  $SUDO systemctl restart $SERVICE
  if command -v ufw >/dev/null && $SUDO ufw status 2>/dev/null | grep -q "Status: active"; then
    $SUDO ufw allow "$RELAY_PORT/tcp" >/dev/null && ok "Opened port $RELAY_PORT in ufw"
  fi
  LOCAL_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
  LOGS="journalctl -u $SERVICE -f"
else
  PLIST="$HOME/Library/LaunchAgents/sbs.endless.interpoll-relay.plist"
  mkdir -p "$(dirname "$PLIST")"
  cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>sbs.endless.interpoll-relay</string>
  <key>ProgramArguments</key><array><string>$NODE_BIN</string><string>$DIR/relay.js</string></array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>EnvironmentVariables</key><dict>
    <key>PORT</key><string>$RELAY_PORT</string>
    <key>GUN_DATA_DIR</key><string>$DIR/radata</string>
    <key>UPSTREAM_PEERS</key><string>$UPSTREAM_PEERS</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/relay.log</string>
  <key>StandardErrorPath</key><string>$DIR/relay.log</string>
</dict></plist>
EOF
  launchctl unload "$PLIST" 2>/dev/null || true
  launchctl load -w "$PLIST"
  LOCAL_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
  LOGS="tail -f $DIR/relay.log"
fi
LOCAL_IP="${LOCAL_IP:-127.0.0.1}"

# ── Health check ─────────────────────────────────────────────────────────────
info "Waiting for the relay to come up…"
for _ in $(seq 1 20); do
  curl -fsS "http://127.0.0.1:$RELAY_PORT/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -fsS "http://127.0.0.1:$RELAY_PORT/health" >/dev/null 2>&1 || die "Relay did not start. Logs: $LOGS"
ok "Relay is running"

echo
echo "────────────────────────────────────────────────────────────"
ok "InterPoll relay is live on your network:"
printf "\n    ${G}http://%s:%s/gun${N}\n\n" "$LOCAL_IP" "$RELAY_PORT"
echo "  Add it in the app: Settings → Network → Relay Configuration"
echo "  Logs: $LOGS"
echo
echo "  To reach it from the internet, forward TCP $RELAY_PORT on your"
echo "  router to $LOCAL_IP (or use the Cloud VPS installer for HTTPS)."
echo "────────────────────────────────────────────────────────────"
