#!/usr/bin/env bash
# macOS double-click entry point. Finder will not run a .sh, so this thin
# wrapper exists purely to give launch.sh an extension macOS will open.
cd "$(dirname "$0")"
exec ./launch.sh
