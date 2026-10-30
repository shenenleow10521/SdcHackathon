# KerjAIya finals deck: the one guide (v6)

**For:** the teammate building the .pptx, whoever presents, and whoever builds on 31 Oct.
**Written:** 30 Oct 2026. v6 merges everything into one file: the full-marks version of the pitch, a **Status** line on every slide (what's ready, what's still being built), the build list for 31 Oct, Q&A and "don't say". Private (this folder is gitignored).

**How to read it**
- **Status: Ready** = works in today's app; only needs re-reading on the final build.
- **Status: Building B#** = depends on item B# in the build list (section 6). If B# isn't done by the freeze, use the **If not built** line.
- **`{measure}`** = a placeholder number. Read it off the final build or test and replace it. Never present a placeholder.
- **Name:** "KerjAIya" is the working name (said "kerjaya"). If the team keeps HalaTuju, replace it everywhere and never compare the app to Google Maps or Waze.

**Scores so far** (simulated judge panels, against the finals rubric): v4 deck 73/100. v5 deck 78/100. This full version, with everything built, 84/100 (range 79 to 88). Realistic ceiling for the team: about 86 to 88. The last few points come from a clean live demo and plain, uncluttered slides, not from more features.

---

## 0. The story in four lines

1. **The question everyone asks:** "Will AI take my job? How much of it? Which of my skills?" No one answers it for *your* skills in *your* job.
2. **The second problem:** AI moves so fast that training is out of date by the time you finish it.
3. **What we built:** KerjAIya shows which of your skills AI takes and what to learn, tests your route to stay or move, and updates your plan when the evidence changes.
4. **The close:** **"KerjAIya. When AI changes the route, your route changes with it."**

| Claim | Most tools | KerjAIya |
|---|---|---|
| **① Every skill scored** | A job match, no view of your own skills | Our own model scores all 13,939 official skills |
| **② Every route tested** | One fixed plan | 1,000 simulated futures per route, Steady and Fast AI |
| **③ Updated when the evidence changes** | Fixed data, refreshed by hand | 74 trusted sites, three agents vote, every decision logged, you choose keep or switch |

**Story order:** stay first, then move. **Live vs slides:** the worker's journey is live; the reviewer's queue and HR views are screenshots on slides 8 and 10, and stay signed in on the laptop for Q&A.

---

## 1. Rules and rubric

| Item | Rule |
|---|---|
| Pitch | 10 min + 5 min Q&A. **−1 point per 30 s over.** This plan: 8:25 of content, about 9:00 to 9:30 as really delivered. Rehearse to finish under 9:00 |
| Must cover | Problem, solution, technical implementation, SDG relevance, impact, feasibility, live demo (Handbook §6.7.2) |
| Slides | .pptx, opened on our own laptop; bring an HDMI adapter |
| Deadline | **1 Nov, 07:59:59 MYT** on sdchack.my: updated PRD, updated tech declaration, Final Solution Report, backup video (YouTube), GitHub link with committee accounts added, .pptx |

| Criterion | Marks | Top band ("Great!") | Where we earn it |
|---|---|---|---|
| Execution | 30 | Smooth, fast, no bugs | Live demo; Q&A "name any job" |
| Effectiveness | 20 | Complete solution, high-value features beyond the brief | Demo covers all six must-haves (table in section 5); slides 6 to 8 |
| UI/UX | 15 | Exceptional, fully accessible | Demo Act ④; usability result on slide 9 |
| Deployment | 15 | Good test coverage, automated monitoring | Slide 9 |
| Presentation | 15 | Polished, highly compelling | Story, close, plain slides |
| Architecture | 5 | Highly modular, clean boundaries | Slide 9 |

---

## 2. Style rules

1. **Headline = the finding, 12 words or fewer, with its number.**
2. **One idea, one exhibit, and one hero number per slide.** Supporting numbers go small or to the appendix. Judges remember about three numbers from the whole pitch; slides 6 to 9 each give them one.
3. Body text under 25 words, 24 pt or more. Small source line under any number.
4. One accent colour for KerjAIya; comparators in grey. Screenshots full-frame, highlight by dimming; never crop or zoom.
5. Story only in the opening, the demo and the close.
6. **Spoken: one number per sentence;** small samples as counts ("35 of 36").
7. No "it's not X, it's Y", no slogans, no stacked triplets, no hedging, no hype, no middle-dot separators. Only measured numbers.

---

## 3. Run of show (8:25)

