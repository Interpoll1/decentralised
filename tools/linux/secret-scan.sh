#!/usr/bin/env bash
set -euo pipefail
# shellcheck source=tools/linux/common.sh
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

FAIL_ON_FINDING=false
INCLUDE_DOCS=false

exit_secret_scan_failed() {
  local reason="$1"
  local code="${2:-1}"
  printf '\n' >&2
  printf 'FAILED: Secret scan failed.\n' >&2
  printf 'Reason: %s\n' "$reason" >&2
  printf 'Exit code: %s\n' "$code" >&2
  if [[ "${PAUSE_ON_FAILURE:-false}" == "true" ]]; then
    printf '\n' >&2
    printf 'Press Enter to exit...' >&2
    read -r || true
  fi
  exit "$code"
}

show_help() {
  cat <<'EOF'
Usage: secret-scan.sh [options]

  --fail-on-finding   Exit with status 1 when potential secrets are found
  --include-docs      Include markdown/text and docs/ paths
  --pause-on-failure  Pause after a failure (stdin) before exiting
  --help, -h          Show this help

EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --fail-on-finding) FAIL_ON_FINDING=true; shift ;;
    --include-docs) INCLUDE_DOCS=true; shift ;;
    --pause-on-failure) PAUSE_ON_FAILURE=true; shift ;;
    --help | -h) show_help; exit 0 ;;
    *) exit_secret_scan_failed "Unknown option: $1" 1 ;;
  esac
done

