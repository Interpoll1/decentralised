#!/usr/bin/env bash
# Two-pane tmux dev setup: Vite dev server + the self-host relay, both local.
# Matches the shape of the repo's top-level run.sh.

set -euo pipefail
cd "$(dirname "$0")/.."

SESSION=selfhost
PORT="${PORT:-8080}"

tmux has-session -t "$SESSION" 2>/dev/null && {
  tmux attach -t "$SESSION"
  exit 0
}

tmux new-session -d -s "$SESSION" -n services

# Pane 0: the relay (also serves the lite client on $PORT).
tmux send-keys -t "$SESSION:services.0" "PORT=$PORT node selfhost/relay/server.js" C-m

# Pane 1: Vite dev server for the full client, pointed at the relay above.
# Vite's own port (5173) serves the app; the relay serves the API and Gun.
tmux split-window -h -t "$SESSION:services"
tmux send-keys -t "$SESSION:services.1" \
  "VITE_SELFHOST=1 VITE_RELAY_WS=ws://localhost:$PORT VITE_RELAY_GUN=http://localhost:$PORT/gun VITE_RELAY_API=http://localhost:$PORT VITE_WEB_ORIGIN=http://localhost:5173 VITE_GUN_PEERS= npm run dev" C-m

tmux select-pane -t "$SESSION:services.0"
tmux attach -t "$SESSION"
