# HalaTuju: live demo script

> **Length:** 3:40 for the core run, 4:00 with the optional keep-or-switch beat.
> **Persona:** Priya Nair, the same sample persona as the landing page, README and pitch, with a crafted CV: [`demo/priya-cv.pdf`](../demo/priya-cv.pdf) (paste fallback: [`demo/priya-cv.txt`](../demo/priya-cv.txt)). Fictional person, fictional employers, fake contact details.
> **Numbers:** every number below was measured in the browser on a fresh demo database on 24 Oct 2026, by driving this script click by click in Chrome (1440 x 900) three times from a reset. Numbers marked _[read]_ depend on the day or vary a little between CV readings; read them off the screen.

---

## Why this CV

Priya's CV upload produces the same story the pitch tells, so the live upload and the landing page agree. The crafted CV adds what the seeded persona can't show:

- **Messy, real-looking details for the scrubber to remove:** phone, email, LinkedIn link, home address, IC number, date of birth, and a "Female · Indian · Married" line. All of it is fake (`+60 12-000 0000`, `priya.sample@example.com`, `000000-07-0000`). The scrubber removed all 7 kinds in every run.
- **12 skills, 3 of them fading fast:** invoice data entry, three-way matching and payment runs are the ones AI takes over by 2030. Python for data work is only in the Skills section, so it is marked "listed only" and asked about as a question.
- **One skill below the line:** Power BI is "learning on my own, one pilot dashboard", so it lands at level 2. A skill counts as yours at level 3, so it shows as partial credit and a level-up step.
- **A clear current job:** "Senior Accounts Payable Executive" maps to Accounts Payable Clerk with high confidence.

It also shows the "listed only" tag: ESCO skills read only from the Skills list (for example "use accounting systems", "business intelligence") carry it and are not saved to her profile.

---

## Measured results (browser, 24 Oct 2026)

