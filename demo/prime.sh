#!/usr/bin/env bash
# Run once the demo server is up: wakes the RunPod embedder and puts the recorded Job Market Researcher run
# (real Microsoft source, 22 Oct 2026, labelled "replayed") into the review queue.
set -euo pipefail
API="http://localhost:${DEMO_PORT:-4330}/api"
for i in $(seq 1 60); do curl -sf "$API/health" >/dev/null && break; sleep 2; done
echo "Waking RunPod (bge-m3)..."
curl -s -o /dev/null -w "  embed warm-up: HTTP %{http_code} in %{time_total}s\n" -m 300 \
  -H "content-type: application/json" -d '{"tasks":["Reconcile vendor statements to the ledger"]}' "$API/exposure/score"
if curl -s "$API/scout/runs?kind=scout" | grep -q '"status":"replayed"'; then
  echo "Recorded Job Market Researcher run already in the queue."
else
  echo "Replaying the recorded Job Market Researcher run into the review queue..."
  curl -s -o /dev/null -w "  replay: HTTP %{http_code} in %{time_total}s\n" -m 120 \
    -H "content-type: application/json" -d '{"replay":true}' "$API/scout/run"
fi
curl -s "$API/health" | grep -o '"embed":{[^}]*}' || true
echo "Ready: http://localhost:${DEMO_PORT:-4330}/app"
