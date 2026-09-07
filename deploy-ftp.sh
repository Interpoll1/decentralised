#!/usr/bin/env bash
#
# Build the frontend and deploy it to endless.sbs over FTP.
#
#   ./deploy-ftp.sh              build + upload
#   ./deploy-ftp.sh --no-build   upload the existing dist/ as-is
#   ./deploy-ftp.sh --dry-run    show what would change, upload nothing
#
# Credentials can be overridden from the environment:
#   FTP_HOST REMOTE_DIR       (optional, have defaults)
#   FTP_USER FTP_PASS         (required - never commit these)
#
set -euo pipefail

FTP_HOST="${FTP_HOST:-185.232.14.177}"
FTP_USER="${FTP_USER:?set FTP_USER}"
FTP_PASS="${FTP_PASS:?set FTP_PASS}"
REMOTE_DIR="${REMOTE_DIR:-/domains/endless.sbs/public_html}"

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DIST="$ROOT/dist"

DO_BUILD=1
DRY=""
for arg in "$@"; do
  case "$arg" in
    --no-build) DO_BUILD=0 ;;
    --dry-run)  DRY="--dry-run" ;;
    -h|--help)  sed -n '2,10p' "${BASH_SOURCE[0]}"; exit 0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

command -v lftp >/dev/null || { echo "lftp is not installed (sudo apt install lftp)" >&2; exit 1; }

# ---------------------------------------------------------------- build
if [ "$DO_BUILD" = 1 ]; then
  echo "==> npm run build"
  cd "$ROOT"
  npm run build
fi

[ -f "$DIST/index.html" ]  || { echo "no $DIST/index.html — build first" >&2; exit 1; }
[ -d "$DIST/assets2" ]     || { echo "no $DIST/assets2 — build output looks wrong" >&2; exit 1; }

echo "==> deploying $DIST  ->  ftp://$FTP_HOST$REMOTE_DIR"
[ -n "$DRY" ] && echo "    (dry run — nothing will be written)"

# ---------------------------------------------------------------- upload
#
# Two passes, deliberately:
#
#  1. assets2/ is mirrored WITH --delete, so stale hashed chunks from previous
#     builds are removed and the directory exactly matches this build.
#  2. everything else is mirrored WITHOUT --delete. The web root also holds
#     unrelated content (blog .html files, .htaccess, .env, favicons), and a
#     --delete pass there would wipe it.
#
# index.html goes last so the site never points at chunks that aren't uploaded
# yet. `put` has no --dry-run, so it is skipped entirely in that mode.
#
if [ -n "$DRY" ]; then
  PUT_INDEX='echo "    (dry run) would put index.html"'
else
  PUT_INDEX='put -O "'"$REMOTE_DIR"'" index.html'
fi

lftp -u "$FTP_USER,$FTP_PASS" "$FTP_HOST" <<LFTP
set ssl:verify-certificate no
set net:timeout 20
set net:max-retries 3
set net:reconnect-interval-base 5
set ftp:ssl-force false
set mirror:parallel-transfer-count 4
set xfer:clobber on

lcd "$DIST"
cd "$REMOTE_DIR"

echo ">>> assets2 (replaced)"
mirror -R $DRY --delete --verbose=1 --parallel=4 assets2 assets2

echo ">>> other build files"
mirror -R $DRY --verbose=1 --parallel=4 \
  --exclude-glob assets2/ \
  --exclude-glob index.html \
  . .

echo ">>> index.html"
$PUT_INDEX

bye
LFTP

echo "==> done: https://endless.sbs/"
