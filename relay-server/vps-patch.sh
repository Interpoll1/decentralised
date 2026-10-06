#!/usr/bin/env bash
# ────────────────────────────────────────────────────────────────────────────────
# VPS patch script for /var/www/interpoll
# Run from: /var/www/interpoll
# Run as:   bash vps-patch.sh
# ────────────────────────────────────────────────────────────────────────────────

set -euo pipefail
cd /var/www/interpoll

GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✓${NC} $*"; }
warn() { echo -e "${YELLOW}!${NC} $*"; }
fail() { echo -e "${RED}✗${NC} $*"; exit 1; }

# ── Hardcoded paths (confirmed by user) ──────────────────────────────────────
RELAY="relay-server/relay-server-enhanced.js"
GUN_RELAY="gun-relay/gun-relay-enhanced.js"
POW_CHALLENGE="pow-challenge.js"
ECOSYSTEM="ecosystem.config.cjs"

[[ -f "$RELAY" ]]       || fail "Not found: $RELAY"
[[ -f "$GUN_RELAY" ]]   || fail "Not found: $GUN_RELAY"
[[ -f "$POW_CHALLENGE" ]] || fail "Not found: $POW_CHALLENGE"
[[ -f "$ECOSYSTEM" ]]   || fail "Not found: $ECOSYSTEM"
[[ -f "backend/pow-server-patch.js" ]] || fail "Not found: backend/pow-server-patch.js — did you upload the new files?"

ok "All required files found"

# ── Step 1: Backup relay server ───────────────────────────────────────────────
BACKUP="${RELAY}.bak.$(date +%Y%m%d-%H%M%S)"
cp "$RELAY" "$BACKUP"
ok "Backed up relay server to: $BACKUP"

# ── Step 2: Fix import path in pow-server-patch.js ───────────────────────────
# relay-server-enhanced.js is at relay-server/relay-server-enhanced.js
# backend/pow-server-patch.js is at backend/pow-server-patch.js
# Relative path from relay-server/ to backend/ is ../backend/
POW_PATCH_IMPORT="import { verifyPoWClientOrServer } from '../backend/pow-server-patch.js';"

# ── Step 3: Add pow-server-patch import after PowChallenge import ─────────────
if grep -q "pow-server-patch" "$RELAY"; then
  warn "pow-server-patch import already present — skipping"
else
  sed -i "s|import { PowChallenge } from '../pow-challenge.js';|import { PowChallenge } from '../pow-challenge.js';\n${POW_PATCH_IMPORT}|" "$RELAY"
  ok "Added pow-server-patch import"
fi

# ── Step 4: Replace powChallenge.verify() call ────────────────────────────────
if grep -q "verifyPoWClientOrServer" "$RELAY"; then
  warn "verifyPoWClientOrServer already patched — skipping"
else
  sed -i "s|const powResult = powChallenge\.verify(powPayload\.pow\.challengeId, powPayload\.pow\.nonce);|const powResult = verifyPoWClientOrServer(powPayload.pow, powChallenge.activeChallenges);|" "$RELAY"
  ok "Replaced powChallenge.verify() with verifyPoWClientOrServer()"
fi

# ── Step 5: Fix result shape check (patch returns .ok, original checks .valid) ─
if grep -q "powResult\.valid" "$RELAY"; then
  sed -i "s|if (!powResult\.valid) {|if (!powResult.ok) {|g" "$RELAY"
  ok "Fixed result shape: .valid → .ok"
else
  ok "Result shape already correct"
fi

# ── Step 6: Expose activeChallenges on PowChallenge ──────────────────────────
if grep -q "activeChallenges" "$POW_CHALLENGE"; then
  ok "PowChallenge already exposes activeChallenges"
else
  warn "Patching pow-challenge.js to expose activeChallenges..."
  cp "$POW_CHALLENGE" "${POW_CHALLENGE}.bak.$(date +%Y%m%d-%H%M%S)"
  sed -i "s|class PowChallenge {|class PowChallenge {\n  get activeChallenges() { return this.challenges || this._challenges || this._store || new Map(); }|" "$POW_CHALLENGE"
  ok "Added activeChallenges getter to PowChallenge"
