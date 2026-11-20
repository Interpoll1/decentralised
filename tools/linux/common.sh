#!/usr/bin/env bash
# Shared helpers for Linux contributor scripts (sourced by tools/linux/*.sh).
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
export REPO_ROOT

if [[ ! -f "$REPO_ROOT/package.json" ]]; then
  printf "Could not resolve repo root from '%s'. Missing package.json at '%s'.\n" "$SCRIPT_DIR" "$REPO_ROOT/package.json" >&2
  exit 1
fi

PAUSE_ON_FAILURE="${PAUSE_ON_FAILURE:-false}"

# Last failed subprocess
INTERPOLL_LAST_COMMAND_EXIT_CODE="${INTERPOLL_LAST_COMMAND_EXIT_CODE:-0}"
INTERPOLL_LAST_COMMAND_LINE="${INTERPOLL_LAST_COMMAND_LINE:-}"
export INTERPOLL_LAST_COMMAND_EXIT_CODE
export INTERPOLL_LAST_COMMAND_LINE

die() {
  local summary="${1:-Operation failed}"
  local code="${2:-1}"
  local cmd_line="${3:-}"
  if ! [[ "$code" =~ ^[0-9]+$ ]]; then
    code=1
  fi

  printf '\n' >&2
  printf 'FAILED: %s\n' "$summary" >&2
  if [[ -n "$cmd_line" ]]; then
    printf 'Command: %s\n' "$cmd_line" >&2
  else
    printf 'Reason: %s\n' "$summary" >&2
  fi
  printf 'Exit code: %s\n' "$code" >&2

  if [[ "${PAUSE_ON_FAILURE}" == "true" ]]; then
    printf '\n' >&2
    printf 'Press Enter to exit...' >&2
    read -r || true
  fi
  exit "$code"
}

format_command_line() {
  local out="" first=true part escaped
  for part in "$@"; do
    if [[ "$first" == true ]]; then
      first=false
    else
      out+=" "
    fi
    if [[ -z "$part" ]]; then
      out+='""'
      continue
    fi
    if [[ "$part" =~ [[:space:]\"] ]]; then
      escaped="${part//\"/\\\"}"
      out+="\"${escaped}\""
    else
      out+="$part"
    fi
  done
  printf '%s' "$out"
}

run_logged_command() {
  local fail_summary="${1:?failure summary required}"
  shift
  if [[ "$#" -lt 1 ]]; then
    die "No command was provided to run_logged_command." 1
  fi

  local cmd_line status
  cmd_line="$(format_command_line "$@")"
  printf '>> %s\n' "$cmd_line" >&2
  INTERPOLL_LAST_COMMAND_EXIT_CODE=0
  INTERPOLL_LAST_COMMAND_LINE=""
  export INTERPOLL_LAST_COMMAND_EXIT_CODE INTERPOLL_LAST_COMMAND_LINE
  set +e
  "$@"
  status=$?
  set -e
  if [[ "$status" -ne 0 ]]; then
    INTERPOLL_LAST_COMMAND_EXIT_CODE=$status
    INTERPOLL_LAST_COMMAND_LINE=$cmd_line
    export INTERPOLL_LAST_COMMAND_EXIT_CODE INTERPOLL_LAST_COMMAND_LINE
    die "$fail_summary" "$status" "$cmd_line"
  fi
}

check_command() {
  local name="${1:?command name required}"
  if ! command -v -- "$name" >/dev/null 2>&1; then
    die "Required command '${name}' was not found on PATH." 1
  fi
}

get_npm_command() {
  check_command npm
  printf '%s\n' npm
}

read_package_manager_field() {
  local pj="$REPO_ROOT/package.json"
  local pm st

  if command -v python3 >/dev/null 2>&1; then
    set +e
    pm="$(python3 -c 'import json,sys; p=json.load(open(sys.argv[1],encoding="utf-8")); print(p.get("packageManager") or "")' "$pj" 2>/dev/null)"
    st=$?
    set -e
    if [[ "$st" -eq 0 ]]; then
      printf '%s' "$pm"
      return 0
    fi
  fi

  if grep -q '"packageManager"' "$pj" 2>/dev/null; then
    pm="$(sed -n 's/^[[:space:]]*"packageManager"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$pj" | head -n1)"
    if [[ -n "$pm" ]]; then
      printf '%s' "$pm"
      return 0
    fi
    die "package.json declares packageManager but it could not be parsed. Install python3 or fix package.json." 1
  fi
  printf ''
}

join_by_comma_space() {
  local joined="" item
  for item in "$@"; do
    if [[ -n "$joined" ]]; then
      joined+=", "
    fi
    joined+="$item"
  done
  printf '%s' "$joined"
}

check_package_manager() {
  local package_lock="$REPO_ROOT/package-lock.json"
  if [[ ! -f "$package_lock" ]]; then
    die "This repo expects npm, but package-lock.json was not found." 1
  fi

  local unexpected_locks=(
    "pnpm-lock.yaml"
    "yarn.lock"
    "bun.lock"
    "bun.lockb"
    "npm-shrinkwrap.json"
  )
  local present=()
  local lock
  for lock in "${unexpected_locks[@]}"; do
    if [[ -f "$REPO_ROOT/$lock" ]]; then
      present+=("$lock")
    fi
  done
  if [[ "${#present[@]}" -gt 0 ]]; then
    local joined
    joined="$(join_by_comma_space "${present[@]}")"
    die "Ambiguous package manager lockfiles found: ${joined}. This script only supports npm for this repo." 1
  fi

  local pm
  pm="$(read_package_manager_field)"
  if [[ -n "$pm" ]] && [[ ! "$pm" =~ ^npm@ ]]; then
    die "package.json declares packageManager '${pm}', but package-lock.json indicates npm." 1
  fi

  printf '%s\n' npm
}

check_node_modules() {
  if [[ ! -d "$REPO_ROOT/node_modules" ]]; then
    die "node_modules is missing. Run 'tools/linux/setup.sh' first." 1
  fi
}

check_local_bin() {
  local bin_name="${1:?binary name required}"
  local bin_path="$REPO_ROOT/node_modules/.bin/$bin_name"
  if [[ ! -f "$bin_path" ]] || [[ ! -x "$bin_path" ]]; then
    die "Local npm binary '${bin_name}' was not found under node_modules/.bin. Run 'tools/linux/setup.sh' first." 1
  fi
  printf '%s\n' "$bin_path"
}

invoke_in_repo() {
  local _prev=$PWD ec=0 cd_status=0 restore_errexit=false
  if [[ $- == *e* ]]; then
    restore_errexit=true
  fi

  cd "$REPO_ROOT" || die "Could not change directory to REPO_ROOT: ${REPO_ROOT}" 1
  set +e
  "$@"
  ec=$?
  cd "$_prev" >/dev/null 2>&1
  cd_status=$?
  if [[ "$restore_errexit" == "true" ]]; then
    set -e
  fi
  if [[ "$cd_status" -ne 0 ]]; then
    die "Could not restore working directory to: ${_prev}" 1
  fi
  return "$ec"
}
