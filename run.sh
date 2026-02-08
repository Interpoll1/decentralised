#!/usr/bin/env bash

SESSION=decentralised

# If session exists, just attach
tmux has-session -t "$SESSION" 2>/dev/null && {
  tmux attach -t "$SESSION"
  exit 0
}

# Create session with first pane
tmux new-session -d -s "$SESSION" -n services

# Pane 1: npm dev
tmux send-keys -t "$SESSION:services.0" "npm run dev" C-m

# Split right → Pane 2
tmux split-window -h -t "$SESSION:services"
tmux send-keys -t "$SESSION:services.1" "node relay-server.js" C-m

# Split right again → Pane 3
tmux split-window -h -t "$SESSION:services"
tmux send-keys -t "$SESSION:services.2" "cd gun-relay-server && node gun-relay.js" C-m

# Make panes evenly sized
tmux select-layout -t "$SESSION:services" even-horizontal

# Attach
tmux attach -t "$SESSION"
