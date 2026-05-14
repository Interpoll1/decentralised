#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=tools/linux/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SKIP_INSTALL=false

show_help() {
  cat <<'EOF'
Usage: setup.sh [options]

  --skip-install       Skip npm ci (still run node and npm version checks)
  --pause-on-failure   Pause after a failure (stdin) before exiting
  --help, -h           Show this help

EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-install) SKIP_INSTALL=true; shift ;;
    --pause-on-failure) PAUSE_ON_FAILURE=true; shift ;;
    --help | -h) show_help; exit 0 ;;
    *)
      die "Unknown option: $1" 1
      ;;
  esac
done

check_package_manager >/dev/null
check_command node
NPM="$(get_npm_command)"

invoke_in_repo run_logged_command 'Setup failed.' node -v
invoke_in_repo run_logged_command 'Setup failed.' "$NPM" -v

if [[ "$SKIP_INSTALL" == "true" ]]; then
  printf '%s\n' 'Skipping npm ci because --skip-install was provided.'
  exit 0
fi

invoke_in_repo run_logged_command 'Setup failed.' "$NPM" ci