| Step | Result | Time |
|---|---|---|
| Server boot (`demo/start.sh`) | Log line ends `db=pglite  ... embed=runpod-bge-m3  demo=false` | 4 to 5 s |
| `demo/prime.sh` | `embed warm-up: HTTP 200`, `replay: HTTP 200`; **8 changes and 2 new skills** waiting, so the **Review** badge shows **10** | 8 to 11 s warm; 37 s when RunPod was cold (warm-up alone 31 s) |
| CV upload, PDF (3 runs) | Closest job Accounts Payable Clerk (high confidence) in 3 of 3 runs on this database (an earlier run read AI-Assisted AP Specialist, medium; see Fallbacks); 12 skills; 25 to 32 ESCO skills; 7 kinds of personal detail removed; 3 questions | 15.2 to 15.7 s |
| Questions | Hours a week; how she rates "Python for data work"; "Have you done Strategic sourcing (for example: compare supplier quotes)?" (once "AI invoice review & exceptions" instead) | instant |
| Ready toast | "Your career map is ready. 4 jobs on your map. Best match: AI-Assisted AP Specialist (85%)." | |
| My skills, Moderate AI | 2026: "11 skills in 2026: 7 holding up, 1 changing, 3 at risk, 0 done by AI". 2030: "4 holding up, 2 changing, 2 at risk, 3 done by AI" (invoice data entry, payment runs, three-way matching) | |
| Skills that stay useful (My goal, ESG route) | 64% in 2026 (71% after the route); 45% in 2030 | |
| Explore, best four | AI-Assisted AP Specialist 85%, 4 wk; Internal Auditor 80%, 6 wk; BI Developer 77%, 7 wk; Finance Automation Specialist 76%, 7 wk | instant |
| Sustainability sector | ESG & Carbon Reporting Analyst 57%, 11 wk; ESG Assurance Associate 55%; Product Carbon Footprint Analyst 45%; Green Finance Analyst 45% | instant |
| ESG route options (core weeks at 6 h a week) | Fastest 6 wk, starts with GHG emissions accounting (Medium AI risk); Balanced 7 wk, starts with Sustainability disclosure; Safest 10 wk, starts with Supervising AI workflows | |
| ESG, Fastest | 11 wk to job-ready; route Vendor reconciliation (have, level 4) then GHG emissions accounting (4 wk); also Sustainability disclosure (3 wk) and ESG data management (2 wk) | |
| Deadline and cost (Cost, deadline and advisor) | **Ahead**, ready by 8 Jan 2027 _[read]_; target 24 Apr 2027: 26 weeks available, 11 needed; total RM 0 (free courses), within her RM 1,500 budget | |
| Next up | GHG emissions accounting, about 4 wk at 6 h a week; course "Corporate Standard Training Webinar" (GHG Protocol, free); 4-question check (labelled Sample) with a **Not now** button | |
| Stress test, ESG Fastest | "Your plan works in **99%** of 1,000 possible futures" in 2 runs, **100%** in 1 (it follows her exact skill levels from the CV reading) _[read]_ | instant |
| Approve the Microsoft signal (#6) in the 2030 view | Rerouted: Vendor reconciliation → GHG emissions accounting becomes Audit trail documentation → Sustainability disclosure (7 wk); job-ready 11 → 12 wk; match 57% → 51% in 2030 | 0.15 s |
| Optional: approve sample signal #1 at 2026 | Prompt "Your saved plan to ESG & Carbon Reporting Analyst can change", then "Switched to the new route" | about 0.3 s |
| Whole script, automated | Upload to keep-or-switch, every step above | 113 s |

---

## Pre-demo checklist

**30 minutes before**
1. Laptop on power, notifications off, one browser window, other tabs closed.
2. In Git Bash, from the repo root: stop any old demo server (port 4330), then
   ```bash
   bash demo/reset.sh
   bash demo/start.sh          # leave this window open
   ```
   Wait for `HalaTuju on http://localhost:4330  db=pglite ... embed=runpod-bge-m3  demo=false`. It must say `db=pglite`: `demo/start.sh` blanks `DATABASE_URL` so the demo never touches the real database; if you ever see `db=pg`, stop the server at once. If it says `embed=gemini` or `embed=none`, the RunPod key or endpoint id is missing from `.env`; ESCO skills will then be skipped silently.
3. In a second Git Bash window: `bash demo/prime.sh`. Expect `embed warm-up: HTTP 200` and `replay: HTTP 200`. Always stop the server before `demo/reset.sh`: wiping the folder under a running server leaves its old data in place.
4. Open `http://localhost:4330/app` in a fresh profile or after the browser reset below. Do not use port 3000: that is the dev server with its own database and accounts on.

**10 minutes before**
5. Run `bash demo/prime.sh` again. It only re-wakes RunPod (the replay is skipped once done). A RunPod worker scales to zero when idle and takes about a minute to start cold.
6. Browser zoom 110% on a 1080p screen (map plus panel both readable), full screen (F11).
7. Have `demo/priya-cv.pdf` in an easy folder (Desktop) for the file picker.
8. Rehearse nothing else on this database: every rehearsal intake adds a profile and every approval changes the knowledge base. If you rehearsed, reset again.

**Demo server settings** (all set by `demo/start.sh`)

| Setting | Value | Effect |
|---|---|---|
| `PORT` | 4330 | Separate from the dev server on 3000 |
| `PGLITE_DIR` | `data/pglite-demo` | Own database; `demo/reset.sh` wipes only this |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | blank | Accounts off: no sign-in, anyone can upload a CV; the new profile is not linked to an account and is open to anyone who knows its id. The sample persona stays read-only. "Delete my data" and the account menu are hidden |
| `ADMIN_TOKEN` | blank | With accounts off and no token, staff screens are open: the **Review** button, the review queue, approve/reject, the advisor queue and the HR view work without a token. Fine on localhost; never expose this server to the internet. If you set a token instead, the Review screen asks for it once per browser session (Admin token field) |
| `EMBED_PROVIDER` | runpod | bge-m3 vectors; needed for the 13,939 ESCO skill matches |
| `SCOUT_SCHEDULE` | off | No surprise Job Market Researcher run 2 minutes after boot; the queue stays exactly as primed |

**Reset the browser** (on `http://localhost:4330`, DevTools console, F12):
```js
Object.keys(localStorage).filter(k => k.startsWith("halatuju.")).forEach(k => localStorage.removeItem(k));
sessionStorage.clear();
localStorage.setItem("halatuju.tourDone", "true");   // keeps the guided tour's spotlight out of the way
location.reload();
```
After the reload, `/app` opens the "Start with what you've already done" setup card. That is the starting screen.

---

## The script

Say "she", not "users". Let each screen land for a second before speaking.

| # | Time | Click | Say | On screen |
|---|---|---|---|---|
| 1 | 0:00 to 0:20 | Nothing. Setup card is open over the dark map. | "This is Priya. Eleven years in accounts payable at a shared-services centre in Penang. Her company is moving invoice matching to AI agents next year. Anyone who moves into a new role within six months is redeployed. She has six hours a week to learn." | "Step 1 of 3", "Start with what you've already done", **Upload file** / **Paste text**. |
| 2 | 0:20 to 0:50 | **Upload file** → choose `priya-cv.pdf` → **Read my profile**. | (during the 15 s wait) "She uploads her CV. Before any AI reads it, HalaTuju strips her phone, email, address, IC number and personal details. Then it matches what she has done against 13,939 skills in the EU's official ESCO list." | One progress list: Extracting the text → Removing personal details → Matching your skills to ESCO → Preparing follow-up questions. |
| 3 | 0:50 to 1:10 | Point at the summary. | "Fifteen seconds. Her current job: accounts payable clerk. Twelve skills from our map, and about thirty ESCO skills on top. Seven kinds of personal detail removed before any AI saw them." | "Closest job: Accounts Payable Clerk (high confidence)", "12 skills matched to our skill list", "Removed before any AI saw it: names, addresses, ID numbers, personal traits (such as gender, race or marital status), email addresses, profile links, phone numbers", "Also from your CV: 30 ESCO skills (of 13,939)" _[read: 25 to 32]_, some tagged "listed only". |
| 4 | 1:10 to 1:25 | **Continue** → 3 questions: **6 hours**, Python **0 · Not yet**, Strategic sourcing **0 · Not yet** → **Continue**. Levels screen: leave them; check **Your current job** reads Accounts Payable Clerk (change it if not). Goals: hours **6**, target date **24 Apr 2027**, budget **1500** → **Build my career map**. | "A few honest questions where the CV is unclear. Then her goals: six hours a week, six months, RM 1,500." | Toast "Your career map is ready. 4 jobs on your map. Best match: AI-Assisted AP Specialist (85%)." |
| 5 | 1:25 to 1:50 | **My skills** tab. Press **play** on the year slider (or drag 2026 → 2030), then drag back to **2026**. | "Here is her map: her skills on the inner ring, jobs on the outer ring. Today seven of her eleven skills hold up. Watch the years: by 2030 AI does invoice entry, three-way matching and payment runs, and only four skills still hold up." | "11 skills in 2026: 7 holding up, 1 changing, 3 at risk, 0 done by AI" changing to "… in 2030: 4 holding up, 2 changing, 2 at risk, 3 done by AI". Skills turn into closed roads year by year. |
| 6 | 1:50 to 2:20 | **Explore** tab: point at the four job cards. Open **Find other jobs** → click **Sustainability**. Click **ESG & Carbon Reporting Analyst** → **Set as my goal**. | "Four jobs fit her best today: AI-assisted AP at 85%, internal auditor at 80%. But Priya wants work that matters, so she looks at sustainability jobs. ESG and carbon reporting fits her at 57%: eleven years of reconciling accounts carry straight into carbon accounting." | Top four cards, then toast "Sustainability: 4 jobs on your map. Best fit: ESG & Carbon Reporting Analyst (57% match)." Route preview, then toast "Goal set: ESG & Carbon Reporting Analyst". |
| 7 | 2:15 to 2:45 | **My goal** tab. Hover the route rows (each previews on the map; Fastest is selected), then **Next up**, click **Take the skill check**, show the 4 questions, click **Not now**. Scroll to **How sturdy is this plan?** | "Like a GPS, three routes: fastest 6 weeks, balanced 7, safest 10. Fastest reuses her reconciliation and adds GHG emissions accounting: job-ready in 11 weeks, well before her deadline, on free courses. Next up: a free GHG Protocol course and a four-question check. And we test the plan in 1,000 possible futures: slow AI, fast AI, busy months, our AI estimates off by their measured error. Her plan works in 99% of them." | Route rows, numbered steps, "Next up: GHG emissions accounting", "Your plan works in 99% of 1,000 possible futures" _[read: 99 or 100]_. Optional: open **About this job** for **Find openings** (MYFutureJobs, JobStreet) and **Cost, deadline and advisor** for "Ahead, ready by 8 Jan 2027". |
| 8 | 2:45 to 3:30 | Drag the year to **2030**. Click **Review** (top bar, badge 10) → in "Needs your review", find the card **Microsoft named a Leader in the 2026 Gartner® Magic Quadrant™ for Cloud ERP Finance** whose line reads **Vendor reconciliation: AI exposure +5 points** (three Microsoft cards share that title; this is #6, "Live, 22 Oct 2026, 1 source") → **Approve and apply** → **User view**. | "AI moves every week. Job Market Researcher reads approved sources every day and flags big changes for a person. This one is from Microsoft, 22 October: its Account Reconciliation Agent finds exceptions between ledgers on its own. The quote was checked word for word on the page. One click to approve. Watch her map: in 2030 reconciliation closes, and her route goes through audit trail and sustainability disclosure instead. Seven weeks instead of six, with the source and date attached." | "Finding a new path…", camera flies to Vendor reconciliation ("New AI signal" badge), old route fades. Toast "Route updated: ESG & Carbon Reporting Analyst. Was: Vendor reconciliation → GHG emissions accounting. Now: Audit trail documentation → Sustainability disclosure (7 wk)." with the Microsoft link and date. My goal: 51% match, 12 wk. |
| 9 (optional) | 3:30 to 3:50 | Drag back to **2026**. **Review** → **AI agents now close the month-end books** (Vendor reconciliation, labelled Sample) → **Approve and apply**. | "A bigger change, labelled sample: agents that close the month-end books. This one changes her route today, so her saved plan asks her: keep my route, or switch." Click **Switch to the new route**. | Prompt "Your saved plan to ESG & Carbon Reporting Analyst can change" with **Switch to the new route** / **Keep my route**; then "Switched to the new route". |
| 10 | 3:50 to 4:00 | Click the Microsoft source link in the toast or leave the map on screen. | "Every number on this screen names its source. HalaTuju: when AI closes a road, it reroutes you." | Map with the new route lit. |

**Cut order if you are over time:** step 9 first, then the skill-check click in step 7, then the year playback in step 5 (say the three years instead).

---

## Fallbacks

| Risk | Sign | Fallback |
|---|---|---|
| RunPod cold | Upload takes over 30 s, or `embed: lastError` in `/api/health` | Run `bash demo/prime.sh` 10 minutes before. On stage: keep talking through step 2; if still slow at 45 s, use the paste path or the persona (next rows) |
| CV reading fails or AI quota | Error box in the setup card, or "AI is off right now, so fixed rules read your CV" | **Paste text**: open `demo/priya-cv.txt`, copy all, paste, **Read my profile**. If that also fails: **Use the sample persona** (Priya, profile 1, read-only). ESG 57% (its job list differs a little: Internal Auditor and AI Data Quality Specialist instead of BI Developer), same Fastest route through reconciliation, same reroute in step 8. Say "here is her profile from this morning" |
| PDF picker trouble | File dialog lost behind the browser | Paste path as above |
| Different numbers after upload | AI reading varies a little between runs (25 to 32 ESCO skills, the third question, 99 or 100% in the stress test) | Read the numbers off the screen; the job list, the 57% ESG match and the route were the same in every run |
| Wrong current job after upload | Summary says "Closest job: AI-Assisted AP Specialist (medium confidence)" (seen once in 4 uploads) | On the levels screen set **Your current job** to Accounts Payable Clerk before **Build my career map**; everything after matches the script |
| Review queue empty or #6 already approved | "Nothing waiting. Check the job market now…" | Click **Replay a recorded run (offline demo)** on the Job Market Researcher card (5 s, labelled "Replayed"), or run `bash demo/prime.sh`. If #6 was approved in a rehearsal, reset the database |
| Approve shows "Approved and applied · route unchanged" | The year slider was left at 2026 | Drag to 2030: the reroute appears in the 2030 view. Say "in 2030, reconciliation is closed and her route already goes around it" |
| No keep-or-switch prompt in step 9 | Plan not saved in step 6, or the slider wasn't at 2026 | Skip step 9; it is optional |
| Skill check passed by accident before step 8 | GHG becomes a skill she has, so reconciliation drops off the route and step 8 shows no reroute | Reset before going live. On stage: use the persona fallback for step 8 |
| Guided tour spotlight pops up | Dark overlay with a pointer 2 s after loading | Click its skip button; next time set `halatuju.tourDone` (browser reset above) |
| Port 4330 busy after stopping | `EADDRINUSE` on start | PowerShell: `Get-NetTCPConnection -LocalPort 4330 \| % { Stop-Process -Id $_.OwningProcess -Force }` |

---

## Reset to a clean state

```bash
# 1. stop the demo server (Ctrl+C in its window; check port 4330 is free)
bash demo/reset.sh     # wipes data/pglite-demo only
bash demo/start.sh     # reseeds on boot: persona, sample HR team, review queue, recorded Job Market Researcher run
bash demo/prime.sh     # second window: wakes RunPod, replays the recorded run into the queue
```
Then reset the browser (console snippet above). A clean, primed queue has 8 changes waiting: #10 Financial analysis (arXiv), #9 Supply chain planning, #8 AI invoice review, #7 Invoice data entry, **#6 Vendor reconciliation (Microsoft, real)**, #3 SST compliance (Sample), #2 Payment runs (Sample), #1 Vendor reconciliation (Sample), plus 2 new skills to confirm (Review badge 10).

To regenerate the PDF after editing the CV text: `python demo/make-cv-pdf.py` (needs reportlab).

---

## Known issues

| Issue | Effect on the demo | Where |
|---|---|---|
| The follow-up question options come from the server as "0 · Not yet", "1 · Beginner…" | The only dot-joined labels left on screen; harmless | `server/agents` (interviewer), not changed in this pass |
| The CV reader picked AI-Assisted AP Specialist as her current job once in 4 uploads | Fix it on the levels screen (**Your current job**) | `server/agents/cv.ts` (occupation pick) |
| ESCO "best matches across 3,039 jobs" for this profile tops out at 23% and includes odd picks (bookmaker 15%, ICT test analyst 22%) | Don't open the ESCO best-match list on stage; use **Check any job** with "accountant" as in the pitch | `server/routes/esco-network.ts` (`/esco/profile/:id/best-jobs`) |
| "Keep or switch" is computed at the 2026 Moderate view only, so the real Microsoft change (+5 points) never triggers it; only the bigger sample change does | Step 9 uses a Sample-labelled change | `server/services/rescore.ts`, `VIEW` constant (by design) |
| Passing a skill check saves that skill at level 1 "verified", which makes it a route start | Taking the GHG check before step 8 removes the reroute | `server/agents/checks.ts` around line 87 (by design) |