| # | Slide | Time | Ends at | Status |
|---|---|---|---|---|
| 1 | Title | 0:10 | 0:10 | Ready (URL: B26) |
| 2 | The question everyone asks | 0:27 | 0:37 | Ready |
| 3 | Plans go stale | 0:20 | 0:57 | Ready |
| 4 | What we built | 0:25 | 1:22 | Ready |
| 5 | **Live demo**, four acts | 4:00 | 5:22 | Mixed, see section 5 |
| 6 | ① Every skill scored | 0:30 | 5:52 | Ready (one check: B21) |
| 7 | Reading people privately and fairly | 0:28 | 6:20 | Mostly ready (B19, B20) |
| 8 | ③ Three agents vote | 0:35 | 6:55 | Building (B18, B22) |
| 9 | Built, tested and monitored | 0:37 | 7:32 | Building (B12, B14 to B17) |
| 10 | Impact, SDGs and feasibility | 0:35 | 8:07 | Building (B6 to B8, B27) |
| 11 | Close | 0:18 | **8:25** | Ready once demo numbers are read (B1) |

**If a rehearsal runs long:** cut Act ④'s keyboard beat to one sentence, then slide 7's fairness sentence. Never cut the demo below 3:30.
**Roles:** one person drives, one narrates. The driver never talks; the narrator stays silent during clicks.

---

## 4. Slides

### Slide 1: Title (0:10)
- **Headline:** KerjAIya
- **Under it, large:** When AI changes the route, your route changes with it.
- **Small:** Team Dsaise: Leow Shen En, Tan Wei Feng, Lim Jie Shin, Esther Kong Yuan Er, Choong Zhuo Lin. SDC Hackathon 2026, Domain 1. Live URL and QR code.
- **Exhibit:** full-bleed screenshot of the map with Priya's route drawn.
- **Say:** "We're Team Dsaise, and this is KerjAIya." (Say "kerjaya" slowly.)
- **Status:** Ready. URL and QR: B26.

### Slide 2: The question everyone asks (0:27)
- **Headline:** 620,000 Malaysian jobs highly impacted by AI within 3 to 5 years
- **Exhibit:** three questions in large type on the left ("Will AI take my job?", "How much of it?", "Which of my skills?"). Right: **620,000** Malaysian jobs highly impacted by AI and digitalisation within 3 to 5 years; **1 in 4** workers worldwide have a job AI can partly do, and most of those jobs change rather than vanish.
- **Source:** TalentCorp impact study, 2024; ILO Working Paper 140, 2025.
- **Say:** "Will AI take my job? How much of it? Which of my skills? TalentCorp counts 620,000 Malaysian jobs highly impacted by AI and digitalisation. That's within the next 3 to 5 years. The ILO finds most of these jobs change rather than vanish. So each of those workers needs to know which of their own skills will change. No one tells them."
- **Status:** Ready.

### Slide 3: Plans go stale (0:20)
- **Headline:** 56% use AI at work, 26% are trained, and training goes stale
- **Exhibit:** two stat blocks; under them a quote card: *"Learning pathways are usually static lists that are out of date by the time they are published."* (Domain 1 brief, Aiversecity)
- **Source:** Hays Asia Salary Guide 2025, cited in the Domain 1 brief.
- **Say:** "56 percent of Malaysian professionals already use AI at work. Only 26 percent have been trained for it. And training goes out of date fast. You start a course, a new AI tool comes out, and the skill you're learning has already changed."
- **Status:** Ready.

### Slide 4: What we built (0:25)
- **Headline:** 13,939 skills scored, routes tested 1,000 times, plans updated from news
- **Exhibit:** the three-row table from section 0 (comparator column grey, KerjAIya in accent).
- **Small line:** For workers, fresh graduates and career switchers, and the HR teams and career centres that guide them.
- **Source:** ESCO v1.2.1, European Commission.
- **Say:** "So we built KerjAIya. It does three things. It shows which of your skills AI takes, and what to learn next. It tests your route, whether you stay in your job or move to a new one. And it updates your plan when the evidence changes. Let me show you."
- **Status:** Ready.

### Slide 5: Live demo (4:00)
- **Slide:** "Live demo" and the URL; four act labels: **① Stay, ② Move, ③ Updated, ④ For everyone**. The backup video hidden on it, one click away.
- **Status:** see section 5.

### Slide 6: ① Every skill scored (0:30)
- **Headline:** Our model scores all 13,939 official skills, agreeing with experts at 0.92
- **Hero number:** **0.92**, agreement with expert ratings on 185 jobs the model never saw (1 = perfect).
- **Exhibit:** bar chart on the same 185 held-out jobs: **KerjAIya model 0.919**, simple baseline 0.88, GPT-4 ratings 0.85 (grey). Small under it: 13,939 skills and 3,039 jobs (ESCO v1.2.1); 27 AI-era skills added from 58 published sources (IMDA/SkillsFuture, WEF, EU AI Act, NIST, Bank Negara, TalentCorp); 0.79 against the ILO's index on 2,956 jobs, never trained on.
- **Source:** ESCO v1.2.1; expert ratings: Eloundou et al., Science 2024 (19,265 tasks); trained on RunPod. "At risk" = model score 0.7 or more, about the top 5% of skills.
- **Say:** "We start from the EU's official list of 3,039 jobs and the skills each one needs. It's missing the newest AI skills, so we added 27, each from a published source such as Bank Negara. Then we trained our own model on expert ratings of which work tasks AI can do. On jobs it had never seen, it agrees with the experts at 0.92, where 1 is perfect."
- **Status:** Ready. **B21:** confirm GPT-4's 0.85 is on the same 185 jobs. **If not confirmed:** remove the GPT-4 bar.

