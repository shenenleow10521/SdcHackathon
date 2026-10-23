"""Step 4: evaluate honestly on the held-out occupations.

Reports Pearson r, Spearman rho and mean absolute error for:
  - our model
  - baseline: always predict the training average
  - baseline: copy the label of the most similar training task (nearest neighbour)
  - reference: GPT-4's labels from the same paper (how well another annotator agrees with humans)
both per task and per occupation (average over its tasks, which is how the app uses it).
Also scores HalaTuju's own catalogue tasks and checks they rank sensibly against the
sample "AI does / AI assists / needs a person" tags.
"""
import argparse
import json

import numpy as np
import pandas as pd
from scipy.stats import pearsonr, spearmanr

from common import ART_DIR, EMB_MODEL, ML_DIR, run_info, sample_suffix, write_json
from train import load, split


def metrics(y, p) -> dict:
    y, p = np.asarray(y, float), np.asarray(p, float)
    varies = np.ptp(p) > 1e-9  # a constant prediction (the mean baseline) has no correlation
    return {"pearson": round(float(pearsonr(y, p)[0]), 3) if varies else None,
            "spearman": round(float(spearmanr(y, p)[0]), 3) if varies else None,
            "mae": round(float(np.mean(np.abs(y - p))), 3), "n": int(len(y))}


def predict(model: dict, X: np.ndarray) -> np.ndarray:
    return np.clip(X @ np.asarray(model["weights"]) + model["bias"], *model["clip"])


def score_catalogue(model: dict) -> dict:
    """Score the seed catalogue's task statements (db/seed/knowledge.json)."""
    import torch
    from sentence_transformers import SentenceTransformer

    k = json.loads((ML_DIR.parent / "db" / "seed" / "knowledge.json").read_text(encoding="utf-8"))
    rows = [(s["id"], s["label"], t["text"], t["mode"]) for s in k["skills"] for t in s["tasks"]]
    st = SentenceTransformer(EMB_MODEL, device="cuda" if torch.cuda.is_available() else "cpu")
    X = st.encode([r[2] for r in rows], normalize_embeddings=True, convert_to_numpy=True)
    pred = predict(model, X)
    tasks = [{"skill": r[0], "task": r[2], "sampleMode": r[3], "predicted": round(float(p), 3)} for r, p in zip(rows, pred)]
    by_mode = {m: round(float(np.mean([t["predicted"] for t in tasks if t["sampleMode"] == m])), 3) for m in ("ai", "assist", "human")}
    by_skill = {}
    for t in tasks:
        by_skill.setdefault(t["skill"], []).append(t["predicted"])
    return {"tasks": tasks, "meanByMode": by_mode, "bySkill": {s: round(float(np.mean(v)), 3) for s, v in by_skill.items()}}


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, nargs="?", const=300, default=None)
    ap.add_argument("--skip-catalogue", action="store_true")
    args = ap.parse_args()
    suffix = sample_suffix(args.sample)

    model = json.loads((ART_DIR / f"exposure_model{suffix}.json").read_text(encoding="utf-8"))
    X, df = load(args.sample)
    tr, te = split(df)
    y = df["label"].to_numpy(float)

    pred = predict(model, X[te])
    mean_pred = np.full(len(te), y[tr].mean())
    nn_pred = y[tr][np.argmax(X[te] @ X[tr].T, axis=1)]  # embeddings are normalised: dot = cosine
    test = df.iloc[te].assign(model=pred, mean=mean_pred, nn=nn_pred)
    has_gpt4 = test["gpt4_label"].notna()

    per_task = {"model": metrics(test["label"], test["model"]), "baselineMean": metrics(test["label"], test["mean"]),
                "baselineNearestNeighbour": metrics(test["label"], test["nn"]),
                "referenceGpt4Labels": metrics(test.loc[has_gpt4, "label"], test.loc[has_gpt4, "gpt4_label"])}
    occ = test.groupby("soc")[["label", "model", "mean", "nn", "gpt4_label"]].mean()
    per_occ = {"model": metrics(occ["label"], occ["model"]), "baselineMean": metrics(occ["label"], occ["mean"]),
               "baselineNearestNeighbour": metrics(occ["label"], occ["nn"]),
               "referenceGpt4Labels": metrics(occ["label"], occ["gpt4_label"])}

    out = {"split": "by occupation (held-out occupations never seen in training)", "perTask": per_task,
           "perOccupation": per_occ, "run": run_info(), "modelRun": model["run"], "sample": args.sample}
    if not args.skip_catalogue:
        out["catalogue"] = score_catalogue(model)
    write_json(ART_DIR / f"eval{suffix}.json", out)

    print(f"{'':28}{'pearson':>8}{'spearman':>9}{'MAE':>7}{'n':>7}")
    for level, block in (("per task", per_task), ("per occupation", per_occ)):
        print(level)
        for name, m in block.items():
            print(f"  {name:26}{str(m['pearson']):>8}{str(m['spearman']):>9}{m['mae']:>7}{m['n']:>7}")
    if "catalogue" in out:
        print("HalaTuju catalogue, mean predicted exposure by sample tag:", out["catalogue"]["meanByMode"])


if __name__ == "__main__":
    main()