fi

# ── Step 7: Add relay-bridge to ecosystem.config.cjs ─────────────────────────
if grep -q "relay-bridge" "$ECOSYSTEM"; then
  warn "relay-bridge already in ecosystem.config.cjs — skipping"
else
  cp "$ECOSYSTEM" "${ECOSYSTEM}.bak.$(date +%Y%m%d-%H%M%S)"
  python3 - << 'PYEOF'
import re

with open('ecosystem.config.cjs', 'r') as f:
    content = f.read()

bridge_entry = """,
    {
      name: 'relay-bridge',
      script: './backend/relay-bridge-server.js',
      cwd: '/var/www/interpoll',
      interpreter: 'node',
      env: {
        TUNNEL_DOMAIN: 'tunnel.interpoll.endless.sbs',
      },
      max_memory_restart: '200M',
      restart_delay: 3000,
      error_file: '/var/log/pm2/relay-bridge-error.log',
      out_file:   '/var/log/pm2/relay-bridge-out.log',
    }"""

# Insert before the last ]; that closes the apps array
content = re.sub(r'(\s*\],\s*\n\};?\s*)$', bridge_entry + r'\1', content, count=1)

with open('ecosystem.config.cjs', 'w') as f:
    f.write(content)

print('relay-bridge entry written')
PYEOF

  if grep -q "relay-bridge" "$ECOSYSTEM"; then
    ok "Added relay-bridge to ecosystem.config.cjs"
  else
    warn "Auto-patch failed — see MANUAL section at end of this script"
  fi
fi

# ── Step 8: Nginx — find active config ────────────────────────────────────────
# Look in the standard places; fall back to the project copy
NGINX_CONF=""
for candidate in \
    /etc/nginx/sites-enabled/interpoll \
    /etc/nginx/sites-enabled/default \
    /etc/nginx/sites-enabled/interpoll.conf \
    /etc/nginx/conf.d/interpoll.conf \
    /etc/nginx/conf.d/default.conf; do
  if [[ -f "$candidate" ]]; then
    NGINX_CONF="$candidate"
    break
  fi
done

if [[ -z "$NGINX_CONF" ]]; then
  # Try to find any conf that references our domain
  NGINX_CONF=$(grep -rl "interpoll.endless.sbs" /etc/nginx/ 2>/dev/null | head -1 || echo "")
fi

if [[ -z "$NGINX_CONF" ]]; then
  warn "Could not find active nginx config automatically."
  warn "Will patch the project copy: nginx-interpoll.conf"
  warn "You may need to copy it to /etc/nginx/sites-enabled/ manually."
  NGINX_CONF="/var/www/interpoll/nginx-interpoll.conf"
else
  ok "Found nginx config: $NGINX_CONF"
fi

# ── Step 9: Add install script locations to nginx ─────────────────────────────
if grep -q "install-relay.sh" "$NGINX_CONF" 2>/dev/null; then
  warn "install-relay locations already in nginx — skipping"
else
  cp "$NGINX_CONF" "${NGINX_CONF}.bak.$(date +%Y%m%d-%H%M%S)"
  python3 - << PYEOF
with open('$NGINX_CONF', 'r') as f:
    content = f.read()

install_locs = """
    # Community relay install scripts — publicly downloadable
    location = /install-relay.sh {
        alias /var/www/interpoll/community-relay/install-relay.sh;
        add_header Content-Type text/plain;
    }
    location = /install-relay-vps.sh {
        alias /var/www/interpoll/community-relay/install-relay-vps.sh;
        add_header Content-Type text/plain;
    }

"""

# Insert before "location / {" in the first server block (interpoll.endless.sbs)
content = content.replace(
    '    location / {\n        proxy_pass http://127.0.0.1:3000;',
    install_locs + '    location / {\n        proxy_pass http://127.0.0.1:3000;',
    1
)

with open('$NGINX_CONF', 'w') as f:
    f.write(content)
print('install-relay locations added')
PYEOF
  ok "Added install script locations to nginx"
fi

