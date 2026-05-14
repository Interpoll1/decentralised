#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=tools/linux/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SKIP_BUILD=false
SKIP_AUDIT=false
TEST_FILTERS=()
TOOLS_LINUX_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

show_help() {
  cat <<'EOF'
Usage: validate.sh [options]

  --skip-build          Skip npm run build
  --skip-audit          Skip security-audit.sh
  --test-filter <pat>   Forward to test.sh (repeatable)
  --pause-on-failure    Pause after a failure (outer script only; not forwarded to children)
  --help, -h            Show this help

EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --skip-build) SKIP_BUILD=true; shift ;;
    --skip-audit) SKIP_AUDIT=true; shift ;;
    --test-filter)
      shift
      if [[ $# -lt 1 ]]; then
        die "Missing value for --test-filter." 1
      fi
      TEST_FILTERS+=("$1")
      shift
      ;;
    --pause-on-failure) PAUSE_ON_FAILURE=true; shift ;;
    --help | -h) show_help; exit 0 ;;
    *)
      die "Unknown option: $1" 1
      ;;
  esac
done

check_package_manager >/dev/null
get_npm_command >/dev/null

# Nested steps do not receive --pause-on-failure
# Outer die() still honors PAUSE_ON_FAILURE for aggregate failures.
run_validate_child() {
  local script_path="$1"
  shift
  run_logged_command 'Validation failed.' env PAUSE_ON_FAILURE=false bash "$script_path" "$@"
}

printf '%s\n' '== Typecheck =='
run_validate_child "$TOOLS_LINUX_DIR/typecheck.sh"

printf '%s\n' '== Tests =='
TEST_ARGS=()
for f in "${TEST_FILTERS[@]}"; do
  TEST_ARGS+=('--test-filter' "$f")
done
run_validate_child "$TOOLS_LINUX_DIR/test.sh" "${TEST_ARGS[@]}"

if [[ "$SKIP_AUDIT" == "true" ]]; then
  printf '%s\n' '== Security audit skipped =='
else
  printf '%s\n' '== Security audit =='
  run_validate_child "$TOOLS_LINUX_DIR/security-audit.sh"
fi

NPM="$(get_npm_command)"

if [[ "$SKIP_BUILD" == "true" ]]; then
  printf '%s\n' '== Build skipped =='
else
  printf '%s\n' '== Build =='
  invoke_in_repo run_logged_command 'Validation failed.' "$NPM" run build
fi
