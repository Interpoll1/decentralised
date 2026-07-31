#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=tools/linux/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

AUDIT_LEVEL="high"
PRODUCTION_ONLY=false
SKIP_AUDIT=false
SKIP_ADVERSARIAL=false
SKIP_SECRET=false
FAIL_ON_SECRET_FINDING=false
ALLOW_NO_CHECKS=false

exit_smoke_failed() {
  local reason="$1"
  local code="${2:-1}"
  printf '\n' >&2
  printf 'FAILED: Security smoke failed.\n' >&2
  printf 'Reason: %s\n' "$reason" >&2
  printf 'Exit code: %s\n' "$code" >&2
  if [[ "${PAUSE_ON_FAILURE:-false}" == "true" ]]; then
    printf '\n' >&2
    printf 'Press Enter to exit...' >&2
    read -r || true
  fi
  exit "$code"
}

audit_level_valid() {
  case "$1" in
    moderate | high | critical) return 0 ;;
    *) return 1 ;;
  esac
}

show_help() {
  cat <<'EOF'
Usage: security-smoke.sh [options]

  --audit-level <level>       moderate | high | critical (default: high)
  --production-only           Pass --omit=dev to security-audit.sh
  --skip-audit                Skip dependency audit
  --skip-adversarial-tests    Skip adversarial-test.sh
  --skip-secret-scan          Skip secret-scan.sh
  --fail-on-secret-finding    Make secret scan findings blocking
  --allow-no-checks           Allow all checks to be intentionally skipped
  --pause-on-failure          Pause after aggregate failure (stdin) before exiting
  --help, -h                  Show this help

EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --audit-level)
      shift
      if [[ $# -lt 1 ]]; then
        exit_smoke_failed 'Missing value for --audit-level.' 1
      fi
      if ! audit_level_valid "$1"; then
        exit_smoke_failed "--audit-level must be one of: moderate, high, critical (got '$1')." 1
      fi
      AUDIT_LEVEL="$1"
      shift
      ;;
    --production-only) PRODUCTION_ONLY=true; shift ;;
    --skip-audit) SKIP_AUDIT=true; shift ;;
    --skip-adversarial-tests) SKIP_ADVERSARIAL=true; shift ;;
    --skip-secret-scan) SKIP_SECRET=true; shift ;;
    --fail-on-secret-finding) FAIL_ON_SECRET_FINDING=true; shift ;;
    --allow-no-checks) ALLOW_NO_CHECKS=true; shift ;;
    --pause-on-failure) PAUSE_ON_FAILURE=true; shift ;;
    --help | -h) show_help; exit 0 ;;
    *) exit_smoke_failed "Unknown option: $1" 1 ;;
  esac
done

set +e
(
  cd "$REPO_ROOT" || exit 1
  check_package_manager >/dev/null
  get_npm_command >/dev/null
)
preflight_status=$?
set -e

if [[ "$preflight_status" -ne 0 ]]; then
  exit_smoke_failed "Security smoke preflight failed." "$preflight_status"
fi

RESULT_NAMES=()
RESULT_STATUS=()
RESULT_EXIT=()

run_smoke_check() {
  local name="$1"
  local script_path="$2"
  shift 2

  printf '== %s ==\n' "$name"

  local cmd_line status
  cmd_line="$(format_command_line env PAUSE_ON_FAILURE=false bash "$script_path" "$@")"
  printf '>> %s\n' "$cmd_line" >&2

  set +e
  invoke_in_repo env PAUSE_ON_FAILURE=false bash "$script_path" "$@"
  status=$?
  set -e

  if [[ "$status" -eq 0 ]]; then
    RESULT_NAMES+=("$name")
    RESULT_STATUS+=('PASS')
    RESULT_EXIT+=(0)
    return 0
  fi

  printf '\n' >&2
  printf 'FAILED: %s failed.\n' "$name" >&2
  printf 'Command: %s\n' "$cmd_line" >&2
  printf 'Exit code: %s\n' "$status" >&2
  printf '\n' >&2

  RESULT_NAMES+=("$name")
  RESULT_STATUS+=('FAIL')
  RESULT_EXIT+=("$status")
}

if [[ "$SKIP_ADVERSARIAL" == "true" ]]; then
  printf '== Adversarial tests skipped ==\n'
else
  run_smoke_check 'Adversarial tests' "${SCRIPT_DIR}/adversarial-test.sh"
fi

if [[ "$SKIP_SECRET" == "true" ]]; then
  printf '== Secret scan skipped ==\n'
else
  secret_args=()
  if [[ "$FAIL_ON_SECRET_FINDING" == "true" ]]; then
    secret_args+=('--fail-on-finding')
  fi
  run_smoke_check 'Secret scan' "${SCRIPT_DIR}/secret-scan.sh" "${secret_args[@]}"
fi

if [[ "$SKIP_AUDIT" == "true" ]]; then
  printf '== Security audit skipped ==\n'
else
  audit_args=(--audit-level "$AUDIT_LEVEL")
  if [[ "$PRODUCTION_ONLY" == "true" ]]; then
    audit_args+=(--production-only)
  fi
  run_smoke_check 'Dependency audit' "${SCRIPT_DIR}/security-audit.sh" "${audit_args[@]}"
fi

printf '\n'
printf '== Security smoke summary ==\n'

if [[ "${#RESULT_NAMES[@]}" -eq 0 ]]; then
  printf 'No checks were run.\n'
  if [[ "$ALLOW_NO_CHECKS" == "true" ]]; then
    printf 'No-op security smoke run allowed because --allow-no-checks was provided.\n'
    exit 0
  fi

  printf '\n' >&2
  printf 'FAILED: Security smoke failed.\n' >&2
  printf 'Reason: Security smoke refused to pass because no checks were run. Re-run with --allow-no-checks for an intentional no-op.\n' >&2
  printf 'Exit code: 1\n' >&2
  if [[ "${PAUSE_ON_FAILURE:-false}" == "true" ]]; then
    printf '\n' >&2
    printf 'Press Enter to exit...' >&2
    read -r || true
  fi
  exit 1
fi

idx=0
for ((idx = 0; idx < ${#RESULT_NAMES[@]}; idx++)); do
  printf '%s: %s (exit %s)\n' "${RESULT_NAMES[$idx]}" "${RESULT_STATUS[$idx]}" "${RESULT_EXIT[$idx]}"
done

first_fail_name=""
first_fail_code=""
for ((idx = 0; idx < ${#RESULT_NAMES[@]}; idx++)); do
  if [[ "${RESULT_EXIT[$idx]}" -ne 0 ]]; then
    first_fail_name="${RESULT_NAMES[$idx]}"
    first_fail_code="${RESULT_EXIT[$idx]}"
    break
  fi
done

if [[ -n "$first_fail_name" ]]; then
  printf '\n' >&2
  printf 'FAILED: Security smoke failed.\n' >&2
  printf 'Reason: Security smoke failed. First failing check: %s.\n' "$first_fail_name" >&2
  printf 'Exit code: %s\n' "$first_fail_code" >&2
  if [[ "${PAUSE_ON_FAILURE:-false}" == "true" ]]; then
    printf '\n' >&2
    printf 'Press Enter to exit...' >&2
    read -r || true
  fi
  exit "$first_fail_code"
fi

exit 0
