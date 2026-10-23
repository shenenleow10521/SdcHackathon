"""Final training run on a RunPod GPU pod (the hackathon requires GPU training on RunPod).

  python ml/runpod_train.py launch      # create the pod and start the pipeline; prints the pod id
  python ml/runpod_train.py status      # pod state + pipeline log tail
  python ml/runpod_train.py fetch       # download artifacts into ml/artifacts/ when done
  python ml/runpod_train.py terminate   # ALWAYS run this afterwards (stopping is not enough)

The ml/ scripts and the seed catalogue are packed into an environment variable, so no git repo is needed.
The pod serves only the artifacts folder and the run log on port 8000 (read-only), via RunPod's proxy.
Take the proof screenshots (pod id, GPU type, runtime/billing) in the RunPod console while it runs.
Needs RUNPOD_API_KEY (or run_pod_key) in .env. Uses only the Python standard library.
"""
import base64
import io
import json
import os
import sys
import tarfile
import time
import urllib.error
import urllib.request
from pathlib import Path

ML = Path(__file__).resolve().parent
ROOT = ML.parent
STATE = ML / "data" / "runpod_pod.json"
IMAGE = "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04"
GPUS = ["NVIDIA GeForce RTX 4090", "NVIDIA RTX A5000", "NVIDIA L4", "NVIDIA A40", "NVIDIA RTX A4500"]
FILES = ["common.py", "prepare_data.py", "embed.py", "train.py", "evaluate.py", "requirements.txt", "SOURCES.md"]
ARTIFACTS = ["exposure_model.json", "eval.json", "split.json", "run.log"]


def api_key() -> str:
    env = dict(os.environ)
    dotenv = ROOT / ".env"
    if dotenv.exists():
        for line in dotenv.read_text(encoding="utf-8").splitlines():
            if "=" in line and not line.strip().startswith("#"):
                k, v = line.split("=", 1)
                env.setdefault(k.strip(), v.strip().strip("'\""))
    key = env.get("RUNPOD_API_KEY") or env.get("run_pod_key")
    if not key:
        sys.exit("No RunPod key: set RUNPOD_API_KEY in .env")
    return key


def rest(method: str, path: str, body=None):
    req = urllib.request.Request(f"https://rest.runpod.io/v1{path}", method=method,
                                 data=json.dumps(body).encode() if body is not None else None,
                                 headers={"Authorization": f"Bearer {api_key()}", "Content-Type": "application/json",
                                          "User-Agent": "HalaTuju-ml/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            raw = r.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f"RunPod API {method} {path} -> HTTP {e.code}: {e.read().decode()[:500]}")


def bundle() -> str:
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        for f in FILES:
            tar.add(ML / f, arcname=f"repo/ml/{f}")
        tar.add(ROOT / "db" / "seed" / "knowledge.json", arcname="repo/db/seed/knowledge.json")
    return base64.b64encode(buf.getvalue()).decode()


START = r"""set -o pipefail
mkdir -p /workspace/out && cd /workspace && echo "$ML_BUNDLE" | base64 -d | tar xz
cd /workspace/repo/ml && mkdir -p artifacts
( echo "== start $(date -u)"; nvidia-smi --query-gpu=name,memory.total --format=csv;
  pip install -q -r requirements.txt && python prepare_data.py && python embed.py && python train.py && python evaluate.py \
  && echo "== DONE $(date -u)" || echo "== FAILED $(date -u)" ) 2>&1 | grep --line-buffered -v "Batches" | tee artifacts/run.log
cd artifacts && python -m http.server 8000
"""


def launch():
    if STATE.exists():
        sys.exit(f"A pod is already recorded in {STATE}. Run 'terminate' first.")
    pod = rest("POST", "/pods", {
        "name": "halatuju-exposure-training", "imageName": IMAGE, "cloudType": os.environ.get("RUNPOD_CLOUD", "COMMUNITY"),  # SECURE if community is sold out
        "gpuTypeIds": GPUS, "gpuCount": 1, "containerDiskInGb": 30, "volumeInGb": 0,
        "ports": ["8000/http"], "env": {"ML_BUNDLE": bundle()},
        "dockerStartCmd": ["bash", "-c", START],
    })
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps({"id": pod["id"], "created": time.time()}), encoding="utf-8")
    print(f"Pod {pod['id']} created ({pod.get('machine', {}).get('gpuTypeId') or pod.get('gpuTypeIds') or ''}). "
          f"Cost/hr: {pod.get('costPerHr')}. Take screenshots in the RunPod console now.")


def pod_id() -> str:
    if not STATE.exists():
        sys.exit("No pod recorded. Run 'launch' first.")
    return json.loads(STATE.read_text(encoding="utf-8"))["id"]


def proxy(path: str) -> bytes | None:
    try:
        req = urllib.request.Request(f"https://{pod_id()}-8000.proxy.runpod.net/{path}", headers={"User-Agent": "HalaTuju-ml/0.1"})
        with urllib.request.urlopen(req, timeout=30) as r:
            return r.read()
    except Exception:
        return None


def status():
    p = rest("GET", f"/pods/{pod_id()}")
    print(json.dumps({k: p.get(k) for k in ("id", "desiredStatus", "costPerHr", "gpu", "machine", "lastStartedAt")}, indent=1, default=str))
    log = proxy("run.log")
    print((log or b"(log not served yet: pipeline still running or pod starting)").decode(errors="replace")[-2500:])


def fetch():
    log = proxy("run.log")
    if not log or b"== DONE" not in log:
        sys.exit("Pipeline not finished yet (no '== DONE' in run.log). Try 'status'.")
    out = ML / "artifacts"
    for name in ARTIFACTS:
        data = proxy(name)
        if data is None:
            sys.exit(f"Couldn't download {name}")
        (out / ("runpod_run.log" if name == "run.log" else name)).write_bytes(data)
        print(f"saved ml/artifacts/{'runpod_run.log' if name == 'run.log' else name} ({len(data)} bytes)")
    run = json.loads((out / "exposure_model.json").read_text(encoding="utf-8"))["run"]
    print(f"Trained on: {run['where']} / {run['gpu']} / pod {run['runpodPodId']}")


def terminate():
    pid = pod_id()
    rest("DELETE", f"/pods/{pid}")
    STATE.unlink()
    print(f"Pod {pid} terminated.")


if __name__ == "__main__":
    cmds = {"launch": launch, "status": status, "fetch": fetch, "terminate": terminate}
    if len(sys.argv) != 2 or sys.argv[1] not in cmds:
        sys.exit(__doc__)
    cmds[sys.argv[1]]()
