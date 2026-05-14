#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=tools/linux/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

WATCH=false
TEST_FILTERS=()

show_help() {
  cat <<'EOF'
Usage: test.sh [options]

  --test-filter <pat>   Pass Vitest file filters after -- (repeatable)
  --watch               Run npm run test:watch instead of npm run test
  --pause-on-failure    Pause after a failure (stdin) before exiting
  --help, -h            Show this help

EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --watch) WATCH=true; shift ;;
    --pause-on-failure) PAUSE_ON_FAILURE=true; shift ;;
    --test-filter)
      shift
      if [[ $# -lt 1 ]]; then
        die "Missing value for --test-filter." 1
      fi
      TEST_FILTERS+=("$1")
      shift
      ;;
    --help | -h) show_help; exit 0 ;;
    *)
      die "Unknown option: $1" 1
      ;;
  esac
done

check_package_manager >/dev/null
NPM="$(get_npm_command)"
check_node_modules
check_local_bin vitest >/dev/null

SCRIPT_NAME="test"
if [[ "$WATCH" == "true" ]]; then
  SCRIPT_NAME="test:watch"
fi

npm_args=(run "$SCRIPT_NAME")
if [[ "${#TEST_FILTERS[@]}" -gt 0 ]]; then
  npm_args+=("--")
  npm_args+=("${TEST_FILTERS[@]}")
fi

invoke_in_repo run_logged_command 'Tests failed.' "$NPM" "${npm_args[@]}"
