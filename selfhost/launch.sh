#!/usr/bin/env bash
#
# The zero-flags launcher: double-click it (macOS: launch.command) or run
# `./selfhost/launch.sh`. It checks Node, installs dependencies the first time,
# finds a free port, starts the instance, opens a browser, and prints the
# address other devices on the same wifi can use.
#
# Ctrl-C stops everything.

set -uo pipefail
cd "$(dirname "$0")/.."

say()  { printf '%s\n' "$*"; }
fail() { printf '\n  %s\n\n' "$*" >&2; read -r -p "Press Enter to close…" _ 2>/dev/null || true; exit 1; }

say ""
say "  Starting your instance…"
say ""

# ── Node ─────────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  fail "Node.js is not installed. Get it from https://nodejs.org (any version 18 or newer), then run this again."
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if [ "$NODE_MAJOR" -lt 18 ]; then
  fail "Node.js $(node -v) is too old. Version 18 or newer is needed — https://nodejs.org"
fi

# ── Dependencies (first run only) ────────────────────────────────────────────
if [ ! -d node_modules ]; then
  say "  Installing dependencies. This happens once and takes a few minutes…"
  npm install --no-audit --no-fund || fail "Installing dependencies failed. Check your internet connection and try again."
  say ""
fi

# ── Pick a port that is actually free ────────────────────────────────────────
PORT="${PORT:-8080}"
port_busy() { node -e '
  const net = require("net");
  const s = net.createServer();
  s.once("error", () => process.exit(0));   // busy
  s.once("listening", () => s.close(() => process.exit(1)));  // free
  s.listen(Number(process.argv[1]), "0.0.0.0");
' "$1"; }

while port_busy "$PORT"; do
  say "  Port $PORT is in use, trying $((PORT + 1))…"
  PORT=$((PORT + 1))
  [ "$PORT" -gt 8100 ] && fail "Could not find a free port between 8080 and 8100."
done

# ── Edition: lite by default, full only if asked for ─────────────────────────
EDITION="${EDITION:-lite}"
if [ "$EDITION" = "full" ]; then
  say "  Building the full app (a few minutes the first time)…"
  PORT="$PORT" node selfhost/build-full.js || fail "The full app failed to build. The simple version needs no build — run this again without EDITION=full."
fi

LAN_IP="$(node -e '
  const os = require("os");
  const hit = Object.values(os.networkInterfaces()).flat()
    .find(i => i && i.family === "IPv4" && !i.internal);
  process.stdout.write(hit ? hit.address : "");
')"

say ""
say "  ➜  On this computer:  http://localhost:$PORT"
[ -n "$LAN_IP" ] && say "  ➜  On the same wifi:  http://$LAN_IP:$PORT"
say ""

# A QR code is genuinely useful for phones, but only if the machine has an
# encoder. Nothing here installs software behind the operator's back.
if [ -n "$LAN_IP" ] && command -v qrencode >/dev/null 2>&1; then
  qrencode -t ANSIUTF8 "http://$LAN_IP:$PORT"
  say ""
fi

say "  Content disappears after ${RELAY_TTL_HOURS:-24} hours. Press Ctrl-C to stop."
say ""

# Open a browser once the server is actually answering.
(
  for _ in $(seq 1 40); do
    if node -e '
      require("http").get("http://localhost:" + process.argv[1] + "/health",
        r => process.exit(r.statusCode === 200 ? 0 : 1)).on("error", () => process.exit(1));
    ' "$PORT" 2>/dev/null; then
      case "$(uname -s)" in
        Darwin) open "http://localhost:$PORT" >/dev/null 2>&1 ;;
        *)      command -v xdg-open >/dev/null 2>&1 && xdg-open "http://localhost:$PORT" >/dev/null 2>&1 ;;
      esac
      exit 0
    fi
    sleep 0.5
  done
) &

PORT="$PORT" EDITION="$EDITION" exec node selfhost/relay/server.js
