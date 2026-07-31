#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=tools/linux/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DEFAULT_FILTERS=(
  'ws-validators.test.js'
  'pow-challenge.test.js'
  'security-utils.test.js'
  'rate-limiter.test.js'
  'bot-detector.test.js'
  'spam-scorer.test.js'
  'chainValidation.test.ts'
  'eventService.test.ts'
  'cryptoService.test.ts'
  'config.test.ts'
  'mnemonicHelper.test.ts'
)

show_help() {
  cat <<'EOF'
Usage: adversarial-test.sh [options]

  --test-filter <pat>   Vitest file filters (repeatable). If omitted, built-in defaults are used.
  --pause-on-failure    Pause after a failure (stdin) before exiting (not forwarded to test.sh)
  --help, -h            Show this help

EOF
}

TEST_FILTERS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --test-filter)
      shift
      if [[ $# -lt 1 ]]; then
        die 'Missing value for --test-filter.' 1
      fi
      TEST_FILTERS+=("$1")
      shift
      ;;
    --pause-on-failure) export PAUSE_ON_FAILURE=true; shift ;;
    --help | -h) show_help; exit 0 ;;
    *) die "Unknown option: $1" 1 ;;
  esac
done

if [[ "${#TEST_FILTERS[@]}" -eq 0 ]]; then
  TEST_FILTERS=("${DEFAULT_FILTERS[@]}")
fi

set +e
(
  cd "$REPO_ROOT" || exit 1
  check_package_manager >/dev/null
  get_npm_command >/dev/null
  check_node_modules
  check_local_bin vitest >/dev/null
)
preflight_status=$?
set -e

if [[ "$preflight_status" -ne 0 ]]; then
  die "Adversarial test preflight failed." "$preflight_status"
fi

printf 'Running focused adversarial/security tests:\n'
for f in "${TEST_FILTERS[@]}"; do
  printf '  - %s\n' "$f"
done

TEST_SCRIPT="${SCRIPT_DIR}/test.sh"
filter_args=()
for f in "${TEST_FILTERS[@]}"; do
  filter_args+=('--test-filter' "$f")
done

invoke_in_repo run_logged_command \
  'Adversarial tests failed.' \
  env PAUSE_ON_FAILURE=false bash "$TEST_SCRIPT" "${filter_args[@]}"
