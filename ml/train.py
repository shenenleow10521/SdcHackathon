"""Step 3: train a ridge regression from task embeddings to human exposure scores.

The split is BY OCCUPATION: no occupation's tasks are in both train and test, so the
model can't score well by memorising jobs. The ridge penalty (alpha) is chosen by
5-fold cross-validation inside the training set, again grouped by occupation.
Output: ml/artifacts/exposure_model.json (weights + bias), small enough to commit
and to load in the Node app, which scores a task with one dot product.
"""
import argparse

import numpy as np
import pandas as pd
from sklearn.linear_model import RidgeCV
from sklearn.model_selection import GroupKFold, GroupShuffleSplit

from common import ART_DIR, DATA_DIR, EMB_MODEL, SEED, run_info, sample_suffix, write_json

ALPHAS = [0.1, 0.3, 1, 3, 10, 30, 100]


def load(sample: int | None):
    suffix = sample_suffix(sample)
    X = np.load(DATA_DIR / f"embeddings{suffix}.npy")
    df = pd.read_csv(DATA_DIR / f"embedded{suffix}.csv", dtype={"task_id": str, "soc": str})
    assert len(df) == len(X), "embeddings and task list are out of sync: re-run embed.py"
    return X, df


def split(df: pd.DataFrame):
    gss = GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=SEED)
    train_idx, test_idx = next(gss.split(df, groups=df["soc"]))
    assert not set(df["soc"].iloc[train_idx]) & set(df["soc"].iloc[test_idx])
    return train_idx, test_idx


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, nargs="?", const=300, default=None,
                    help="use the embeddings from embed.py --sample N (default N=300)")
    args = ap.parse_args()

    X, df = load(args.sample)
    y = df["label"].to_numpy(dtype=np.float64)
    train_idx, test_idx = split(df)
    groups = df["soc"].iloc[train_idx].to_numpy()
    folds = list(GroupKFold(n_splits=5).split(X[train_idx], y[train_idx], groups))

    model = RidgeCV(alphas=ALPHAS, cv=folds, scoring="neg_mean_absolute_error")
    model.fit(X[train_idx], y[train_idx])

    suffix = sample_suffix(args.sample)
    write_json(ART_DIR / f"split{suffix}.json", {
        "seed": SEED, "testOccupations": sorted(df["soc"].iloc[test_idx].unique().tolist()),
        "trainTasks": int(len(train_idx)), "testTasks": int(len(test_idx)),
    })
    write_json(ART_DIR / f"exposure_model{suffix}.json", {
        "name": "HalaTuju task AI-exposure model",
        "kind": "ridge-regression-on-embeddings",
        "embeddingModel": EMB_MODEL,
        "dims": int(X.shape[1]),
        "normalizeInput": True,
        "target": "Human-rated task exposure, beta = E1 + 0.5*E2 (Eloundou et al., 'GPTs are GPTs', Science 2024; MIT licence)",
        "clip": [0.0, 1.0],
        "alpha": float(model.alpha_),
        "bias": float(model.intercept_),
        "weights": [round(float(w), 6) for w in model.coef_],
        "trainedOn": {"tasks": int(len(train_idx)), "occupations": int(len(set(groups))), "sample": args.sample},
        "run": run_info(),
        "usage": "score = clip(bias + dot(weights, l2normalise(bge_m3(task_text))), 0, 1)",
    })
    print(f"Trained on {len(train_idx)} tasks / {len(set(groups))} occupations; alpha={model.alpha_}; "
          f"held out {len(test_idx)} tasks / {df['soc'].iloc[test_idx].nunique()} occupations")


if __name__ == "__main__":
    main()
