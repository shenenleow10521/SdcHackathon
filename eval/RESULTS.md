# CV-reading benchmark

> **Tested on 50 messy CVs and LinkedIn profiles, labelled by an independent annotator before we ran. On the 36 CVs we never tuned on: current job identified 97.2%; 71.7% of the ESCO skills we show are correct (blind judge); finds 71.0% of the skills the annotator listed; removes 99.4% of personal details before any AI sees the CV.**

All four numbers are on the 36 held-out CVs (c15 to c50). Each has a 95% interval below. All 50 CVs are reported as a secondary result. The privacy number is **not blind** on these 36 CVs any more: we fixed the scrubber after the first run on them (see "What changed in this round" below). Their blind score was **82.6%**.

Run: 24 Oct 2026, `scripts/eval-cv.ts` (full mode) and `scripts/esco-judge.ts`. Result files: `eval/results/cv-full-2026-10-23-19-04.json` (UTC time stamp), `eval/results/esco-judge/score.json`.

## What we test

The same pipeline the app uses (`extractDraft` in `server/agents/cv.ts`): scrub personal details, AI model #1 splits the CV into phrases, bge-m3 embeddings find candidate skills among the 13,939 ESCO skills, AI model #2 picks the skills and the current job.

- **System under test:** gemini-3.5-flash-lite (fallback gemini-3.1-flash-lite), bge-m3 on RunPod Serverless (`EMBED_PROVIDER=runpod`). The run refuses to start with any other embedder, because the stored ESCO vectors are bge-m3. No embedding call failed and no CV fell back to the no-AI path.
- **50 synthetic Malaysian CVs** (`eval/cv/cases/`), in three tiers:

| Tier | Cases | What it tests |
|---|---|---|
| messy | c01 to c14, c45 to c50 (20) | Broken PDF text (two columns interleaved, hyphenation, page headers), OCR typos, Bahasa Melayu and Manglish, jargon, keyword stuffing, very short and very long CVs, a nurse and a mechanic from outside finance |
| clean | c15 to c32 (18) | Well-formatted CVs, three in Bahasa Melayu, HR and civil engineering included |
| linkedin | c33 to c44 (12) | LinkedIn "Save to PDF" text: sidebar first, Top Skills without evidence, buzzword headlines, short role descriptions |

- **Answer keys** were written by an independent annotator agent that never saw the system's code, prompts or outputs (`eval/cv/ANNOTATION.md`, `eval/cv/ANNOTATION-v2.md`). The ESCO key has **358 facts**: one fact is one skill the CV shows the person *using*. Each fact lists every ESCO skill a careful reviewer would accept (2 to 4 near-equivalents on average). Skills only listed in a skills section are not facts. 301 personal details are planted (names, MyKad numbers, phones, addresses, age, gender, race, religion, marital status, community groups). sha256 of the keys, also stored in every result file:
  - `labels.json` `f44919490bd4a1da95bafc2776070b9255ef9eedb705e79aa475d59c515b8ccb`
  - `labels-v2.json` `8a563ba8ac172faded7883d004ee906f2e5a435bb4ec8116095154ff4c22519b`
  - `esco-labels.json` `9782603d193d47368852c381888d50b156005dc0b7c3f15a78e0a3004252fb49`

### Tuning set and held-out set

- **Tuning set, c01 to c14 (14 CVs):** we ran these first (23 Oct) and then changed the prompts and the scrubber to fix what failed. Fixes in this round were also checked on these 14 first.
- **Held-out set, c15 to c50 (36 CVs):** first run on 23 Oct after that tuning. We never read their skill or ESCO answer keys to change the system. We did read their CV text and their first-run failures for two things: the personal details that leaked (the privacy fixes below), and the annotator's notes on "acceptable" skills, to find out why the keyword-stuffing count looked so bad (it changed the metric's label, not the system). So the held-out privacy number is no longer blind; the job, ESCO precision and ESCO recall numbers are.

## How each number is scored

