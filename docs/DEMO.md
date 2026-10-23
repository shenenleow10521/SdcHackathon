# HalaTuju: live demo script

> **Length:** 3:40 for the core run, 4:00 with the optional keep-or-switch beat.
> **Persona:** Priya Nair, the same sample persona as the landing page, README and pitch, with a crafted CV: [`demo/priya-cv.pdf`](../demo/priya-cv.pdf) (paste fallback: [`demo/priya-cv.txt`](../demo/priya-cv.txt)). Fictional person, fictional employers, fake contact details.
> **Numbers:** every number below was measured in a dry run on a fresh demo database on 24 Oct 2026 (API plus the shared engine the browser uses). Numbers marked _[read]_ depend on the day; read them off the screen. The dry run drove the API, not a browser (the browser extension wasn't connected), so rehearse the clicks once before going live.

---

## Why this CV

Priya's CV upload produces the same story the pitch tells, so the live upload and the landing page agree. The crafted CV adds what the seeded persona can't show:

- **Messy, real-looking details for the scrubber to remove:** phone, email, LinkedIn link, home address, IC number, date of birth, and a "Female · Indian · Married" line. All of it is fake (`+60 12-000 0000`, `priya.sample@example.com`, `000000-07-0000`). The scrubber removed all 7 kinds in every run.
- **11 skills, 2 of them fading fast:** invoice data entry (84% AI exposure today) and three-way matching (74%), plus payment runs (64%).
- **One skill below the line:** Power BI is "learning on my own, one pilot dashboard", so it lands at level 2. A skill counts as yours at level 3, so it shows as partial credit and a level-up step.
- **A clear current job:** "Senior Accounts Payable Executive" maps to Accounts Payable Clerk with high confidence.

What it does not show: the "listed only" tag. Skills that appear only in the Skills section (Python, the SAP/Excel list) are never read as phrases by the current CV reader, so no skill gets the listed-only cap. See [Known issues](#known-issues).

---

## Measured results (dry run, 24 Oct 2026)

| Step | Result | Time |
|---|---|---|
| Server boot | Seeds (fresh database) and listens | under 30 s (not timed precisely) |
| `demo/prime.sh` (wake RunPod + replay Job Market Researcher run) | Embedder warm; 8 changes waiting for review | 7 s |
| CV upload, PDF | 11 skills, 28 ESCO skills, current job Accounts Payable Clerk (high), 7 kinds of personal detail removed, 1 question | 13.9 s |
| CV paste, text (6 runs) | 10 to 11 skills (11 in the final CV), 23 to 29 ESCO skills, same job, same question | 8.0 to 17.2 s, typically 9 to 10 s |
| Follow-up question | "Have you done Strategic sourcing (for example: compare supplier quotes)?" | instant |
| Skills that count as yours (level 3+) | 10 of 11 (Power BI at level 2) | |
| Skills safe from AI | 64% in 2026, 55% in 2027, 45% in 2030 (Moderate AI) | |
| Skills AI takes over (Moderate AI) | Invoice data entry 2027, three-way matching 2028, payment runs 2030 | |
| Map jobs (Balanced) | Finance Automation Specialist 76%, 5 wk · AI-Assisted AP Specialist 85%, 3 wk · Internal Auditor 80%, 5 wk · BI Developer 77%, 3 wk. ESG & Carbon Reporting Analyst (57%, 7 wk) and Procurement Specialist (76%, 4 wk) are no longer in the default four since requirement weights come from ESCO; ESG is under the **Sustainability** sector. Not yet re-measured from a CV upload: computed with the engine for the CV's skill levels | instant |
| ESG route options (core weeks at 6 h/week) | Fastest 6 wk (reconciliation → GHG emissions accounting) · Balanced 7 wk (audit trail → sustainability disclosure) · Safest 10 wk | |
| ESG, Fastest, job-ready | 11 weeks; deadline 24 Apr 2027 gives 26 weeks, so **Ahead**, ready by about 8 Jan 2027 _[read]_; course cost RM 0 (free courses) | |
| Next up | GHG emissions accounting · course "Corporate Standard Training Webinar" · 4-question skill check | 0.2 s |
| Stress test, ESG Fastest | **Works in 18 of 18 futures** (Safest route: 12 of 18, fails 6 times on the deadline at a slower study pace) | instant |
| Approve the Microsoft signal (#6) | Knowledge base v1 → v2 in 0.1 s. In the **2030** view the ESG route reroutes: reconciliation → GHG (6 wk) becomes audit trail → sustainability disclosure (7 wk, job-ready 12); match 57% → 51% | 0.1 s |
| Same approval, 2026 view | No route change (a +5 point change is small today) | |
| Optional: approve sample signal #1 at 2026 | Fastest route reroutes at 2026 too; the saved plan gets "keep or switch" | 0.3 s |

---

## Pre-demo checklist

**30 minutes before**
1. Laptop on power, notifications off, one browser window, other tabs closed.
2. In Git Bash, from the repo root: stop any old demo server (port 4330), then
   ```bash
   bash demo/reset.sh
   bash demo/start.sh          # leave this window open
   ```
   Wait for `HalaTuju on http://localhost:4330 ... embed=runpod-bge-m3 demo=false`. If it says `embed=gemini` or `embed=none`, the RunPod key or endpoint id is missing from `.env`; ESCO skills will then be skipped silently.
3. In a second Git Bash window: `bash demo/prime.sh`. Expect `embed warm-up: HTTP 200` and `replay: HTTP 200`.
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
| 1 | 0:00 to 0:20 | Nothing. Setup card is open over the dark map. | "This is Priya. Eleven years in accounts payable at a shared-services centre in Penang. Her company is moving invoice matching to AI agents next year. Anyone who moves into a new role within six months is redeployed. She has six hours a week to learn." | "Step 1 of 3 · Start with what you've already done". Upload PDF / Paste text. |
| 2 | 0:20 to 0:50 | **Upload PDF** → choose `priya-cv.pdf` → **Read my profile**. | (during the 10 to 15 s wait) "She uploads her CV. Before any AI reads it, HalaTuju strips her phone, email, address, IC number and personal details. Then it matches what she has done against 13,939 skills in the EU's official ESCO list." | Stage text: Extracting the text → Removing personal details → Matching your skills to ESCO → Preparing follow-up questions. |
| 3 | 0:50 to 1:10 | Point at the summary. | "Fifteen seconds. Her current job: accounts payable clerk. 11 skills from our map, each with the CV line that proves it, and 28 ESCO skills on top. Seven kinds of personal detail removed before any AI saw them." | "Closest job: Accounts Payable Clerk", "11 skills matched to our skill list", "Removed before any AI saw it: …", "Also from your CV: 28 ESCO skills (of 13,939)" _[read: 23 to 29]_. |
| 4 | 1:10 to 1:25 | **Continue** → question "Strategic sourcing" → **0 · Not yet** → **Continue**. Levels screen: leave them. Goals: hours **6**, target date **six months from today** (24 Apr 2027 on 24 Oct), budget **1500** → **Build my career map**. | "One honest question where the CV is unclear. Then her goals: six hours a week, six months, RM 1,500." | Toast "Your career map is ready · _[read]_ jobs on your map. Best match: …". |
| 5 | 1:25 to 1:50 | Map. Press **play** on the year slider (or drag 2026 → 2030), then drag back to **2026**. | "Here is her map: her skills on the inner ring, jobs on the outer ring. Today 64% of her skills are safe from AI. Watch the years: invoice entry closes in 2027, three-way matching in 2028, payment runs in 2030. By 2030 only 45% are safe." | Header "Skills safe from AI in 2026: 64%". Skills turn into closed roads year by year. |
| 6 | 1:50 to 2:15 | **Explore** tab: point at the four job cards. Click **ESG & Carbon Reporting Analyst** → **Set as my goal**. | "Four jobs fit her today. AI-assisted AP at 85%, finance automation at 76%. She picks ESG and carbon reporting at 57%: eleven years of reconciling accounts carry straight into carbon accounting, and AI exposure on that job is low." | Cards with match % and weeks. Toast "Goal set: ESG & Carbon Reporting Analyst", then "Plan saved". |
| 7 | 2:15 to 2:45 | **My goal** tab. Point at the route rows (Fastest is selected), then **Next up**, click **Take the skill check**, show the 4 questions, close it **without submitting**. Scroll to **How sturdy is this plan?** | "Like a GPS, three routes: fastest 6 weeks, balanced 7, safest 10. Fastest reuses her reconciliation and adds GHG emissions accounting, job-ready in 11 weeks, 15 weeks before her deadline, on free courses. Next up: a free GHG Protocol course and a four-question check. And we test the plan in 18 possible futures: slow AI, fast AI, a busy month at half pace. It holds in 18 of 18." | Route rows, numbered stops, "Next up: GHG emissions accounting", deadline "Ahead", "Works in 18 of 18 futures". |
| 8 | 2:45 to 3:30 | Drag the year to **2030**. Click **Review** (top bar) → in "Needs your review", find **Vendor reconciliation · Microsoft named a Leader in the 2026 Gartner Magic Quadrant for Cloud ERP Finance** (signal #6, source microsoft.com, 22 Oct 2026, "Replayed") → **Approve and apply** → back to **User view** if it doesn't switch by itself. | "AI moves every week. Job Market Researcher reads approved sources every day and flagged 5 changes for a person. This one is from Microsoft, 22 October: its Account Reconciliation Agent finds exceptions between ledgers on its own. The quote was checked word for word on the page. One click to approve. Watch her map: in 2030 reconciliation closes, and her route reroutes through audit trail and sustainability disclosure. Seven weeks instead of six, with the source and date attached." | "Rerouting…" overlay, camera flies to Vendor reconciliation, old route fades. Toast "Route updated: ESG & Carbon Reporting Analyst · Was: Vendor reconciliation → GHG emissions accounting. Now: Audit trail documentation → Sustainability disclosure (7 wk)" with the Microsoft link. Match 51%. |
| 9 (optional) | 3:30 to 3:50 | Drag back to **2026**. **Review** → **Vendor reconciliation · Sample product announcement** (signal #1, labelled Sample) → **Approve and apply**. | "A bigger change, labelled sample: agents that close the month-end books. This one changes her route today, so her saved plan asks her: keep my route, or switch." Click **Switch to the new route**. | Toast "Route updated", prompt "Your saved plan to ESG & Carbon Reporting Analyst can change" with **Switch to the new route** / **Keep my route**; then "Switched to the new route". |
| 10 | 3:50 to 4:00 | Click the Microsoft source link in the panel or leave the map on screen. | "Every number on this screen names its source. HalaTuju: when AI closes a road, it reroutes you." | Map with the new route lit. |

**Cut order if you are over time:** step 9 first, then the skill-check click in step 7, then the year playback in step 5 (say the three years instead).

---

## Fallbacks

| Risk | Sign | Fallback |
|---|---|---|
| RunPod cold | Upload takes over 30 s, or `embed: lastError` in `/api/health` | Run `bash demo/prime.sh` 10 minutes before. On stage: keep talking through step 2; if still slow at 45 s, use the paste path or the persona (next rows) |
| CV reading fails or AI quota | Error box in the setup card, or "AI is off right now, so fixed rules read your CV" | **Paste text**: open `demo/priya-cv.txt`, copy all, paste, **Read my profile**. If that also fails: **Use the sample persona** (Priya, profile 1, read-only). ESG 57% (its job list differs a little: Internal Auditor and AI Data Quality Specialist instead of BI Developer), same Fastest route through reconciliation, same reroute in step 8. Say "here is her profile from this morning" |
| PDF picker trouble | File dialog lost behind the browser | Paste path as above |
| Different numbers after upload | AI reading varies a little between runs (PDF and paste gave audit trail 4 or 5, 23 to 29 ESCO skills) | Read the numbers off the screen; the job list, the 57% ESG match and the route were the same in every run |
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
Then reset the browser (console snippet above). A clean, primed queue has 8 changes waiting: #10 Financial analysis (arXiv), #9 Supply chain planning, #8 AI invoice review, #7 Invoice data entry, **#6 Vendor reconciliation (Microsoft, real)**, #3 SST compliance (Sample), #2 Payment runs (Sample), #1 Vendor reconciliation (Sample).

To regenerate the PDF after editing the CV text: `python demo/make-cv-pdf.py` (needs reportlab).

---

## Known issues

| Issue | Effect on the demo | Where |
|---|---|---|
| The CV reader's first pass lists only experience lines, so skills that appear only in the Skills section are never matched and the "listed only" cap (level 2, "not sure") never fires. 6 of 6 runs on this CV: 0 listed-only skills, 0 listed-only ESCO skills | The listed-only tag can't be shown live | `server/agents/cv.ts`, `SPLIT_SYSTEM` prompt (around line 50) vs the cap at around line 202 |
| ESCO "best matches across 3,039 jobs" for this profile tops out at 23% and includes odd picks (bookmaker 15%, ICT test analyst 22%) | Don't open the ESCO best-match list on stage; use **Check any job** with "accountant" as in the pitch | `server/routes/esco-network.ts` (`/esco/profile/:id/best-jobs`) |
| "Keep or switch" is computed at the 2026 Moderate view only, so the real Microsoft change (+5 points) never triggers it; only the bigger sample change does | Step 9 uses a Sample-labelled change | `server/services/rescore.ts`, `VIEW` constant (by design) |
| Passing a skill check saves that skill at level 1 "verified", which makes it a route start | Taking the GHG check before step 8 removes the reroute | `server/agents/checks.ts` around line 87 (by design) |
