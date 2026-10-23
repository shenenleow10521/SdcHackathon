# HalaTuju: Pitch Story

> **For:** whoever records the video and answers judges' questions.
> **Length:** 6:00 target. Hard limit 7:00: every 30 s over costs a point.
> **Numbers:** every number below was measured in the app, its data or a result file in this repo on 23–24 Oct 2026 (sources in the last column of the script). Anything in _[brackets]_ is read off the live app on recording day. Never say a number you can't point to.

---

## The one-liner

> **When AI closes a road, HalaTuju reroutes your career, and a person signs off on every change.**

Short form for the close: **"Your career, rerouted the moment AI changes the road."**

## The story in one breath

**Priya** has processed invoices in Penang for eleven years. Her company is handing that work to AI agents, and she has **six months** to move into a new role. HalaTuju reads her CV in **15 seconds**, maps her against **3,039 jobs**, gives her a route that fits **six hours a week**, tests it in **1,000 futures**, and **reroutes her the moment a person approves new evidence about AI**.

## Three moments judges must remember

1. **The reroute:** dated evidence, a person clicks Approve, her route bends around a closed road.
2. **Our own model:** trained on RunPod, r 0.919 on 185 jobs it never saw.
3. **1,000 futures:** "Your plan works in 100% of 1,000 possible futures."

If time runs short, cut detail. Never cut these three.

---

## Full script (about 6 minutes)

| Time | On screen | Voiceover | Source |
|---|---|---|---|
| **0:00–0:20**<br>**Cold open: the reroute** | Priya's map at 2030. A Microsoft source card, 22 Oct 2026. Cursor clicks **Approve**. Camera dives to *Vendor reconciliation*, it closes, the orange route bends through audit and sustainability disclosure. | "22 October: Microsoft ships an agent that reconciles accounts on its own. One click from a person, and Priya's route to her next job bends around it in a tenth of a second. This is HalaTuju." | `docs/DEMO.md` (0.1 s, v1 → v2) |
| **0:20–0:45**<br>**Priya** | _[Prop needed: a mock company email as a slide or image]_ Email: *"From next year, AI agents will run invoice matching. Staff who move into new roles within six months will be redeployed."* | "Priya. Eleven years in accounts payable in Penang. Six months to move, six hours a week to learn. Three questions: which of my skills still count, where can I realistically go, and will the plan still hold next month?" | Persona (sample) |
| **0:45–1:15**<br>**The CV** | Drop `priya-cv.pdf`. Stage text: *Removing personal details → Matching your skills to ESCO*. Summary appears. | "She uploads her CV. Before any AI reads it, her phone, IC number, address and seven kinds of personal detail are gone. Fifteen seconds later: 11 skills, each with the line that proves it, matched against 13,939 skills in the EU's official ESCO list. On 36 test CVs we never tuned on, it named the current job 97% of the time and removed 99.4% of personal details before any AI saw them." | Demo dry run (13.9 s, 11 skills, 7 kinds); `eval/RESULTS.md` (97.2%, 99.4%) |
| **1:15–1:50**<br>**The map** | Constellation builds. Year slider plays 2026 → 2030. Skills turn into closed roads. Header: *Skills safe from AI: 64% → 45%*. | "Her map. Her skills on the inner ring, jobs on the outer ring. Today 64% of her skills are safe from AI. Watch the years: invoice entry closes in 2027, three-way matching in 2028, payment runs in 2030. By 2030, 45%." | Demo dry run |
| **1:50–2:35**<br>**Her route** | Sustainability sector → **ESG & Carbon Reporting Analyst, 57%** → Set as my goal. Route rows: *Fastest 6 wk · Balanced 7 · Safest 10*. Next up: the GHG Protocol's free training webinar (click it: the real page opens). Then **Find openings → MyFutureJobs**: live ESG vacancies in Malaysia. | "She wants work that matters. ESG and carbon reporting fits her at 57%: eleven years of tracing every number back to a source document carry straight into carbon accounting. Three routes: 6, 7 or 10 weeks. The fastest gets her job-ready in 11 weeks at six hours a week, 15 weeks before her deadline. Her first step is free: the training webinar from the GHG Protocol, the people who wrote the carbon accounting standard. And the jobs are real: one click shows live ESG openings in Malaysia on MyFutureJobs, the government's job portal." | Demo dry run; courses from `db/seed/courses.json` (provider listings with links); MyFutureJobs live search |
| **2:35–3:05**<br>**⭐ 1,000 futures** | Card: *Your plan works in 100% of 1,000 possible futures*. Open the Safest route: *88%, fails mostly when study time drops below 5 hours a week*. | "Then we test the plan in 1,000 possible futures: slow AI, fast AI, busy months, and our own AI estimates off by their measured error. Her plan works in 100% of them. The slower Safest route holds in 88%, and HalaTuju tells her exactly why: weeks when she studies under five hours." | `shared/engine.js` stressTest; README |
| **3:05–3:50**<br>**Any job, real data** | Check any job: type "accountant". *Critical in Malaysia*. Four exposure scores, DOSM tiles, task bar. | "Any of 3,039 jobs, on real data. Accountant: on Malaysia's Critical Occupations List. Median wage for its group, RM 6,124 a month, with 9.8% more of them in work since 2021. Four sources score its AI exposure, from 35 to 59%. Its 30 tasks carry expert ratings: AI alone halves the time on 17% of them." | App, 23 Oct 2026 (ESCO, MyCOL, DOSM, O\*NET) |
| **3:50–4:25**<br>**⭐ Our model** | Model card: *r 0.919 on 185 unseen jobs · r 0.79 vs ILO across 2,956 jobs · trained on a RunPod RTX 4090*. | "Most skills have no published AI score, so we trained our own model on 19,265 tasks rated by researchers, on a RunPod GPU in two and a half minutes. On 185 jobs it had never seen, it matched the experts at r = 0.92, closer than GPT-4's own labels at 0.85. We then scored all 13,939 EU skills: across 2,956 jobs, it agrees with the International Labour Organization's own index at 0.79." | `ml/artifacts/eval.json`, `runpod_run.json` |
| **4:25–5:15**<br>**⭐ The reroute, in full** | Review queue: the Microsoft signal (microsoft.com, 22 Oct 2026) with its quote. **Approve and apply.** "Rerouting…" Toast: *Was: Vendor reconciliation → GHG. Now: Audit trail → Sustainability disclosure (7 wk)*. | "Back to that click. Every day the Job market researcher reads 74 vetted sites: 769 articles in five and a half minutes on its last full run. It found Microsoft's agent, checked the quote word for word on the page, and a second AI reviewed the claim. Small changes with two sources apply themselves. Anything that moves a route waits for a person. It also watches for skills that don't exist yet: the EU's list of 13,939 skills has not one of the five AI-era skills on Priya's map. One approval, and Priya's route goes through audit trail and sustainability disclosure: seven weeks instead of six, with the source and date attached, and the IFRS Foundation's own free course for the new step. Every change can be undone." | Live run 23 Oct 2026; demo dry run |
| **5:15–5:40**<br>**Impact** | _[Check before recording: the sample HR team shows on the demo server]_ HR view (sample team, labelled): who moves where, by when, at what RM cost. SDG icons 8, 4, 9, 12, 13. | "Her employer sees the same picture for the whole team: who moves to which role, by when, at what cost. Redeployment over retrenchment: decent work, SDG 8, and the green jobs Malaysia needs." | HR view (sample) |
| **5:40–6:00**<br>**Close** | Slide: *Replit · RunPod · ESCO, O\*NET, ILO, DOSM, MyCOL · 419 tests · 50-CV benchmark*. Logo. | _[Say "Live on Replit" only once the Replit deployment works; until then say "Built for Replit"]_ "Live on Replit, trained and served on RunPod, grounded in five public data sources, checked by 419 automated tests and a 50-CV benchmark. HalaTuju. Your career, rerouted the moment AI changes the road." | `npx vitest run` |

