#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=tools/linux/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

AUDIT_LEVEL="high"
PRODUCTION_ONLY=false
JSON_OUTPUT=false

show_help() {
  cat <<'EOF'
Usage: security-audit.sh [options]

  --audit-level <level>   moderate | high | critical (default: high)
  --production-only       Pass --omit=dev to npm audit
  --json                  Pass --json to npm audit
  --pause-on-failure      Pause after a failure (stdin) before exiting
  --help, -h              Show this help

EOF
}

audit_level_valid() {
  case "$1" in
    moderate | high | critical) return 0 ;;
    *) return 1 ;;
  esac
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --audit-level)
      shift
      if [[ $# -lt 1 ]]; then
        die "Missing value for --audit-level." 1
      fi
      if ! audit_level_valid "$1"; then
        die "--audit-level must be one of: moderate, high, critical (got '$1')." 1
      fi
      AUDIT_LEVEL="$1"
      shift
      ;;
    --production-only) PRODUCTION_ONLY=true; shift ;;
    --json) JSON_OUTPUT=true; shift ;;
    --pause-on-failure) PAUSE_ON_FAILURE=true; shift ;;
    --help | -h) show_help; exit 0 ;;
    *)
      die "Unknown option: $1" 1
      ;;
  esac
done

check_package_manager >/dev/null
NPM="$(get_npm_command)"

npm_args=(audit "--audit-level=${AUDIT_LEVEL}")
if [[ "$PRODUCTION_ONLY" == "true" ]]; then
  npm_args+=("--omit=dev")
fi
if [[ "$JSON_OUTPUT" == "true" ]]; then
  npm_args+=("--json")
fi

invoke_in_repo run_logged_command 'Security audit failed.' "$NPM" "${npm_args[@]}"
