"""Step 1: build ml/data/train.csv from published task-level AI-exposure labels.

Labels: "GPTs are GPTs" (Eloundou, Manning, Mishkin & Rock; Science, 2024), MIT licence.
About 19,000 O*NET task statements, each rated by humans:
  E0 = no exposure, E1 = an LLM alone can halve the time, E2 = an LLM plus extra software can.
We use the paper's beta measure as the target: beta = 1.0 for E1, 0.5 for E2, 0.0 for E0.
GPT-4's own label for each task is kept as a reference (not used for training).
"""
import argparse
import csv
import hashlib
import urllib.request

from common import RAW_DIR, TRAIN_CSV

# Pinned to a commit so every run (local or RunPod) trains on byte-identical data.
SOURCE_URL = "https://raw.githubusercontent.com/openai/GPTs-are-GPTs/{ref}/data/full_labelset.tsv"
BETA = {"E0": 0.0, "E1": 1.0, "E2": 0.5}
PINNED_REF = "36af7ac78d218158fd2070bd8775c86a99f222da"  # last change to the file, 2024-06-20
EXPECTED_SHA256 = "094378905e1f3349e50a9a83dc69643a2ef227954d611c8316a46da08cb3d8de"


def download(ref: str) -> "Path":
    dest = RAW_DIR / "full_labelset.tsv"
    if not dest.exists():
        url = SOURCE_URL.format(ref=ref)
        print(f"Downloading {url}")
        req = urllib.request.Request(url, headers={"User-Agent": "HalaTuju-ml/0.1"})
        with urllib.request.urlopen(req, timeout=120) as r:
            dest.write_bytes(r.read())
    return dest


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ref", default=PINNED_REF, help="git ref of openai/GPTs-are-GPTs")
    args = ap.parse_args()

    src = download(args.ref)
    sha = hashlib.sha256(src.read_bytes()).hexdigest()
    if args.ref == PINNED_REF and sha != EXPECTED_SHA256:
        raise SystemExit(f"Label file checksum mismatch ({sha}); delete {src} and re-run.")
    rows, seen, skipped = [], set(), 0
    with src.open(encoding="utf-8") as f:
        for r in csv.DictReader(f, delimiter="\t"):
            task, label = (r.get("Task") or "").strip(), r.get("human_exposure_agg")
            soc = (r.get("O*NET-SOC Code") or "").strip()
            if not task or label not in BETA or not soc:
                skipped += 1
                continue
            key = (soc, task.lower())
            if key in seen:  # same task listed twice for one occupation
                skipped += 1
                continue
            seen.add(key)
            rows.append({
                "task_id": r.get("Task ID", "").split(".")[0],
                "soc": soc,
                "occupation": r.get("Title", ""),
                "task": task,
                "label": BETA[label],
                "gpt4_label": BETA.get(r.get("gpt4_exposure", ""), ""),
            })

    with TRAIN_CSV.open("w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    socs = {r["soc"] for r in rows}
    print(f"Wrote {TRAIN_CSV} : {len(rows)} tasks, {len(socs)} occupations, skipped {skipped}. source sha256 {sha[:16]}")


if __name__ == "__main__":
    main()
