#!/usr/bin/env bash
# Wipes the demo database so the next start reseeds it (sample persona, review queue, recorded Job Market Researcher run).
# Stop the demo server first (Ctrl+C in its window). Never touches data/pglite (the main dev database).
set -euo pipefail
cd "$(dirname "$0")/.."
rm -rf data/pglite-demo
echo "Demo database wiped. Now: bash demo/start.sh, then (in a second window) bash demo/prime.sh"
echo "In the browser, clear this site's storage too (DevTools > Application > Clear site data)."