### Slide 7: Reading people privately and fairly (0:28)
- **Headline:** Job named right in 35 of 36 CVs; details removed first
- **Hero number:** **35 of 36**.
- **Exhibit:** table

  | What we measured | Result | Status |
  |---|---|---|
  | Current job named from a CV, 36 blind synthetic CVs | **35 of 36** | Ready |
  | Personal details removed before any AI reads it | **154 of 155** after fixes (first blind run 128 of 155) | Ready |
  | Same test on 20 new CVs written after the fixes | `{measure}` of 100 planted details | B19 |
  | Same CV, six identities (name, gender, age, race, religion, marital status) | AI receives **identical text** in all 6; same skills, matches and routes | Ready (`tests/fairness.test.ts`); write-up B20 |
  | No CV: questions put the right job in the top 3 (finance, sales, IT) | **95 to 100%** of simulated users (about 70% for trades) | Ready |

- **Small text:** bge-m3, a meaning-matching model, links CV wording to official skills, so "paid supplier invoices" finds "process payments".
- **Source:** Blind CV test 24 Oct 2026; fairness test `tests/fairness.test.ts`; quiz simulation 30 Oct 2026. All CVs synthetic.
- **Say:** "You saw Priya's details removed. On 20 new CVs, it removed `{measure}` of 100 planted details before any AI saw them. It named the person's job right in 35 of 36 CVs. Then we gave one CV six different names, ages, genders and races. The AI received exactly the same text every time, so her matches came out the same."
- **If B19 not built:** say "After fixes, it removes 154 of 155 planted details before any AI sees the CV."

### Slide 8: ③ Three agents vote on every signal (0:35)
- **Headline:** Three agents vote; they agreed with our team on `{measure}` of 40
- **Hero number:** the replay agreement, `{measure}` of 40.
- **Exhibit, left:** the flow

  | Step | What happens |
  |---|---|
  | Read | Every 24 hours, agents read news and research from **74** trusted sites |
  | Check | The quote must appear word for word on the page; the same quote on two sites counts once |
  | Vote | Evidence checker (real, recent, trusted?), skill matcher (about this skill?), sceptic (hype or a sales pitch?) |
  | Decide | 2 or 3 yes: applied, labelled "approved by agent vote", undoable. 1 yes: a person decides. 0 yes: rejected and logged |
  | You choose | Anyone whose saved plan is affected gets "keep my route or switch" |

- **Exhibit, right:** screenshot of the reviewer's queue with one signal open, each agent's vote and reason visible. Under it, one dated card: **CNBC, 27 Oct 2026:** QuickBooks uses AI to suggest transaction matches.
- **Small line:** final-build run: `{measure}` articles in `{measure}` minutes; replay: 40 signals two teammates labelled by hand, bad signals let through `{measure}` of `{measure}`.
- **Source:** `eval/VOTES.md`; every decision is written to an audit log with each vote and reason, and every change can be undone.
- **Say:** "To keep plans current, agents read 74 trusted sites every day. For example, QuickBooks now uses AI to suggest transaction matches, which is part of Priya's job. One agent can be fooled, so three vote: one checks the evidence, one checks it's about this skill, and one is a sceptic. Two yes votes and it's applied; a split goes to a person. On 40 signals we labelled by hand, the agents agreed with us `{measure}` times."
- **Status:** flow and screenshot Ready (screenshot taken on the final build). **B18:** the 40-signal replay. **B22:** confirm the 24-hour schedule on Replit and re-run the article count.
- **If B18 not built:** headline "Three agents vote on every signal, and every decision is logged"; drop the last spoken sentence; never quote an accuracy.

### Slide 9: Built, tested and monitored (0:37)
- **Headline:** Six modules, `{measure}`% test coverage, checked every 5 minutes
- **Worth 20 marks** (Architecture 5 + Deployment 15). Judges also check the repo, CI and report, so the slide stays clean and the detail goes in the Final Solution Report.
- **Exhibit, left: architecture diagram.** Six boxes with arrows showing which calls which. Outside services (Gemini, RunPod) drawn at the edge as plug-ins, each with its fallback beside it.

  | Module | Does | Built with | Folder `[check against the code]` |
  |---|---|---|---|
  | Data | ESCO, O*NET, ILO, Anthropic Index, DOSM, MyCOL | Postgres, versioned | `server/kb.ts`, `db/` |
  | Model | AI exposure per task and skill | bge-m3 + trained model, RunPod | `ml/`, `server/services/` |
  | Profile | CV or questions to skills, personal details removed | Gemini Flash-Lite + bge-m3 | `server/agents/`, `server/lib/` |
  | Engine | Match, routes, goal tracking, 1,000-futures test | TypeScript, plain code | `shared/engine.js` |
  | Researcher | Reads news, checks quotes, three-agent vote | Gemini, 74 sites | `server/agents/`, `server/sources/`, `server/triage.ts` |
  | People | Worker, HR, advisor, reviewer views | Web app, English, BM, Chinese | `web/` |

  Edge: Gemini down → keyword matching; RunPod cold → local model; no course → "no course listed yet".
