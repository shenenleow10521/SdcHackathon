"""Shared paths and helpers for the AI-exposure model pipeline."""
import json
import os
import platform
import time
from pathlib import Path

ML_DIR = Path(__file__).resolve().parent
DATA_DIR = ML_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
ART_DIR = ML_DIR / "artifacts"
for d in (RAW_DIR, ART_DIR):
    d.mkdir(parents=True, exist_ok=True)

TRAIN_CSV = DATA_DIR / "train.csv"
EMB_MODEL = "BAAI/bge-m3"
SEED = 42


def sample_suffix(sample: int | None) -> str:
    return f"_sample{sample}" if sample else ""


def run_info() -> dict:
    """Where and how this run happened. RunPod pods set RUNPOD_POD_ID, which marks a final run."""
    import torch

    cuda = torch.cuda.is_available()
    pod = os.environ.get("RUNPOD_POD_ID")
    return {
        "where": "runpod" if pod else "local",
        "runpodPodId": pod,
        "gpu": torch.cuda.get_device_name(0) if cuda else None,
        "device": "cuda" if cuda else "cpu",
        "torch": torch.__version__,
        "python": platform.python_version(),
        "host": platform.node() if not pod else "runpod",
        "time": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
    }


def write_json(path: Path, obj) -> None:
    path.write_text(json.dumps(obj, indent=2) + "\n", encoding="utf-8")
