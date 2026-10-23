# RunPod proof of use

HalaTuju uses RunPod in two ways: a **GPU pod** for the final training run of our AI-exposure model, and a **Serverless endpoint** that runs the bge-m3 embedding model whenever the app reads a CV, de-duplicates market signals or checks a new skill against ESCO. The hackathon rule is that any training or running of a model on a GPU must use RunPod; the organisers confirmed that local testing on our own GPU is fine as long as the final training runs on RunPod.

## 1. Final training run (GPU pod)

| Field | Value |
|---|---|
| Pod ID | `38jijj8fe5dazu` |
| GPU | NVIDIA GeForce RTX 4090 (24,564 MiB), Secure Cloud, US$0.89/h |
| Image | `runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04` (torch upgraded to 2.6.0+cu124 in the pod) |
| Pod started | 2026-10-23 18:20:57 UTC (24 Oct 02:20:57 MYT) |
| Pipeline | 18:20:59 → 18:22:59 UTC (2 minutes) |
| Pod terminated | 18:23:28 UTC |
| Pod time and cost | 2.5 minutes, about US$0.04 |
| What ran | `ml/runpod_train.py launch`: download the "GPTs are GPTs" labels (pinned commit, sha256 checked), embed all 19,265 O\*NET tasks with BAAI/bge-m3 on the GPU (**3.9 s**), train the ridge model on 738 occupations, evaluate on 185 held-out occupations |
| Result | Per occupation r 0.919 / MAE 0.065; per task r 0.671 / MAE 0.203 (nearest-neighbour baseline MAE 0.176) |
| Artifacts (in the repo) | [`ml/artifacts/runpod_run.json`](../ml/artifacts/runpod_run.json) (times, cost, failed attempts), [`ml/artifacts/runpod_run.log`](../ml/artifacts/runpod_run.log) (the pod's own log, with `nvidia-smi` output), [`ml/artifacts/exposure_model.json`](../ml/artifacts/exposure_model.json), [`ml/artifacts/eval.json`](../ml/artifacts/eval.json) (`run.where = "runpod"`, `runpodPodId`, GPU, torch version) |

Two earlier pods failed on software versions and were terminated within about a minute each: `uuwdb5w112cnjj` (A40, torch 2.4 too old for current transformers) and `urxftqdjs0xm4i` (RTX 4090, torchvision broke after the torch upgrade). The account balance went from US$22.49 to US$22.43 across all three.

## 2. Serverless embedding endpoint (runtime)

| Field | Value |
|---|---|
| Endpoint ID | `a7ipau1nmqogxs` (name `halatuju-bge-m3`) |
| Template | `0d8iz5b0jr`, image `runpod/worker-infinity-embedding:1.1.4`, `MODEL_NAMES=BAAI/bge-m3` |
| GPU pools | ADA_24 (RTX 4090 class), AMPERE_48, ADA_48_PRO |
| Workers | minimum 0 (scales to zero), maximum 1, idle timeout 120 s, queue-delay scaler |
| Working since | 23 Oct 2026 |
| Cold start / warm request | about 60 s / under 1 s |
| Used for | CV text → candidate ESCO skills (13,939); de-duplicating Job market researcher signals; checking emerging-skill candidates against all of ESCO; embedding new tasks for the exposure model |
| Measured use | All 13,939 ESCO skills embedded and scored in 486 s (`db/seed/esco_skill_scores.json.gz`, 23 Oct 2026 08:15 UTC); CV benchmark: 101 requests, 1,441 texts, 233 s (`eval/RESULTS.md`); emerging-skill runs: 2 calls each (`eval/EMERGING.md`) |
| How the app calls it | `server/lib/embedder.ts`: `POST https://api.runpod.ai/v2/<endpoint>/openai/v1/embeddings` with `RUNPOD_API_KEY` (a Replit Secret) |

Account balance on 24 Oct 2026, 04:30 MYT: **US$20.96** of the US$25 team credit.

## How to verify

1. `ml/artifacts/eval.json` → `run` and `modelRun` both say `"where": "runpod"`, `"runpodPodId": "38jijj8fe5dazu"`, `"gpu": "NVIDIA GeForce RTX 4090"`.
2. `ml/artifacts/runpod_run.log` shows `nvidia-smi` (RTX 4090), the embedding time and the same metrics table.
3. `/api/health` on the live app shows `embed.provider = "runpod-bge-m3"`.
4. With a RunPod key: `curl -X POST https://api.runpod.ai/v2/a7ipau1nmqogxs/openai/v1/embeddings -H "Authorization: Bearer $RUNPOD_API_KEY" -H "Content-Type: application/json" -d '{"model":"BAAI/bge-m3","input":["Reconcile vendor statements"]}'` returns a 1,024-number vector.

## Screenshots (to add from the RunPod console)

> The pods are terminated, so the pod screenshots come from the console's billing / usage history. Save them in this folder and export this page with them as `RUNPOD PROOF OF USE.pdf`.

1. _[screenshot: Billing → usage or pod history showing pod `38jijj8fe5dazu`, RTX 4090, its runtime on 23 Oct 2026]_ → `runpod-pod-38jijj8fe5dazu.png`
2. _[screenshot: Serverless → `halatuju-bge-m3` (`a7ipau1nmqogxs`): GPU type, workers 0–1, the Requests/Metrics tab with recent requests]_ → `runpod-endpoint-a7ipau1nmqogxs.png`
3. _[screenshot: Billing page showing total spend against the US$25 credit]_ → `runpod-billing.png`
4. _[only if it exists: the organisers' message confirming that testing on a local GPU before the final RunPod run is allowed. If there is no such message, ask on Discord before submitting; the final training run was on RunPod either way]_ → `runpod-local-testing-ok.png`