RULE_NAMES=(
  'Private key block'
  'Generic assignment secret'
  'Bearer token'
  'Google API key'
  'GitHub token'
  'Slack token'
  'AWS access key'
  'Possible JWT'
)
RULE_PATTERNS=(
  '-----BEGIN\s+(?:RSA|DSA|EC|OPENSSH|PGP)?\s*PRIVATE\s+KEY-----'
  '(?i)\b(?:api[_-]?key|secret|token|password|passwd|pwd|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["'\'']\K[A-Za-z0-9_\-./+=]{24,}(?=["'\''])'
  '(?i)\bBearer\s+\K[A-Za-z0-9_\-./+=]{24,}'
  'AIza[0-9A-Za-z_\-]{35}'
  'gh[opsu]_[A-Za-z0-9_]{36,}'
  'xox[baprs]-[A-Za-z0-9\-]{20,}'
  'AKIA[0-9A-Z]{16}'
  'eyJ[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}\.[A-Za-z0-9_\-]{10,}'
)

SKIP_PATH_PATTERNS=(
  '(^|/)node_modules/'
  '(^|/)dist/'
  '(^|/)dist-ssr/'
  '(^|/)build/'
  '(^|/)coverage/'
  '(^|/)\.cache/'
  '(^|/)peer-data/'
  '(^|/)radata/'
  '(^|/)app/gun-relay-server/radata/'
  '(^|/)gun-relay-server/radata/'
  '(^|/)relay-server/data/'
  '(^|/)message-cache\.json$'
  '(^|/)storage\.txt$'
  '(^|/)package-lock\.json$'
  '(^|/)app\.zip$'
  '(^|/)shared-validation\.zip$'
)

BINARY_EXTENSIONS=(
  '.zip' '.7z' '.gz' '.tar' '.tgz' '.png' '.jpg' '.jpeg' '.gif'
  '.webp' '.ico' '.svgz' '.pdf' '.woff' '.woff2' '.ttf' '.eot'
  '.mp4' '.webm' '.mov' '.mp3' '.wav' '.wasm'
)

DOC_EXTENSIONS=('.md' '.markdown' '.txt')

to_slash_path() {
  printf '%s' "${1//\\//}"
}

extension_lower() {
  local base="${1##*/}"
  local ext=""
  if [[ "$base" == *.* ]]; then
    ext=".${base##*.}"
  fi
  printf '%s' "${ext,,}"
}

is_binary_extension() {
  local want="$1"
  local e
  for e in "${BINARY_EXTENSIONS[@]}"; do
    if [[ "$want" == "$e" ]]; then
      return 0
    fi
  done
  return 1
}

is_doc_extension() {
  local want="$1"
  local e
  for e in "${DOC_EXTENSIONS[@]}"; do
    if [[ "$want" == "$e" ]]; then
      return 0
    fi
  done
  return 1
}

matches_any_pattern() {
  local path="$1"
  local pat
  for pat in "${SKIP_PATH_PATTERNS[@]}"; do
    if [[ "$path" =~ $pat ]]; then
      return 0
    fi
  done
  return 1
}

matches_docs_dir() {
  [[ "$1" =~ (^|/)docs/ ]]
}

should_scan_path() {
  local rel="$1"
  local slash ext

  slash="$(to_slash_path "$rel")"
  if matches_any_pattern "$slash"; then
    return 1
  fi

  ext="$(extension_lower "$slash")"
  if is_binary_extension "$ext"; then
    return 1
  fi

  if [[ "$INCLUDE_DOCS" != "true" ]]; then
    if is_doc_extension "$ext" || matches_docs_dir "$slash"; then
      return 1
    fi
  fi

  return 0
}

is_binary_or_empty_file() {
  local f="$1"
  # GNU grep -I treats files containing NUL bytes as binary and returns no match.
  # Empty files also return no match; skipping them is equivalent to scanning cleanly.
  ! LC_ALL=C grep -Iq . "$f" 2>/dev/null
}

trim_space() {
  local s="$1"
  s="${s#"${s%%[![:space:]]*}"}"
  s="${s%"${s##*[![:space:]]}"}"
  printf '%s' "$s"
}

redact_secret_text() {
  local val="$1"
  local len=${#val}
  local prefix_length suffix_length prefix suffix

  if ((len <= 8)); then
    printf '%s' '<redacted>'
    return 0
  fi

  if ((len < 4)); then
    prefix_length=$len
  else
    prefix_length=4
  fi

  suffix_length=$((len - prefix_length))
  if ((suffix_length > 4)); then
    suffix_length=4
  fi
  if ((suffix_length < 0)); then
    suffix_length=0
  fi

  prefix="${val:0:prefix_length}"
  suffix="${val: -suffix_length}"
  printf '%s...%s' "$prefix" "$suffix"
}

redacted_line_preview() {
  local line="$1"
  local secret="$2"
  local redacted preview
  redacted="$(redact_secret_text "$secret")"
  preview="${line//"$secret"/"$redacted"}"
  trim_space "$preview"
}

resolve_tracked_file_or_exit() {
  local rel="$1"
  local root_full candidate prefix

  if ! command -v realpath >/dev/null 2>&1; then
    exit_secret_scan_failed "Required command 'realpath' was not found on PATH." 1
  fi

  root_full="$(realpath "$REPO_ROOT")"
  candidate="$(realpath -m "$REPO_ROOT/$rel")"
  prefix="${root_full}/"
  if [[ "$candidate" != "$root_full" && "$candidate" != "${prefix}"* ]]; then
    exit_secret_scan_failed "Path '${rel}' resolves outside the repo root." 1
  fi
  printf '%s' "$candidate"
}

if ! grep -P '' <<<'' >/dev/null 2>&1; then
  exit_secret_scan_failed "This script requires GNU grep with PCRE support ('grep -P')." 1
fi

printf 'Scanning tracked files only (git ls-files). Untracked files are not included.\n'

FINDING_RELS=()
FINDING_LINES=()
FINDING_RULES=()
FINDING_PREVIEWS=()

tracked_list_tmp="$(mktemp "${TMPDIR:-/tmp}/secret-scan.ls.XXXXXX")"
trap 'rm -f "$tracked_list_tmp"' EXIT

if ! command -v git >/dev/null 2>&1; then
  exit_secret_scan_failed "Required command 'git' was not found on PATH." 1
fi

set +e
(
  cd "$REPO_ROOT" || exit 1
  git -c core.quotepath=false ls-files -z
) >"$tracked_list_tmp"
git_st=$?
set -e

if [[ "$git_st" -ne 0 ]]; then
  exit_secret_scan_failed "git ls-files failed with exit code ${git_st}" "$git_st"
fi

while IFS= read -r -d '' rel || [[ -n "${rel-}" ]]; do
  [[ -z "${rel:-}" ]] && continue

  if ! should_scan_path "$rel"; then
    continue
  fi

  abs="$(resolve_tracked_file_or_exit "$rel")"
  if [[ ! -f "$abs" ]] || [[ ! -r "$abs" ]]; then
    continue
  fi

  if is_binary_or_empty_file "$abs"; then
    continue
  fi

  for rule_idx in "${!RULE_NAMES[@]}"; do
    rule_name="${RULE_NAMES[$rule_idx]}"
    pattern="${RULE_PATTERNS[$rule_idx]}"

    while IFS= read -r hit || [[ -n "${hit-}" ]]; do
      [[ -z "${hit:-}" ]] && continue

      line_num="${hit%%:*}"
      if [[ ! "$line_num" =~ ^[0-9]+$ ]]; then
        continue
      fi

      match="${hit#"$line_num":}"

      line="$(sed -n "${line_num}p" "$abs" 2>/dev/null || true)"
      line="${line%$'\r'}"
      match_preview="$(redacted_line_preview "$line" "$match")"

      FINDING_RELS+=("$rel")
      FINDING_LINES+=("$line_num")
      FINDING_RULES+=("$rule_name")
      FINDING_PREVIEWS+=("$match_preview")
    done < <(grep -Pon "$pattern" -- "$abs" 2>/dev/null || true)
  done
done <"$tracked_list_tmp"

count="${#FINDING_RELS[@]}"
if [[ "$count" -eq 0 ]]; then
  printf 'No high-confidence hard-coded secrets found in tracked text files.\n'
  exit 0
fi

printf 'Potential hard-coded secrets found: %s\n' "$count" >&2
idx=0
for ((idx = 0; idx < count; idx++)); do
  printf -- '- %s:%s [%s] %s\n' \
    "${FINDING_RELS[$idx]}" \
    "${FINDING_LINES[$idx]}" \
    "${FINDING_RULES[$idx]}" \
    "${FINDING_PREVIEWS[$idx]}" >&2
done

if [[ "$FAIL_ON_FINDING" == "true" ]]; then
  exit_secret_scan_failed "Secret scan found ${count} potential secret(s)." 1
fi

printf '\n'
printf 'Secret scan is report-only by default. Re-run with --fail-on-finding to make findings blocking.\n'
exit 0
