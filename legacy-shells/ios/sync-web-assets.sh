#!/usr/bin/env bash
# Sync the web app (index.html, piexif.js) from the project root into the iOS www folder.
# Run from the "ios" folder:  ./sync-web-assets.sh
set -euo pipefail
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(dirname "$here")"
www="$here/QR-RTU-Audit/www"
mkdir -p "$www"
cp -f "$root/index.html" "$www/index.html"
cp -f "$root/piexif.js"  "$www/piexif.js"
echo "Synced web assets into $www"
ls -la "$www"
