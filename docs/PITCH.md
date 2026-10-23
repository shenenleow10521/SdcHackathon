# HalaTuju: Pitch Story

> **For:** whoever records the video and answers judges' questions.
> **Length:** 6:00 target. Hard limit 7:00: every 30 s over costs a point.
> **Numbers:** every number below was measured in the app, its data or a result file in this repo on 23–24 Oct 2026 (sources in the last column of the script). Anything in _[brackets]_ is read off the live app on recording day. Never say a number you can't point to.

---

## The one-liner

> **When AI closes a road, HalaTuju reroutes your career, and a person signs off on every change.**

Close with: **"When AI changes the road, your route changes with it."** (say it once, at the end)

## The story in one breath

**Priya** has processed invoices in Penang for eleven years. Her company is handing that work to AI agents, and she has **six months** to move into a new role. HalaTuju reads her CV in **15 seconds**, maps her against **3,039 jobs**, gives her a route that fits **six hours a week**, tests it in **1,000 futures**, and **reroutes her the moment a person approves new evidence about AI**.

## Three moments judges must remember

1. **The reroute:** dated evidence, a person clicks Approve, her route bends around a closed road.
2. **Our own model:** trained on RunPod, r 0.919 on 185 jobs it never saw.
3. **1,000 futures:** "Your plan works in 100% of 1,000 possible futures."

If time runs short, cut detail. Never cut these three.

---

## Full script (about 5:45)

Numbers in _[brackets]_ are read off the app on recording day (the demo script `docs/DEMO.md` has the dry-run values). Show at most two numbers on screen per scene; say the rest.