**Word count:** about 830 spoken words, about 5:50 at a natural pace. Time each clip; cut the "Any job" scene to its first two sentences if the total passes 6:30.

---

## How to present the Job market researcher's scope

State the current numbers first, then the rollout:

> "Today the Job market researcher covers every skill on the map: 29 skills every three days, 74 vetted sites, about 770 articles a run, on free tiers. Every new-skill candidate is already checked against all 13,939 ESCO skills. Next: licensed Malaysian job-ad data and Bahasa Melayu news."

| Phase | Coverage | What unlocks it |
|---|---|---|
| **1. Preliminary round (live)** | 29 map skills (all every 3 days), 74 trusted sites, ~770 articles and 28 searches per run, 30 AI checks, human approval; new skills: pages ranked by relevance, every candidate checked against all 13,939 ESCO skills, evidence built up across daily runs (3 real runs: 6 on the watch list, 3 hold up by hand) | Built and measured on 23–24 Oct 2026 |
| **2. Finals** | Watched skills reach the evidence bar (15 mentions, 5 organisations, 4 weeks) and a person confirms them; they join the map labelled "New skill, not in ESCO yet" | Daily runs over the coming weeks |
| **3. Pilot** | Licensed Malaysian job-ad feeds, BM-language news, employer-submitted requirements | Data agreements with job boards and pilot employers |

---

## Delivery rules
- **Speak to one person: Priya.** Say "she", not "users".
- **Short sentences.** If a line needs a breath in the middle, cut it.
- **Lead with the number.** "769 articles in five and a half minutes" lands.
- **Show, then say.** Let each visual land for a second before explaining it.
- **Plain words on camera:** "reads her CV", "a person approves", "our model". Leave "embedding pipeline" and "triage queue" for Q&A.
- **Record each scene as its own clip,** then edit. Warm up the RunPod endpoint 2 minutes before recording (`bash demo/prime.sh`).
- **Live means live.** If a step uses replayed or sample data, the screen label must say so (the HR team, the employers and the persona are sample).
- **The reroute needs the 2030 view.** At 2026 the Microsoft change is too small to move a route; drag the slider first.

