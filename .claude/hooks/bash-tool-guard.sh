#!/bin/bash
# PreToolUse guard for Bash: blocks raw-shell substitutes for Read/Grep/Glob/Edit.
# Reads the hook's JSON payload from stdin, inspects tool_input.command.

set -euo pipefail

input="$(cat)"
cmd="$(printf '%s' "$input" | jq -r '.tool_input.command // empty')"

[ -z "$cmd" ] && exit 0

deny_reason=""

# Top-level statements only (split on && and ;), not on | — piping output into
# grep/head/tail to filter it is fine and encouraged; reading a file with them
# directly is not.
while IFS= read -r stmt; do
  stmt="$(printf '%s' "$stmt" | sed -E 's/^[[:space:]]+//; s/[[:space:]]+$//')"
  [ -z "$stmt" ] && continue

  # first token before any pipe
  head_stmt="${stmt%%|*}"
  first_word="$(printf '%s' "$head_stmt" | awk '{print $1}')"

  case "$first_word" in
    cat|head|tail|ls)
      deny_reason="Use the Read tool instead of Bash '$first_word' to read files (segment: ${stmt:0:80})"
      break
      ;;
    grep)
      deny_reason="Use the Grep tool instead of Bash 'grep' to search files (segment: ${stmt:0:80})"
      break
      ;;
    find)
      deny_reason="Use the Glob tool instead of Bash 'find' to locate files (segment: ${stmt:0:80})"
      break
      ;;
    sed)
      if printf '%s' "$head_stmt" | grep -qE -- '(^|[[:space:]])-i([[:space:]]|$|[^[:alnum:]])'; then
        deny_reason="Use the Edit tool instead of 'sed -i' for in-place file edits (segment: ${stmt:0:80})"
        break
      fi
      ;;
  esac
done < <(printf '%s\n' "$cmd" | tr '&;' '\n\n')

if [ -n "$deny_reason" ]; then
  jq -n --arg reason "$deny_reason" '{
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: $reason
    }
  }'
  exit 0
fi

# Non-blocking nudge: cd chained into a command instead of using absolute paths.
if printf '%s' "$cmd" | grep -qE '^[[:space:]]*cd[[:space:]].*&&'; then
  jq -n '{
    systemMessage: "Reminder: prefer absolute paths over `cd X && ...` — a failed cd silently changes the blast radius of the next command."
  }'
fi

exit 0