- **Exhibit, right: delivery strip.** GitHub push → CI on Node 22 and 24 → typecheck → `{measure}` tests, `{measure}`% coverage, module-boundary check → deploy from a green commit to Replit → `/api/health` (database, AI model, embeddings, scheduler) → outside monitor every 5 minutes. Small screenshot of the public status page ("`{measure}`% uptime since `{date}`"). One small line: "5 first-time users reached a ranked plan unaided, median `{measure}` minutes."
- **Source:** CI run on the final commit; status page URL; `eval/USABILITY.md`.
- **Say:** "Six modules, each with one job, and a check in CI stops one module reaching into another. AI reads text; plain code calculates every number, so every number can be explained. Every push runs the full test suite, which covers `{measure}` percent of the code. An outside monitor checks the live app every 5 minutes. If Gemini goes down, CV reading falls back to keyword matching, and the screen says so."
- **Status:** CI, tests, health check, fallbacks Ready. **B15** uptime monitor (start a day early). **B14** coverage. **B16** deploy from green commit. **B17** boundary check. **B12** usability test.
- **If not built:** B14 → say "`{measure}` tests on every push" (533 on 30 Oct). B17 → drop "a check in CI stops…". B15 → never say "monitored".

**Uptime monitoring, in plain words (B15):** a free outside service (UptimeRobot or Better Stack) calls `[live URL]/api/health` every 5 minutes, emails the team if it fails, and keeps a public status page. Setup: about 10 minutes. Start it as soon as the final build is live so the page shows history.

### Slide 10: Impact, SDGs and feasibility (0:35)
- **Headline:** Retraining a worker costs RM 150; retrenching one costs RM 22,800
- **Hero number:** RM 150 vs RM 22,800.
- **Exhibit, left:** SDG table

  | Goal | How KerjAIya serves it |
  |---|---|
  | **SDG 4.4** skills for work | Every route is a skills plan, with hours and courses |
  | **SDG 8.5** decent work | Redeploy exposed workers instead of retrenching them |
  | **SDG 8.2** productivity through innovation | Workers learn the AI skills their own job now needs |
  | **Any goal, by choice** | Each job and skill carries its goal; Priya put `[goal]` first and saw the cost |

- **Exhibit, right, top:** two small screenshots: Priya's **SDG contribution view** (her route's skills grouped by goal) and the **HR team skills-gap view** (opt-in workers only, team totals).
- **Exhibit, right, bottom:** Reading one CV: RM 0.03 (measured). One market check: RM 1.05 (measured). One clerk's statutory severance after 11 years: RM 22,800. KerjAIya for one worker for 6 months: RM 150 (pilot price). First step: a 3-month pilot with one HRD Corp-registered employer `[team decision]`.
- **Source:** Employment (Termination and Lay-Off Benefits) Regulations 1980; DOSM 2025 clerical median RM 2,693. Prices are pilot assumptions; costs measured 24 Oct 2026.
- **Say:** "Every job and skill carries its UN goal, and Priya's plan shows what her route adds to each one. HR teams see their team's skill gaps, only for workers who choose to share. Workers use KerjAIya free; employers pay. For an employer, retrenching a clerk with 11 years' service costs about 22,800 ringgit in severance. Retraining that clerk with KerjAIya for six months costs 150."
- **Status:** SDG re-rank on jobs, HR progress view, costs Ready. **B6** SDG tag on every skill. **B7** SDG contribution view. **B8** HR skills-gap heatmap. **B27** pilot plan.
- **If not built:** B6 → "Each job carries its goal". B7 → drop that screenshot. B8 → use the existing HR team progress screenshot and say "see their team's progress".

### Slide 11: Close (0:18)
- **Headline:** KerjAIya. When AI changes the route, your route changes with it.
- **Under it, small:** Priya: 3 of her 10 skills at risk; `[target job]` in `{measure}` weeks; works in `{measure}` of 1,000 futures; plan updated on 27 Oct 2026 evidence.
- **Footer:** live URL, github.com/shenenleow10521/SdcHackathon, status page, QR code.
- **Say:** "Priya asked which of her skills AI would take. It's 3 of her 10. She has a route to `[target job]`, and it moves when the news does. KerjAIya. When AI changes the route, your route changes with it. Thank you."
- **Status:** Ready once B1 numbers are read.

---

## 5. Live demo (4:00)