| Time | On screen | Voiceover | Source |
|---|---|---|---|
| **0:00–0:20**<br>**Cold open: the reroute** | Priya's map at 2030. The Microsoft source card, 22 Oct 2026. Cursor clicks **Approve**. The camera moves to *Vendor reconciliation*, the road closes, the orange route swings through audit trail and sustainability disclosure. | "On 22 October, Microsoft released an AI agent that reconciles accounts by itself. Someone on our side read the evidence and clicked approve. Watch what happens to Priya's route." *(let the reroute play, 2 seconds of silence)* | `docs/DEMO.md` step 8 |
| **0:20–0:45**<br>**Priya** | Title card *HalaTuju*. Then a mock company email (prop): *"From next year, AI agents will run invoice matching. Staff who move into new roles within six months will be redeployed."* | "Priya has worked in accounts payable in Penang for eleven years. This email gives her six months to move into a new role. She can study about six hours a week. She has three questions: which of my skills still count, where can I go, and will the advice still hold next month?" | Sample persona |
| **0:45–1:15**<br>**The CV** | Drop `priya-cv.pdf`. Stage text *Removing personal details*, then *Matching to ESCO*. The summary appears. On screen: **97%** and **99.4%** as captions. | "She uploads her CV. Her name, phone, IC number and address are removed first, on our server, before any AI reads a word. About fifteen seconds later she sees her skills, each with the line from her CV that shows it, matched to the EU's official list of 13,939 skills. We tested this on 36 CVs we never tuned on: it got the current job right 97% of the time and removed 99.4% of personal details." | Demo dry run; `eval/RESULTS.md` |
| **1:15–1:50**<br>**The map** | The map builds: Priya in the middle, her skills, skills to learn, jobs. Press play on the year slider, 2026 to 2030: skills turn grey as AI takes them over. **My skills** tab: the at-risk group grows. | "This is her map. She's in the middle, her skills around her, the jobs she could move to on the outside. Now play the years. Invoice entry goes to AI in 2027. Three-way matching in 2028. By 2030, _[n]_ of her skills are at risk." | Demo dry run, My skills tab |
| **1:50–2:40**<br>**Her route** | Explore: the top four jobs. **Find other jobs → Sustainability → ESG & Carbon Reporting Analyst, 57%** → **Set as my goal**. Route rows. Next up: the GHG Protocol webinar (click: the real page opens). **Find openings → MyFutureJobs**. | "Four jobs fit her best today. But Priya would rather work on something she cares about, so she looks at sustainability jobs. ESG and carbon reporting fits her at 57%. Eleven years of tracing every number back to an invoice is exactly what carbon accounting needs. The fastest route takes six weeks of study and gets her job-ready well before her deadline. Her first step is free: a training webinar from the GHG Protocol, the people who wrote the standard. And the jobs exist: here are live openings on MyFutureJobs, the government's job portal." | Demo dry run; `db/seed/courses.json`; MyFutureJobs |
| **2:40–3:10**<br>**⭐ 1,000 futures** | Card: *Your plan works in 100% of 1,000 possible futures*. Switch to the Safest route: *88%*, with the reason it fails. | "We don't know how fast AI will move, so we test her plan in 1,000 possible futures: AI faster or slower, our own estimates off by their measured error, and the weeks when life gets in the way. Her plan works in all of them. The slower Safest route works in 88%, and HalaTuju says why: in the futures where she studies under five hours a week." | `shared/engine.js` stressTest |
| **3:10–3:35**<br>**Beyond four jobs** | ESCO view for her current role: **Closest moves**, a list of jobs by shared skills, each with AI exposure. | "Beyond these four, she can check any of 3,039 jobs in the EU's official classification. Here are the closest moves from her current role, ranked by the skills they share, with how much AI each one faces." | App (ESCO career network) |
| **3:35–4:10**<br>**⭐ Our model** | Model card: *r = 0.92 on 185 unseen jobs*, *trained on a RunPod RTX 4090*. | "Most skills have no published AI score, so we trained our own model. It learned from 19,265 tasks rated by researchers, trained on a RunPod GPU in under three minutes. On 185 jobs it had never seen, it agreed with the experts at 0.92, closer than GPT-4's own labels. We also checked it against the International Labour Organization's index, built from different data: across 2,956 jobs they agree at 0.79." | `ml/artifacts/eval.json`, `runpod_run.json`; README |
| **4:10–4:45**<br>**⭐ How the reroute works** | Review queue: the Microsoft change with its quote and date. **Approve and apply.** Toast: *Was: Vendor reconciliation → GHG. Now: Audit trail → Sustainability disclosure*. | "Back to that click. Every day our job market researcher reads 74 trusted sites. It found Microsoft's announcement, checked the quote on the page itself, and a second AI reviewed the claim. Anything that would change someone's route waits for a person. One approval, and Priya's route goes through audit trail and sustainability disclosure instead, with the IFRS Foundation's free course for the new step. It also watches for skills that don't exist yet: the EU's list has none of the five AI-era skills on her map." | Live run 23 Oct 2026; `eval/EMERGING.md` |
| **4:45–5:15**<br>**Her employer** | HR view (sample team, labelled): who moves where, by when, at what cost. SDG icons on screen (no voiceover for them). | "Her employer sees the same picture for the whole team: who can move to which role, by when, and what it costs. That's the difference between redeploying people and letting them go." | HR view (sample) |
| **5:15–5:45**<br>**Close** | Slide: *Replit · RunPod · ESCO, ILO, DOSM, MyCOL · 419 tests · 50-CV benchmark*. Logo. | _[Say "running on Replit" only once the deployment works; until then "built for Replit".]_ "HalaTuju runs on Replit, trains and serves its model on RunPod, uses five public data sources, and is checked by 419 automated tests and a 50-CV benchmark. When AI changes the road, your route changes with it." | `npx vitest run` |

**Length:** 626 spoken words, 4:24 read by a generated voice at normal speed (measured 24 Oct). With visual-only beats the video runs about 6:00; see `docs/VIDEO_PLAN.md` for the per-scene budget. If a take runs long, shorten "Beyond four jobs" first.

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