# ── Step 10: Add wildcard tunnel server block to nginx ────────────────────────
if grep -q "tunnel.interpoll" "$NGINX_CONF" 2>/dev/null; then
  warn "Tunnel server block already in nginx — skipping"
else
  python3 - << PYEOF
tunnel_block = """
# Browser tab relay — wildcard tunnel subdomains
server {
    listen 80;
    server_name ~^(?<subdomain>.+)\\\\.tunnel\\\\.interpoll\\\\.endless\\\\.sbs\$;

    location / {
        proxy_pass http://127.0.0.1:9000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_read_timeout 86400;
    }
}
"""

with open('$NGINX_CONF', 'a') as f:
    f.write(tunnel_block)
print('Tunnel server block appended')
PYEOF
  ok "Added tunnel wildcard server block"
fi

# ── Step 11: Test and reload nginx ────────────────────────────────────────────
if nginx -t 2>/dev/null; then
  ok "Nginx config valid"
  nginx -s reload
  ok "Nginx reloaded"
else
  warn "Nginx config test FAILED — fix $NGINX_CONF before reloading"
  warn "Run: nginx -t   to see the error"
fi

# ── Step 12: Install ws dependency for relay-bridge ──────────────────────────
if node -e "require('ws')" 2>/dev/null; then
  ok "ws package already available"
else
  warn "Installing ws package..."
  npm install ws --save
  ok "ws installed"
fi

# ── Step 13: Restart PM2 ──────────────────────────────────────────────────────
echo ""
echo "Restarting PM2 processes..."

pm2 restart relay-server && ok "relay-server restarted" \
  || warn "relay-server restart failed — run: pm2 restart relay-server"

if pm2 list | grep -q "relay-bridge"; then
  pm2 restart relay-bridge && ok "relay-bridge restarted"
else
  pm2 start ecosystem.config.cjs --only relay-bridge \
    && ok "relay-bridge started" \
    || warn "relay-bridge failed to start — run: pm2 start ecosystem.config.cjs --only relay-bridge"
fi

pm2 save && ok "PM2 state saved"

# ── Done ──────────────────────────────────────────────────────────────────────
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
ok "VPS patch complete!"
echo ""
echo "  Check status:          pm2 status"
echo "  relay-server logs:     pm2 logs relay-server --lines 50"
echo "  relay-bridge logs:     pm2 logs relay-bridge --lines 20"
echo ""
echo "  Test install scripts:"
echo "    curl -I https://interpoll.endless.sbs/install-relay.sh"
echo "    curl -I https://interpoll.endless.sbs/install-relay-vps.sh"
echo ""
echo "  Test bridge:"
echo "    curl -s http://localhost:9000"
echo ""
echo "  STILL NEEDED (in DNS dashboard):"
echo "    Add wildcard A record:"
echo "    *.tunnel.interpoll.endless.sbs  →  $(curl -s ifconfig.me 2>/dev/null || echo '<your VPS IP>')"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

cat << 'MANUAL'

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
MANUAL FALLBACK (only needed if any step showed a warning)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

── PoW patch ─────────────────────────────────────────────

In relay-server/relay-server-enhanced.js:

1. After this line:
     import { PowChallenge } from '../pow-challenge.js';
   Add:
     import { verifyPoWClientOrServer } from '../backend/pow-server-patch.js';

2. Replace:
     const powResult = powChallenge.verify(powPayload.pow.challengeId, powPayload.pow.nonce);
   With:
     const powResult = verifyPoWClientOrServer(powPayload.pow, powChallenge.activeChallenges);

3. Replace:
     if (!powResult.valid) {
   With:
     if (!powResult.ok) {

── ecosystem.config.cjs ──────────────────────────────────

Add inside apps: [ ... ] before the closing ]:

    {
      name: 'relay-bridge',
      script: './backend/relay-bridge-server.js',
      cwd: '/var/www/interpoll',
      interpreter: 'node',
      env: { TUNNEL_DOMAIN: 'tunnel.interpoll.endless.sbs' },
      max_memory_restart: '200M',
      restart_delay: 3000,
    },

Then: pm2 start ecosystem.config.cjs --only relay-bridge && pm2 save

MANUAL