### What the judges see
One web page, white and light grey. **Top bar:** a From/To job search, a forecast-year slider (2026 to 2030), an AI adoption switch (Steady / Fast), a language switch (English / BM, plus 中文 after B9). **Centre:** a 3D map. "You" sits in the middle, each job is a star, distance from "You" is time to be job-ready, with rings at 3 months, 6 months, 1 year and 2 years+; star size is match %. With a route open, other stars fade and the route is drawn as numbered steps with a "You are here" marker. A "List view" button (B10) shows the same jobs as a plain ranked table for keyboard and screen-reader users. **Right:** a side panel with tabs: **My skills** (summary card At risk / AI-assisted / Still yours, skills radar after B5, one row per skill), **Jobs** (ranked list with match %, weeks, demand rising or falling, "Fits SDG", and "Put a UN goal first"), **Plan** (match, weeks, steps, "How sturdy is this plan?"), **My goal** (This week, Stay AI-ready track, Your move track, skills record; tapping a step opens how AI changes the skill, ways to learn, practise at work, prove). **Pop-ups:** the signal notice with source, date, quote and vote tally and **Keep my route / Switch**; "Path changed"; a progress notice after ticking a step.

`[check every label on the frozen build]`

### Before the slot
- Priya's profile pre-loaded with a saved plan (fallback if the live upload is slow).
- The CNBC signal voted through **live on the server that morning**, so Priya's notice is waiting. Say so if asked: it is a real vote, run earlier.
- Admin, reviewer and HR views signed in, in a second window, for Q&A.
- Browser at 100% zoom, notifications off, backup video on the laptop, phone hotspot on, wired mouse and keyboard.

### Act ① Stay (0:00 to 1:05)

| Time | Judges see | Say | Status |
|---|---|---|---|
| 0:00 to 0:20 | CV dropped in; name, IC and phone blacked out; progress shown; skills appear | "This is Priya, an accounts payable clerk for 11 years. Her name, IC and phone are removed before any AI reads this. No CV? She could answer a few questions instead." | Ready. Progress during the 12.9 s read: B13. Fallback: pre-loaded profile |
| 0:20 to 0:35 | Summary card: At risk 3, AI-assisted 1, Still yours 6 | "Remember the question: which of my skills? She has 10. AI puts 3 of them at risk. The rest are still hers, and AI helps with one." | Ready |
| 0:35 to 0:50 | One skill row: "AI can do 84% of this work", its SDG tag, what to learn instead, "Learn in 1 hour" | "Take `[skill name]`. AI can do 84 percent of it. So she learns to check what the AI matches and handle the cases it can't. The first lesson takes one hour." | Ready. SDG tag on the skill: B6 |
| 0:50 to 1:05 | Skills radar: rising and falling skills in her field, each with source and date; Stay AI-ready track below | "Her skills radar shows what's rising and falling in finance work, each with its source and date. If she stays, her plan starts with `[top rising skill]`." | **B5.** If not built: show the Stay track only: "If she stays, she gets a plan for her own job, starting with `[first Stay skill]`." |

### Act ② Move (1:05 to 2:25)

| Time | Judges see | Say | Status |
|---|---|---|---|
| 1:05 to 1:20 | Jobs tab: ranked list, match %, weeks, demand, SDG tags | "Or she moves. Here are her best matches across 3,039 jobs. Each shows the match, the weeks to get there, and whether demand is rising." | **B4** (sensible top matches). If not fixed: show the curated list and say "her best matches", without "3,039" |
| 1:20 to 1:35 | "Put a UN goal first" → `[goal]`; the list re-ranks with its cost line | "She cares about `[goal]`, so she puts that goal first. The list re-ranks and shows the cost: `{measure}` points less match." | Ready |
| 1:35 to 1:50 | Pick `[target job]`: big "`{measure}`% match, `{measure}` weeks"; route drawn, rings visible | "She picks `[target job]`. She studies 6 hours a week. That makes her job-ready in `{measure}` weeks." | Ready. **Pick a target whose weeks look believable** (an 11-week jump from AP clerk to ESG analyst drew a "too good to be true" flag) |
| 1:50 to 2:05 | "How sturdy is this plan?": works in `{measure}` of 1,000; "When it fails" | "We tested this route in 1,000 futures: AI faster or slower, less study time, longer steps. It works in `{measure}` of them. These are estimates, and it shows what usually breaks the plan." | Ready. All-route coverage: B23 |
| 2:05 to 2:25 | **Mark as done** on step 1; notice "Match X% → Y%, N weeks left"; "You are here" moves | "Say three weeks later she finishes her first step. [pause] Her match goes up to `{measure}` percent. `{measure}` weeks to go." | Ready |

### Act ③ Updated (2:25 to 3:20)