- **Current job identified:** the job the AI picks (from our 16 jobs plus "other") equals the annotator's answer or one of the alternatives they accept.
- **ESCO skills shown that are correct (precision):** judged blind by a separate AI model (`scripts/esco-judge.ts`). For each CV the judge gets the CV and a shuffled list of ESCO skills: our suggestions mixed with decoys (half look-alikes that share a word with a suggestion, half random ESCO skills), with no sign of which is which. It answers, per item, *used* (the CV shows the person doing it), *listed* (only named or claimed) or *no*. A suggestion counts as correct if the judge says *used*, or says *listed* and the app also shows it as "listed in your CV". The judge was six Claude agents (claude-opus-5-5), one per sixth of the cases, each allowed to open only its own item list and the CV files. We first ran a Gemini judge (gemini-3.5-flash), but the free keys ran out of daily quota after a few CVs, so those verdicts were thrown away and every item was judged by the Claude agents. The judge is a different model family from the Gemini reader. The verdicts and reasons are in `eval/results/esco-judge/output.json`. The decoys check the judge: it rejected 98.5% (582/591) of random decoys and 92.8% (528/569) of look-alikes.
- **Skills found (ESCO recall):** a fact counts as found if we suggested one of the ESCO skills the annotator accepts for it (**strict**, the headline). We also report a **lenient** rule, fixed before this run and before looking at its output: a fact also counts if a suggestion that matched no fact strictly is a close ESCO neighbour of one of the fact's accepted skills (bge-m3 cosine at least 0.80 between the two ESCO skills), with each suggestion counting for at most one fact. 0.80 is the app's existing "related skill" threshold; on the tuning-set key, 16% of pairs the annotator put under the same fact reach it, and 1.3% of pairs from different facts do.
- **Personal details removed:** a planted detail counts as removed if it appears in none of the text sent to the AI model (digits-only match for numbers).
- 95% intervals are Wilson score intervals.

## Results

### Held-out CVs (36), the main result

| | All 36 | clean (18) | linkedin (12) | messy (6) |
|---|---|---|---|---|
| Current job identified | **97.2%** (35/36) · 85.8 to 99.5 | 100% (18/18) · 82.4 to 100 | 91.7% (11/12) · 64.6 to 98.5 | 100% (6/6) · 61.0 to 100 |
| ESCO skills shown that are correct | ****71.7%** (511/713) · 68.3 to 74.9** | 72.2% (317/439) · 67.8 to 76.2 | 65.3% (94/144) · 57.2 to 72.6 | 76.9% (100/130) · 69.0 to 83.3 |
| Skills found, strict | **71.0%** (169/238) · 64.9 to 76.4 | 70.8% (109/154) · 63.2 to 77.4 | 74.5% (35/47) · 60.5 to 84.7 | 67.6% (25/37) · 51.5 to 80.4 |
| Skills found, lenient | 79.4% (189/238) · 73.8 to 84.1 | 81.2% (125/154) · 74.3 to 86.6 | 78.7% (37/47) · 65.1 to 88.0 | 73.0% (27/37) · 57.0 to 84.6 |
| Personal details removed (not blind) | **99.4%** (154/155) · 96.4 to 99.9 | 100% (82/82) · 95.5 to 100 | 100% (29/29) · 88.3 to 100 | 97.7% (43/44) · 88.2 to 99.6 |
| Personal details removed, blind first run | 82.6% (128/155) · 75.8 to 87.7 | 97.6% (80/82) · 91.5 to 99.3 | 55.2% (16/29) · 37.5 to 71.6 | 72.7% (32/44) · 58.2 to 83.7 |

### All 50 CVs and the tuning set

| | All 50 | Tuning set (14, all messy) |
|---|---|---|
| Current job identified | 98.0% (49/50) · 89.5 to 99.6 | 100% (14/14) · 78.5 to 100 |
| ESCO skills shown that are correct | 69.9% (805/1151) · 67.2 to 72.5 | 67.1% (294/438) · 62.6 to 71.4 |
| Skills found, strict | 73.2% (262/358) · 68.4 to 77.5 | 77.5% (93/120) · 69.2 to 84.1 |
| Skills found, lenient | 80.2% (287/358) · 75.7 to 84.0 | 81.7% (98/120) · 73.8 to 87.6 |
| Personal details removed | 99.7% (300/301) · 98.1 to 99.9 | 100% (146/146) · 97.4 to 100 |

The tuning set scores a little higher on skills found than the held-out set (77.5% against 71.0%), as you would expect from CVs we have tuned on. The gap is inside the intervals.

## What changed in this round, and what it did

