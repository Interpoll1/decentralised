#!/bin/bash
# Stop hook: on long sessions, remind to write/update HANDOFF.md at the repo root.
# Rationale: sessions have hit context/session limits mid-task with no checkpoint,
# stranding work (Tauri app, resilience suite, comment-counter investigation).

set -euo pipefail

REPO_ROOT="/home/viktor/Documents/interpoll2/decentralised"
HANDOFF="$REPO_ROOT/HANDOFF.md"
MIN_MESSAGES=30

input="$(cat)"
transcript_path="$(printf '%s' "$input" | jq -r '.transcript_path // empty')"

[ -z "$transcript_path" ] && exit 0
[ -f "$transcript_path" ] || exit 0

msg_count="$(wc -l < "$transcript_path" | tr -d ' ')"
[ "$msg_count" -lt "$MIN_MESSAGES" ] && exit 0

session_start_epoch="$(head -n 1 "$transcript_path" | jq -r '.timestamp // empty' | { read -r ts; [ -n "$ts" ] && date -d "$ts" +%s 2>/dev/null || echo 0; })"

if [ ! -f "$HANDOFF" ]; then
  jq -n '{
    systemMessage: "Long session, no HANDOFF.md at repo root — consider writing one (what'\''s done, what'\''s in-flight with file:line, next 3 steps, verify commands, <60 lines) before this session runs out of room."
  }'
  exit 0
fi

handoff_mtime="$(stat -c %Y "$HANDOFF" 2>/dev/null || echo 0)"

if [ "$session_start_epoch" -gt 0 ] && [ "$handoff_mtime" -lt "$session_start_epoch" ]; then
  jq -n '{
    systemMessage: "HANDOFF.md exists but has not been updated this session — consider refreshing it (done/in-flight/next-steps/verify commands) before stopping."
  }'
fi

exit 0