| Time | Judges see | Say | Status |
|---|---|---|---|
| 2:25 to 2:45 | Flip Steady → Fast; "Path changed"; route redraws; sturdiness now `{measure}` of 1,000 | "What if AI moves faster? One switch. `[skill]` is now at risk, so her route goes another way. It now works in `{measure}` of 1,000 futures." | **B2.** If Fast doesn't change her route: show only the sturdiness number dropping |
| 2:45 to 3:05 | Signal notice: CNBC, 27 Oct 2026, exact quote, "approved by agent vote (`{measure}` of 3)" | "Partway through her plan, the news changes. On 27 October, CNBC reported that QuickBooks uses AI to suggest transaction matches. Three agents checked it and voted it through." | **B3** (fires 3 of 3 on Replit). Fallback: backup video from this beat |
| 3:05 to 3:20 | Keep my route / Switch, old and new route; she picks Switch; map redraws | "Her plan doesn't go stale. She sees the old route and the new one, and she decides whether to switch." | B3 |

### Act ④ For everyone (3:20 to 3:50)

| Time | Judges see | Say | Status |
|---|---|---|---|
| 3:20 to 3:35 | Language switch to BM, then 中文; numbers stay the same | "She can use it in Bahasa Melayu, or in Chinese." | BM Ready. **B9** Chinese. If not built: "She can use it in Bahasa Melayu" plus one short BM line |
| 3:35 to 3:50 | Driver lets go of the mouse, opens List view, tabs through the jobs; focus ring moves row to row | "Everything you've seen works from the keyboard alone, with labels for screen readers. It passes an automated accessibility check with zero errors." | **B10.** If not built: cut this beat |

3:50 to 4:00 is slack for the CV wait and the pause after the tick. **Hard cutoff:** reaching Act ③ at 2:25 or later, skip the Fast switch. Never drop the tick or the signal.
**Fallback ladder:** 1. Live URL. 2. Local build on the laptop (empty `DATABASE_URL`, its own `PGLITE_DIR`, `SCOUT_SCHEDULE=off`). 3. Backup video from the current beat.

### The six must-haves in the demo

| Domain 1 must-have | Where judges see it |
|---|---|
| 1. Skills profile intake | Act ①, CV upload; questions offered |
| 2. AI-trend signal layer, source and date | Act ① skills radar (B5); Act ③ signal notice; demand on job rows |
| 3. Ranked roles, explainable match and gap | Act ②, ranked Jobs list; the Plan's match explanation |
| 4. Personalised pathway, time and resources | Act ②, steps with hours and courses |
| 5. SDG mapping that matters | Act ② "Put a UN goal first" re-ranks and shows the cost; SDG on skills (B6); slide 10 |
| 6. More than one scenario, shown as estimates | Act ② sturdiness; Act ③ Steady → Fast |

**Good-to-haves shown:** automatic re-planning (Act ③), English, BM and Chinese (Act ④), progress tracking (tick), fairness check (slide 7), HR team view and SDG contribution view (slide 10).

---

## 6. Build list for 31 Oct

Ordered by **risk to the demo first, then marks per hour**. Owner column for the team to fill. Total about 75 hours across five people.

| # | What must be true | Today | Criterion | Hours | Risk | Owner |
|---|---|---|---|---|---|---|
| **Demo must work** | | | | | | |
| B1 | Read Priya's numbers off the frozen build: target job, match, weeks, futures at Steady and Fast, tick numbers, skill names | All placeholders | Execution, Presentation | 2 | Medium | |
| B2 | Steady → Fast changes Priya's route, not only the sturdiness number | Unconfirmed | Effectiveness | 2 | Medium | |
| B3 | CNBC signal → keep-or-switch notice fires on Replit 3 runs of 3 | Unconfirmed on deployed build | Execution, Effectiveness | 3 | **High** | |
| B4 | Ranked list across 3,039 jobs gives sensible top matches (weight skills by importance) | ESCO best match tops out near 23% with odd picks | Effectiveness, Execution | 6 | **High** | |
| B13 | Page and API under 1 s at p95; progress shown during the CV read | Only CV median (12.9 s) measured | Execution | 3 | Medium | |
| B25 | 30 random jobs rehearsed for "name any job" | Not rehearsed | Execution | 3 | Medium | |
| B28 | Three timed rehearsals under 9:00; backup video re-recorded on the final build | Video from an earlier build | Presentation, Execution | 5 | Low | |
| **Cheap marks** | | | | | | |
| B15 | Outside uptime monitor on `/api/health`, alerts, public status page, started a day early | Health endpoint exists, no monitor | Deployment | 0.5 | Low | |
| B16 | Deploy only from a green commit on `main`, tagged, rollback rehearsed | Replit published by hand | Deployment | 1 | Low | |
| B14 | Test coverage measured in CI with a minimum threshold | 533 tests, no coverage | Deployment | 2 | Medium | |
| B21 | GPT-4 0.85 confirmed on the same 185 jobs, or removed | Unconfirmed | Presentation | 1 | Low | |
| B20 | Fairness test written up in `eval/FAIRNESS.md` | Test exists (`tests/fairness.test.ts`) | Effectiveness | 1 | Low | |
| B12 | 5 first-time users reach a ranked plan unaided; median time in `eval/USABILITY.md` | Not done | UI/UX | 2 | Low | |
| B26 | Final name, live URL, QR on slides 1 and 11 | Open | Presentation | 0.5 | Low | |
| B27 | Pilot plan named (one HRD Corp-registered employer, 3 months; a plan, not a deal) | Team decision | Presentation | 0.5 | Low | |
| **Proof numbers** | | | | | | |
| B18 | Vote replay on 40 hand-labelled signals: agreement and bad-signals-let-through | 1 of 1 | Effectiveness, Presentation | 3 | Medium | |
| B19 | Personal-details removal re-tested on 20 new CVs | 154/155 on the same CVs used to fix misses | Effectiveness | 3 | Medium | |
| B22 | News scheduler runs every 24 h on Replit; final-build run re-measured | 24 h default; 769 articles in 5.5 min earlier | Effectiveness | 1 | Medium | |
| B23 | 1,000-futures test covers every route, incl. ESCO routes and the Stay track | Unconfirmed | Effectiveness | 3 | Medium | |
| B24 | Every course link real and live; others say "no course listed yet" | 30 real courses | Effectiveness | 2 | Low | |
| **Features** | | | | | | |
| B5 | Skills radar: rising and falling skills for her field, with source and date | No separate view | Effectiveness (must-have 2) | 4 | Medium | |
| B6 | SDG tag with a one-line reason on every skill | Jobs only | Effectiveness (must-have 5) | 3 | Medium | |
| B10 | Accessibility: axe-core zero errors on five views, keyboard journey, focus ring, labels, List view for the map, AA contrast | 134 aria attributes, reduced motion; no audit | UI/UX | 6 | Medium | |
| B17 | Module-boundary check in CI; diagram matches folders | Modular, not enforced | Architecture | 3 | Medium | |
| B11 | Works on a 375 px phone and slow connections | 980 px breakpoint; untested | UI/UX | 3 | Medium | |
| B8 | HR team skills-gap heatmap (opt-in only) | HR views exist, no heatmap | Effectiveness | 4 | Medium | |
| B7 | SDG contribution view for a person and a team | Not built | Effectiveness | 3 | Low | |
| B9 | Chinese interface, checked by a native speaker | English and BM | UI/UX | 3 | Low | |