| Fix | Before (23 Oct, same 50 CVs) | After (24 Oct) |
|---|---|---|
| **Privacy:** LinkedIn names (found from the profile link or the line above the headline), names beside "CV"/"RESUME" headings, OCR'd and oddly grouped phones (`013-5552 819O`, `011-555 30 71`), stacked Malay honorifics (`En.`, `Tn. Hj.`, `b.`), slash-separated attribute lines, community groups that reveal ethnicity or neighbourhood (`Hokkien Youth Association`, `Persatuan Penduduk Taman ...`, a school PTA), a bare "Taman, town, state" line, portfolio websites | 128/155 held-out details removed (82.6%); LinkedIn tier 55.2% | 154/155 (99.4%); LinkedIn 29/29 |
| **ESCO recall:** up to 3 ESCO skills per phrase (was 2), and skills-list items are now read too (marked "listed") | strict 59.2% held-out (141/238), 58.4% all; lenient 68.1% held-out | strict 71.0% held-out, 73.2% all; lenient 79.4% held-out |
| | 620 ESCO suggestions in all (399 held-out, 11 per CV) | 1,151 (713 held-out, 20 per CV); 820 shown as used, 331 as listed |
| **Keyword stuffing:** skills-section items are now extracted, and a quote from a skills list, summary or headline is treated as "only listed" even if the AI says otherwise | only 7 listed-only skills ever reached the cap logic (6 above level 2) | 60 listed-only skills included; 53 at level 2 or below and "not sure" |
| **Long CVs:** skill picks are sent in chunks of 20 phrases | (not needed before) | without it, 2 tuning CVs failed with HTTP 400 and fell back to keyword matching |

