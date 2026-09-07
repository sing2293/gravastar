#!/bin/bash
# Fetches the two vendor web tools' front-end bundles for local analysis (they are NOT committed).
# usage: tools/re/fetch-vendor-bundles.sh <outdir>
set -euo pipefail
OUT="${1:?outdir}"; UA="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/128.0 Safari/537.36"
get() { mkdir -p "$(dirname "$2")"; curl -sSL -A "$UA" "$1" -o "$2" -w "%{http_code} $2\n"; }
# --- GS HUB shell (support.gravastar.com) ---
get https://support.gravastar.com/devices "$OUT/gshub/index.html"
for f in $(grep -oE '(src|href)="\./assets/[^"]+"' "$OUT/gshub/index.html" | sed -E 's/^(src|href)="\.\///; s/"$//'); do get "https://support.gravastar.com/$f" "$OUT/gshub/$f"; done
for f in $(grep -oE 'm\.f=\[[^]]*\]' "$OUT/gshub/assets/index-"*.js | grep -oE '"[^"]+"' | tr -d '"' | sed 's#^\./##' | sort -u); do get "https://support.gravastar.com/assets/$f" "$OUT/gshub/assets/$f"; done
# --- K98 Pro sub-app (wujie micro-frontend) ---
get https://support.gravastar.com/k98pro-app/ "$OUT/gshub/k98pro-app/index.html"
for f in $(grep -oE '(src|href)="/k98pro-app/[^"]+\.(js|css)"' "$OUT/gshub/k98pro-app/index.html" | sed -E 's/^(src|href)="\/k98pro-app\///; s/"$//'); do get "https://support.gravastar.com/k98pro-app/$f" "$OUT/gshub/k98pro-app/$f"; done
for f in $(grep -oE 'm\.f=\[[^]]*\]' "$OUT/gshub/k98pro-app/js/index-"*.js | grep -oE '"[^"]+"' | tr -d '"' | sort -u); do get "https://support.gravastar.com/k98pro-app/$f" "$OUT/gshub/k98pro-app/$f"; done
# --- Compx HUB WEB mouse tool (controlhub.top) — ships source maps ---
get https://controlhub.top/gravastar/ "$OUT/controlhub/index.html"
for f in $(grep -oE '(src|href)="(js|css)/[^"]+"' "$OUT/controlhub/index.html" | sed -E 's/^(src|href)="//; s/"$//'); do get "https://controlhub.top/gravastar/$f" "$OUT/controlhub/$f"; get "https://controlhub.top/gravastar/$f.map" "$OUT/controlhub/$f.map" || true; done
echo "done → $OUT"
