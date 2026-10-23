# Data sources for the AI-exposure model

| Data | Use | Licence | Where |
|---|---|---|---|
| **"GPTs are GPTs" task labels** — Eloundou, T., Manning, S., Mishkin, P. & Rock, D. (2024). *GPTs are GPTs: Labor market impact potential of LLMs.* Science 384(6702). | Training labels: human-rated exposure (E0/E1/E2) for 19,265 O\*NET task statements; target β = E1 + 0.5·E2. GPT-4's labels from the same file are used only as a comparison. | MIT (repository licence) | `openai/GPTs-are-GPTs`, file `data/full_labelset.tsv`, pinned commit `36af7ac78d218158fd2070bd8775c86a99f222da`, sha256 `094378905e1f3349e50a9a83dc69643a2ef227954d611c8316a46da08cb3d8de` |
| **O\*NET task statements** (inside the file above) | The task text that is embedded | CC BY 4.0, O\*NET Database, U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). We have modified this information; USDOL/ETA has not approved, endorsed or tested these modifications. | as above |
| **BAAI/bge-m3** | Task embeddings (1,024 dims, multilingual incl. Malay) | MIT | huggingface.co/BAAI/bge-m3 |

Not used for training: ILO Working Paper 140 publishes occupation-level indices; we use it only in the app's "Studies disagree" view.

**What the model measures:** how much a large language model could speed up a task (the paper's *exposure*), not whether AI replaces the person doing it. Exposure is high for writing and explaining tasks even when a person stays in charge.