After the run, the scrubber was also made tolerant of OCR output from scanned CVs ("Female - Indian - Married", an email or LinkedIn link with a dot read as a space, a MyKad number with a stray space). A scrub-only check on the 50 CVs gives the same result (1 of 301 details left), and the scanned test CV (`tests/fixtures/cv/priya-scan.png`, read with the app's OCR) leaks nothing.

A bug fixed on the way: the address rule removed "Designed drainage for a 6 km rural road using AutoCAD" (a number and "road"), losing a real skill. Numbers followed by a unit no longer count as house numbers.

Precision before the fixes is unknown: the blind judge had never been run.

## Confidence cut-off (24 Oct): tried, not shipped

We tried to raise precision by showing only the more confident ESCO picks, offline, with no new reader or judge calls (`scripts/esco-cutoff.ts`). It uses the saved suggestions, the blind verdicts above and the same precision and recall rules. The run had not saved the retrieval score (its query was the phrase plus an AI "skill hint" that was not saved), so we computed the bge-m3 cosine between the phrase alone and each suggested skill on RunPod (deterministic; `eval/results/esco-suggestions-cosine.json`).

- **Rules tried (29):** keep the AI's first 1 or 2 picks per phrase; drop skills marked "listed"; mixes of these; cosine of at least t (t = 0.40 to 0.60, step 0.02); cosine of at least t or the phrase's first pick.
- **How the rule was chosen, fixed before any held-out number was printed:** on the tuning set (c01-c14) only, the highest precision whose lenient recall is at most 5 points below the current system's.
- **Chosen on the tuning set:** cosine at least 0.48, or the phrase's first pick. Tuning precision 67.1% to 69.2%, lenient recall 81.7% to 76.7%.

| | Precision (blind judge) | Recall, strict | Recall, lenient |
|---|---|---|---|
| Held-out, current | **71.7%** (511/713) · 68.3 to 74.9 | 71.0% (169/238) · 64.9 to 76.4 | 79.4% (189/238) · 73.8 to 84.1 |
| Held-out, with cut-off | 71.0% (453/638) · 67.4 to 74.4 | 69.3% (165/238) · 63.2 to 74.8 | 78.6% (187/238) · 72.9 to 83.3 |
| All 50, current | 69.9% (805/1151) · 67.2 to 72.5 | 73.2% (262/358) · 68.4 to 77.5 | 80.2% (287/358) · 75.7 to 84.0 |
| All 50, with cut-off | 70.3% (711/1011) · 67.4 to 73.1 | 70.1% (251/358) · 65.2 to 74.6 | 77.9% (279/358) · 73.4 to 81.9 |

The tuning gain did not carry over to the held-out set. Precision stayed the same and recall fell, so the app is unchanged. No rule moved held-out precision by more than about 1 point, which is inside the noise (`npx tsx scripts/esco-cutoff.ts --all-rules`, read after the choice and not used to pick). The judge's rejections are mostly a word match with the wrong meaning (see "Where it fails"), and those score almost as high a cosine as correct picks: mean 0.521 for rejected picks and 0.534 for correct ones, with 64% of rejected and 69% of correct picks at 0.50 or above, over all 50 CVs. A cut-off on confidence cannot remove them. The next fix to try is a better pick prompt or ESCO descriptions in the pick list.

**Published numbers for context (not comparable).** Work on ESCO skill linking scores job-ad sentences, not CVs. It ranks all ~14k ESCO skills per sentence and reports ranking metrics such as RP@5: R-precision over the top 5 ranked skills, normalised by the number of gold skills. Our metric is the precision of a short shown set, judged by an AI with near-equivalents accepted.
- Decorte et al. 2023, "Extreme Multi-Label Skill Extraction Training using Large Language Models" (https://arxiv.org/abs/2307.10778, read via https://ar5iv.labs.arxiv.org/html/2307.10778): best RP@5 54.6 (TECH), 45.7 (HOUSE), 54.6 (TECHWOLF), on job-ad sentences annotated with ESCO skills.
- "ConTeXT-match" 2025 (https://arxiv.org/html/2505.24640v1), Table II, test sets: ConTeXT-match RP@5 64.0 (TECH), 51.1 (HOUSE), 57.7 (TECHWOLF). It also lists GPT-4 re-ranking (Clavié et al.) at RP@5 61.5 (TECH) and 53.3 (HOUSE). On its new Skill-XL set (111 job ads, 8,471 ESCO labels) it reports F1 of about 0.40.

So published systems put a correct ESCO skill in the top 5 for about half to two thirds of sentences. That is a different measure from ours, on job ads rather than CVs, so it neither confirms nor contradicts our 71.7%.

## Where it fails

**Skills shown (713 on the held-out CVs):** 351 shown as used and judged used; 89 shown as "listed" that the judge says the CV does show in use (we under-claimed, counted correct); 71 shown as listed and judged listed. Wrong: **165 shown as used that the judge rejects**, 34 shown as listed that the judge rejects, and 3 shown as used that are only listed.

**Skills the annotator listed (238 held-out facts):** 169 found exactly, 20 more found as a close ESCO neighbour (lenient), **49 missed**.

The most common rejected suggestion is *generate reconciliation reports* (9 times on held-out CVs, 13 in all): the reader attaches it to almost any reconciliation or checking duty.

Concrete examples:

1. **No ESCO word for the work (c30, RPA analyst, 4 of 11 facts missed).** "Build and maintain 18 UiPath bots for finance" was mapped to *generate reconciliation reports*, the bot's task, not to building automation. ESCO has no robotic-process-automation skill; the annotator's accepted labels (*automation technology*, *develop data processing applications*) were not in the 10 nearest ESCO skills for that phrase.
2. **Privacy fix costs a skill (c49, bank teller).** "Bendahari, Persatuan Belia Kampung Sireh ... keep cash book" now goes, because a village youth association reveals where she lives. The annotator's fact "keeps youth association cash book" can no longer be found. We chose privacy.
3. **A personal detail still leaks (c50, two-column CV).** "Treasurer, Bukit Mertajam" shares a line with an experience bullet in the PDF text, so the line is kept. The next line, "Chinese Chamber Youth", is now removed.
4. **Wrong job (c44, fresh graduate, LinkedIn).** The internship has ended, so the answer is "other"; the model picked the treasury job from a treasury internship.
5. **Matched on a word, not a meaning (judge rejections).** "Prepare weekly F110 payment proposal" became *process payments*, which in ESCO means taking payments from customers at a till (c01, c05 and 5 more). "Key in invoices into SAP" became *SAP R3*, which ESCO describes as SAP programming (7 times). "Handle vendor queries" became *handle customer complaints*.

Also seen, not planted by the annotator, so not counted: in c13 the line "manage donations, payment vouchers and the annual Wesak budget" survives after its first line ("Buddhist Fellowship") is removed, so a religious festival reaches the AI.

## Keyword stuffing

A skill that is only listed is capped at level 2 and marked "not sure", so the interviewer asks about it. The earlier report that "41 of 57 listed-only skills were rated above the cap" was a mislabelled metric: those 57 were all of the annotator's "acceptable" skills, mostly near-neighbour skills shown in real duties (for example bank reconciliation next to vendor reconciliation), with the annotator's own level cap. The cap for listed skills never fired on them because they were not listed-only, and the reader skipped skills sections, so only 7 truly listed-only skills were ever included.

This run, using the annotator's own notes to find the listed-only ones: **60 included, 53 at level 2 or below** (51 of them also marked "not sure"). The other 7 (c04 SAP, c13 internal control and treasury, c18 SAP, c22 and c34 dashboards, c33 Python) each come with a quote from a real duty, which the annotator's note also mentions in 5 of them ("pulls samples from SAP"); the levels are a judgement call, not a cap failure. One of them is a real error: c13 "treasury" at level 3 from a religious-society treasurer line. Across all 119 "acceptable" skills, 65 are above the annotator's cap, often level 2 where the annotator allows 1.

## Appendix: our 29 core catalogue skills

The app also maps each CV to its own 29 hand-built skills, used for the career routes. Same answer key rules as before (`labels.json`, `labels-v2.json`).

| | Before (23 Oct, 50 CVs) | After, all 50 | After, held-out 36 |
|---|---|---|---|
| Skills found (recall) | 89.3% (133/149) | 94.0% (140/149) · 88.9 to 96.8 | 94.4% (84/89) |
| Skills correct (precision) | 81.1% (133/164) | 73.3% (140/191) · 66.6 to 79.1 | 69.4% (84/121) |
| Level inside the annotator's range | 85.7% | 82.1% (115/140) | 77.4% (65/84) |

Precision fell. Reading skills sections finds more real skills but also adds wrong ones: "SQL Accounting" or "SQL Payroll" (accounting packages) read as the SQL language in 5 CVs (c09, c15, c31, c44, c50), one of the annotator's planted traps; and more audit skills (controls testing is now the most common false positive, 8 times, and supporting auditors 6 times).

## Time and cost

- Reading 50 CVs: 628 s in all, median **12.9 s per CV**. 106 calls to gemini-3.5-flash-lite (2 per CV, more for long CVs), about 677,000 characters of CV and candidate lists sent. 101 RunPod embedding requests (1,441 texts, 233 s of request time; the endpoint was already warm).
- Judge: 6 Claude agents in parallel, 2,311 items, about 3 minutes wall time.
- Cost: the Gemini keys are free-tier keys, so no Gemini charge (the free daily quota is the real limit: it stopped the Gemini judge). RunPod bills per second of worker time at a small fraction of a US cent per second; we did not read the bill for this run, but 233 s of requests is cents, not dollars.

## Limitations

- **Small.** 36 held-out CVs; a tier has 6 to 18 CVs. Read the intervals, not the point values. The messy tier has only 6 held-out CVs.
- **Synthetic.** All CVs and answer keys are written by AI agents (no real personal data is allowed in this hackathon). Real CVs will be messier, and an AI annotator may share blind spots with the AI reader.
- **The judge is an AI model,** checked with decoys but not against people, and from the same model family as the agent that built this benchmark (it saw no code, prompts or sources). It also decides "used" against "listed", which people would sometimes disagree on.
- **Privacy is not blind** on the held-out set any more. A fresh unseen set is needed to measure the scrubber honestly again.
- **Run-to-run variation.** The reader uses temperature 0, but the models are not fully deterministic. c01 found 5, 1 and 4 of its 11 facts in three runs this round (the code also changed slightly between the first two).
- **ESCO gaps.** ESCO has no concepts for accounts payable, three-way matching, GHG accounting, RPA or prompting, so some real skills can only be matched loosely.

## Re-run

```bash
EMBED_PROVIDER=runpod npx tsx scripts/eval-cv.ts                # full system, all 50 CVs (needs Gemini keys and the RunPod endpoint)
EMBED_PROVIDER=runpod npx tsx scripts/eval-cv.ts --split tuning # only c01-c14, for checking a fix
npx tsx scripts/eval-cv.ts --mode basic                         # no-AI baseline
npx tsx scripts/esco-judge.ts prep  <dir outside the repo>      # mix suggestions with decoys; the key stays outside the repo
npx tsx scripts/esco-judge.ts judge <dir>                       # blind Gemini judge (resumable); or write output.json from any blind judge, as this run did
npx tsx scripts/esco-judge.ts score <dir>                       # precision; publishes the key next to the verdicts
```

Results go to `eval/results/` (one time-stamped file per run plus `*-latest.json`) and `eval/results/esco-judge/` (`input.json`, `output.json`, `key.json`, `score.json`, `items.json`).
