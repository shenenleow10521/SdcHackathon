# CV-reading benchmark

How well does HalaTuju read a real-world, messy CV? We test the same pipeline the app uses (`extractDraft` in `server/agents/cv.ts`) on 14 deliberately messy synthetic CVs, against an answer key written blind.

## Method

- **Test set:** 14 synthetic Malaysian CVs (`eval/cv/cases/`): broken PDF extraction (two-column interleave, hyphenation, page headers), OCR typos, Bahasa Melayu and Manglish, unexplained jargon (3WM, MIRO/F110, SST-02), keyword-stuffed skill lists, very short and very long CVs, and 2 people from outside our catalogue (a nurse, a mechanic) to test false positives. 146 personal details are planted (names, MyKad numbers, phones, addresses, age, gender, race, religion, marital status) to test scrubbing.
- **Answer key:** written by an independent annotator agent that never saw the system's code or outputs (`eval/cv/labels.json`, guidelines in `eval/cv/ANNOTATION.md`). Every expected skill has an exact quote from the CV. Skills only *listed* (not shown in use) are "acceptable": not required and not penalised. The key's sha256 is stored in every result file: `f44919490bd4a1da95bafc2776070b9255ef9eedb705e79aa475d59c515b8ccb`.
- **Scoring** (`scripts/eval-cv.ts`): a required skill not found = missed; any output that is neither required nor acceptable = false positive. Job title mapped to the right catalogue occupation (or an acceptable alternative). Level counted as correct when inside the annotator's range. 95% intervals are Wilson intervals.
- **Baseline:** the same pipeline with no AI at all (keyword and alias matching), to show what the AI adds.

## Results (first blind run, 23 Oct 2026)

| | No AI (keywords) | **HalaTuju** (gemini-3.5-flash-lite + bge-m3 on RunPod) |
|---|---|---|
| Skills found (recall) | 78% (47/60) | **90%** (54/60) · 95% CI 80–95% |
| Skills correct (precision) | 63% | **88.5%** (54/61) · 95% CI 78–94% |
| F1 | 69 | **89** |
| Current job mapped correctly | 71% (10/14) | **79%** (11/14) |
| Skill level inside the annotator's range | 45% | **94%** (100% within ±1) |
| Out-of-catalogue CVs (nurse, mechanic): wrong skills | 3 | **1** |
| Time per CV (median) | instant | 6 s |

**Where it fails**
- **Job mapping:** all 3 misses are people already *in* a destination job (internal auditor, treasury executive, supply-chain planner) mapped to "other". The prompt tells the model to treat destination jobs as future roles, and it over-applies that.
- **Keyword stuffing:** when a skill is only listed in a skills section, the system includes it at a level above the annotator's cap in 16 of 21 cases. It takes skills lists at face value.
- **Missed skills:** ERP use mentioned only through SAP transaction codes (2×), statistics (2×), one audit-trail duty in a 4-page CV, one financial-analysis duty.
- **False positives:** "order spare parts" read as strategic sourcing (mechanic), a temple-committee treasurer role read as treasury, expediting suppliers read as sourcing.

## Privacy

Planted personal details that reached the AI model: **0 of 146** in the final run. ⚠️ This number is **not blind**: the first scrubber run let 17 of 146 through (all-caps names inside a "CURRICULUM VITAE - NAME" heading, A/L and ANAK names, attribute lines like "Female · Indian · Hindu · Single", religious activities such as church choir or surau committee, "Status: Berkahwin"). We fixed those gaps using this test set and added regression tests (`tests/pii.test.ts`). A fresh, unseen set is needed to measure the scrubber honestly.

## Caveats

- 14 CVs is small: treat the numbers as ± the intervals shown, not as exact.
- The CVs and the answer key are synthetic and written by an AI annotator (no real personal data is allowed in this hackathon). Real CVs may be messier.
- The skill and job results above are from the first run on this set. If we tune the prompts to fix the failures listed, the next honest measurement must use a new, unseen set.

## Re-run

```bash
npx tsx scripts/eval-cv.ts              # full system (needs Gemini keys; embeddings from .env)
npx tsx scripts/eval-cv.ts --mode basic # no-AI baseline
```
Results are written to `eval/results/` (one timestamped file per run, plus `*-latest.json`).