## Lines to avoid
| Avoid | Why | Say instead |
|---|---|---|
| "A career GPS for the AI era" | Another entry in our domain opens with this exact line | "When AI closes a road, HalaTuju reroutes your career" |
| "92% accurate" | 0.92 is a correlation | "matched the experts at r = 0.92 on jobs it had never seen" |
| "Guarantees you a job" | Can't be promised | "gets you job-ready" |
| "Predicts the future" | Overclaim | "Your plan works in 100% of 1,000 possible futures" |
| "Fully autonomous" | People approve changes | "updates every day; a person approves anything that moves a route" |
| "Uses real job postings" | It doesn't (job boards are link-only) | "official job classifications, national statistics and vetted news" |
| "Real data" about the 16-job map | Its exposure and demand curves are sample | "the map's catalogue is labelled sample; any of 3,039 ESCO jobs runs on real data" |
| Any number not on screen or in a source | Fabrication rule | Read it from the app on the day |

---

## Judge Q&A prep

**Rule for every answer:** one sentence, then stop. Offer detail only if asked.

| Likely question | Short answer |
|---|---|
| **What's new here?** | "A route that reroutes when a person approves dated evidence about AI, tested in 1,000 futures, on our own measured exposure model." |
| **Where do the AI-exposure numbers come from?** | "Four sources side by side: the ILO index, Anthropic's Economic Index, the GPTs-are-GPTs study, and our own model." |
| **How accurate is your model?** | "r = 0.92 and an average error of 0.065 on 185 occupations it never saw, ahead of a nearest-neighbour baseline and GPT-4's own labels." |
| **Is it better on every measure?** | "No. Per single task, copying the nearest training task has a lower average error, 0.176 against our 0.203, so we use the model per occupation and per skill, where it wins." |
| **What did you train it on?** | "19,265 O\*NET tasks rated by researchers in the GPTs-are-GPTs study in *Science*. The ILO index is our independent check, so we never train on it." |
| **Was it trained on RunPod?** | "Yes: the final run was pod 38jijj8fe5dazu, an RTX 4090, 2.5 minutes, about four US cents; the log and metrics are in the repo. We tested locally first, which the organisers allowed." |
| **How much is real data?** | "All 3,039 ESCO occupations and 13,939 skills, ILO scores for 2,956 jobs, O\*NET tasks for 2,471, DOSM wages and MyCOL. The 16-job map's exposure and demand curves are a sample catalogue, labelled in the app." |
| **How do you know the CV reading works?** | "50 synthetic CVs labelled blind by a separate annotator; on the 36 we never tuned on, 97% current job, 72% of the ESCO skills we show are correct, 71% of the annotator's skills found." |
| **Who judged the skills?** | "Claude agents, blind, on shuffled lists with decoys; they rejected 98.5% of random decoys. We planned a Gemini judge, but the free quota ran out, so we threw those verdicts away." |
| **What about privacy?** | "Details are removed before any AI call: 99.4% of planted details on held-out CVs, after fixing what the blind first run found at 82.6%." |
| **Why are synthetic CVs good enough?** | "The rules forbid real personal data; a consented real-CV pilot is our Phase 2 test." |
| **Why does the plan work in 100%?** | "Her routes take 6 to 11 weeks and finish in 2027, before most AI takeovers in the data; the slower Safest route drops to 88%, and late or exposed routes fail more." |
| **Does the committee find new skills?** | "ESCO has none of our five AI-era skills. Across three real runs it put six candidates on watch, three hold up by hand, and the thresholds keep the rest out until a person confirms." |
| **How does it stay up to date?** | "Daily runs over 74 vetted sites, quotes checked word for word, a second AI reviewer, fixed rules, and a person for anything that moves a route; every change is versioned and can be undone." |
| **Why should we trust the AI?** | "The AI reads and explains; fixed formulas set every number, and a fact checker removes any sentence without a source." |
| **Your commits came in batches. Was this built during the hackathon?** | "Yes, from 19 October; the README's build log lists the dated evidence: the 22 October proposal, benchmark result files from 23 October, the RunPod log." |
| **What's the hardest risk?** | "A wrong signal rerouting people; that's why anything that moves a route needs a person, and every change can be undone." |
| **Who pays?** | "Employers redeploying staff, and universities. The worker app stays free." |
| **Where's Replit / RunPod?** | "The app runs on Replit; RunPod trained our model and serves the embeddings behind every CV; proof is in the declaration." |

---

## Rubric check
| Criterion | Where the pitch covers it |
|---|---|
| Innovation (30%) | The reroute after human approval, our own measured exposure model, 1,000-future stress test |
| Problem–solution fit (25%) | Priya's three questions answered in order; all six must-haves appear on screen; a person approves every route change |
| Feasibility (25%) | Live upload, map and reroute; model results with baselines and an independent check; 419 tests; hardest risk and fallback in Q&A |
| Clarity (20%) | One persona, one one-liner, three memorable moments, under 6:30 |
