#!/usr/bin/env bash
# Starts the demo server: its own database (data/pglite-demo), accounts off, bge-m3 on RunPod,
# no scheduled Job Market Researcher run, staff screens open (no admin token; localhost demo only).
# DATABASE_URL is blanked so a Postgres URL in .env can never point the demo at a real database.
# Usage (Git Bash, from the repo root):  bash demo/start.sh      then open http://localhost:4330/app
set -euo pipefail
cd "$(dirname "$0")/.."
export PORT="${DEMO_PORT:-4330}" PGLITE_DIR=data/pglite-demo DATABASE_URL= \
  SUPABASE_URL= SUPABASE_ANON_KEY= ADMIN_TOKEN= \
  EMBED_PROVIDER=runpod SCOUT_SCHEDULE=off
exec npx tsx server/index.ts