**Freeze rule:** anything not working on the frozen build by `[freeze time]` falls back to its "If not built" line. Never demo a half-built feature.

---

## 7. Q&A prep

**Offer when it fits:** *"Name any job and we'll plan the route now."* Only after B25.

| Question | Short answer |
|---|---|
| Why not just ask ChatGPT? | ChatGPT gives a different answer each time and can't show where a number came from. Ours come from the official skill list, a model we trained and tested, and 1,000 simulated futures, all calculated by plain code. |
| What does "AI can do 84% of this work" mean? | Our model's exposure score for that skill: how much of the work behind it AI can do, based on expert ratings of the tasks. A score, not a measurement of a real workplace. |
| What is 0.92? | `[check: Pearson or Spearman]` correlation with expert ratings on 185 jobs held out from training. 1 means it agrees perfectly. |
| You beat a simple baseline by only 0.04. Why train a model? | `[team answer]` |
| "Expert" ratings were partly GPT-made, and they're US tasks. | `[team answer: what Eloundou's labels are; why tasks transfer; 0.79 vs the ILO index, which we never trained on]` |
| Why the EU list for Malaysia, not MASCO? | It's the largest open skill list with skills linked to every job. Wages, employment and shortage jobs are Malaysian (DOSM, MyCOL); a MASCO mapping is next. `[check: any MASCO mapping exists]` |
| The three agents are the same AI with three prompts. Aren't they dependent? | Different roles, and two different models (Gemini 3.5 and 3.1 Flash-Lite) `[check]`. The word-for-word quote check isn't AI at all. And on 40 signals labelled by hand they agreed with us `{measure}` times. |
| Your 1,000 futures come from your own assumptions. | Yes: it's a sensitivity test, not a probability. It shows which assumption breaks the plan (AI speed, study time, step length) so the person can fix it. Seeded, so the same plan gives the same answer within ±2 points. |
| Could HR use this to pick who to retrench? | HR sees progress only for workers who opt in, as team totals and progress, not individual AI-exposure scores `[check what the HR view shows]`. The worker controls sharing. |
| Fairness: what about proxies like school name or graduation year? | We remove direct details and test that the AI sees identical text. Proxies like school or graduation year are the next test; we haven't measured them yet. |
| Is the signal in the demo staged? | The vote ran live on the server earlier today; we pre-loaded it so the demo fits in time. The reviewer's queue shows its log. |
| Is 99.4% / 154 of 155 measured on the same CVs you fixed against? | The first blind run removed 128 of 155. We fixed the misses and re-ran. `{B19 result}` on 20 new CVs. |
| How can someone become an `[target job]` in `{measure}` weeks? | It's job-ready for the skills gap, at 6 hours a week; course hours are real where we have them and labelled estimates elsewhere. `[make sure the demo target makes this believable]` |
| When no course exists, what do you show? | "No course listed yet", never an invented course. |
| Where does "Demand rising" come from? | MyCOL shortage list for those jobs, with its date; elsewhere the app labels it sample data. |
| Why is a nurse's match to her own job only about 30%? | The official list has about 60 skills per job and a CV names about 16. Next: weight skills by importance (B4). |
| How do you know someone learned the skill? | Proof names who vouches: our skill check, an advisor, or a certificate shown as a credential. We never call a certificate verified. |
| What if Gemini or RunPod goes down? | Keyword matching for CVs, local model for embeddings, questions work without AI. The screen says when a fallback runs. |
| Is the vote accurate? | We quote only the replay: `{measure}` of 40 against our hand labels, with the sample size. |
| Who adopts it first? | `[B27 pilot plan]` |
| What did you build in the 24 hours? | `[fill on 1 Nov from section 6]` |
| Can everyone explain the code? | Yes. `[assign each module on slide 9 to a teammate]` |

---

## 8. Don't say

- "GPS", "like Google Maps", "like Waze".
- "Experts agree on" about ESCO; say "the EU's official list".
- "Verified" about any proof; say "skill check", "confirmed by advisor", "show credential".
- "Scrape"; say "agents read news from trusted sites".
- "Ensures your plan works"; say "tests your plan".
- "99.4% in our blind test"; say "after fixes, 154 of 155", or the B19 result.
- "Every step has a real course"; say "ways to learn".
- "The AI is fair"; say "the AI receives identical text".
- "Interests", unless the questions ask about them.
- That the vote is "accurate", or any figure beyond the replay with its sample size.
- "Monitored" or "84% coverage" before B15 and B14 are real.
- Other teams' names. Any number not on this page or in the app.

---

## 9. Appendix slides (Q&A only)

| # | Headline | Content |
|---|---|---|
| A1 | CV reading by CV type | Clean, LinkedIn, messy: job right 100 / 92 / 100%, privacy 100 / 100 / 98%. Known gaps: "SQL Accounting" read as SQL in 5 CVs; 1 of 155 details leaked on a two-column CV |
| A2 | Questions accuracy by sector | All 10 sectors, top-3 rate each `{measure}` |
| A3 | How the exposure model is built | 19,265 expert-rated tasks → bge-m3 embeddings on RunPod → model learns ratings → scores all 13,939 skills; test jobs held out |
| A4 | Priya's route in 1,000 futures | 1,000-square grid; Steady vs Fast; what's varied (AI speed, study hours 0.5× to 1.5×, step length ±20%, model error); "When it fails"; seeded, ±2 points; tests a plan, does not predict hiring |
| A5 | Learn, practise, prove | Proof labels and who vouches; skills record; weekly check-ins; 30 real courses, others estimated |
| A6 | Bridges between fields | 27,031 proposed from shared work activities; about 1 in 4 wrong in a spot check, so a person approves each |
| A7 | How a signal becomes a route change | Collect → dated claim with quote → quote matched on page → three-agent vote → applied, person, or rejected → affected workers choose |
| A8 | One decision's full trace | Audit-log entry: signal, quote, each agent's vote and reason, result, undo |
| A9 | Vote replay | `eval/VOTES.md`: 40 signals, agreement, confusion table |
| A10 | Every fallback | Gemini down → keyword matching; RunPod cold → local model; no course → "no course listed yet" |
| A11 | Limits we measured | Nurse matches own job at about 30%; task evidence is US data; most study times estimated; questions about 70% for trades; proxies not yet tested. Each with its next step |
| A12 | Employers and advisors | HR team view (opt-in), advisor confirms a skill |
| A13 | Pricing and market | Free personal, RM 9.90 Plus, RM 25 per seat a month Enterprise; break-even 998 seats (assumption) |
| A14 | AI declaration | Gemini 3.5 Flash-Lite, Gemini 3.1 Flash-Lite, bge-m3 on RunPod Serverless, exposure model on a RunPod GPU pod, AI coding assistants `[check against the tech declaration]` |
| A15 | Sources | Every source behind every number |

---

## 10. Evidence judges can check (goes in the Final Solution Report and README)

| Evidence | Where | Shows | Status |
|---|---|---|---|
| Live app | live URL | The demo journey; sample login for judges | B26 |
| Source code | github.com/shenenleow10521/SdcHackathon, committee added | Module folders matching slide 9 | Ready |
| CI | GitHub Actions, badge in README | Typecheck, tests on Node 22 and 24, coverage, boundary check | Tests Ready; B14, B17 |
| Status page | uptime monitor public page | 5-minute checks of `/api/health` | B15 |
| Health endpoint | `/api/health` | Database, AI model, embeddings, scheduler | Ready |
| Evaluation files | `eval/` | CV test, vote replay, fairness, accessibility, usability | B18, B19, B20, B10, B12 |
| Final Solution Report | sdchack.my | Feature checklist vs the six must-haves, architecture, fallback table, every number with its date | To write |
| Backup video | YouTube | Demo on the final build | B28 |
