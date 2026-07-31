#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=tools/linux/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

show_help() {
  cat <<'EOF'
Usage: typecheck.sh [options]

  --pause-on-failure   Pause after a failure (stdin) before exiting
  --help, -h           Show this help

EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --pause-on-failure) PAUSE_ON_FAILURE=true; shift ;;
    --help | -h) show_help; exit 0 ;;
    *)
      die "Unknown option: $1" 1
      ;;
  esac
done

check_package_manager >/dev/null
NPM="$(get_npm_command)"
check_node_modules
check_local_bin vue-tsc >/dev/null

invoke_in_repo run_logged_command 'Typecheck failed.' "$NPM" exec -- vue-tsc --noEmit -p tsconfig.json
