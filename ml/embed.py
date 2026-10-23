"""Step 2: embed every task statement with BAAI/bge-m3 (GPU if available, else CPU).

--sample N embeds a random sample of N occupations' tasks, for a quick local test.
Embeddings are L2-normalised, so a dot product is a cosine similarity.
"""
import argparse
import time

import numpy as np
import pandas as pd

from common import DATA_DIR, EMB_MODEL, SEED, TRAIN_CSV, run_info, sample_suffix, write_json


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sample", type=int, default=None, help="only N occupations (quick test)")
    ap.add_argument("--batch-size", type=int, default=64, help="lower this if the GPU runs out of memory")
    args = ap.parse_args()

    import torch
    from sentence_transformers import SentenceTransformer

    df = pd.read_csv(TRAIN_CSV, dtype={"task_id": str, "soc": str})
    if args.sample:
        socs = df["soc"].drop_duplicates().sample(n=min(args.sample, df["soc"].nunique()), random_state=SEED)
        df = df[df["soc"].isin(socs)].reset_index(drop=True)

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = SentenceTransformer(EMB_MODEL, device=device)
    if device == "cuda":
        model.half()  # fp16: half the memory, same quality for inference

    t0 = time.time()
    emb = model.encode(df["task"].tolist(), batch_size=args.batch_size, normalize_embeddings=True,
                       show_progress_bar=True, convert_to_numpy=True).astype(np.float32)
    secs = time.time() - t0

    suffix = sample_suffix(args.sample)
    np.save(DATA_DIR / f"embeddings{suffix}.npy", emb)
    df.to_csv(DATA_DIR / f"embedded{suffix}.csv", index=False)
    info = {**run_info(), "model": EMB_MODEL, "tasks": len(df), "occupations": int(df["soc"].nunique()),
            "dims": int(emb.shape[1]), "seconds": round(secs, 1), "tasksPerSecond": round(len(df) / max(secs, 1e-9), 1)}
    write_json(DATA_DIR / f"embed_run{suffix}.json", info)
    print(f"Embedded {len(df)} tasks ({info['occupations']} occupations) on {info['gpu'] or 'CPU'} in {secs:.1f}s -> dims {emb.shape[1]}")


if __name__ == "__main__":
    main()
