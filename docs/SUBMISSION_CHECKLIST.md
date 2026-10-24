# Submission checklist and rubric audit

Prelim deadline: **Sun 25 Oct 2026, 07:59:59 MYT.** No late submissions, no changes afterwards, the repo is frozen. Audit made on 24 Oct 2026, 04:30 MYT, against the orientation slides (19 Oct) and the organisers' README and declaration templates.

## Only the team can do these (in order)

| # | To do | Where it goes |
|---|---|---|
| 1 | **Deploy on Replit** from the team's own account (steps in [`submission/REPLIT_PROOF.md`](../submission/REPLIT_PROOF.md)); set `ADMIN_TOKEN`; open `/app` and `/api/health` in an incognito window and upload `demo/priya-cv.pdf` once | README Links table: **Live demo URL** and **Replit project URL**; `submission/REPLIT_PROOF.md` |
| 2 | **Replit proof screenshots** (project with history, deployment running, live page) → export as PDF | `submission/` |
| 3 | **RunPod console screenshots**: pod `38jijj8fe5dazu` in billing/usage history, endpoint `a7ipau1nmqogxs` with requests, billing total; plus, only if it exists, an organiser message confirming local GPU testing is allowed (if not, ask on Discord first: early test runs used a local GPU, the final training run used RunPod) → export as PDF | `submission/RUNPOD_PROOF.md` placeholders |
| 4 | **Team name, leader, university, members, roles, GitHub usernames** | README (Team information, Team), `submission/PRELIMINARY_PROPOSAL.md`, `submission/TECH_DECLARATION.md` |
| 5 | **PRD on the official Submission Template**: copy from `submission/PRELIMINARY_PROPOSAL.md`, fill _[verify]_ baseline figures from their sources, confirm the workshop and IP boxes, sign, save PDF | `submission/` + README link |
| 6 | **Tech & Tools Declaration on the official template**: copy from `submission/TECH_DECLARATION.md`, add any other AI tool a member used, sign, save PDF | `submission/` + README link |
| 7 | **Record the pitch video** (5:00–7:00, live demo inside; script `docs/PITCH.md`, clicks `docs/DEMO.md`), upload to YouTube (public or unlisted) | README Links: **Pitch video** |
| 8 | **Pitch deck** matching the video (problem, solution, technical approach, impact) | README Links: **Slide deck**; `submission/HalaTuju_Pitch_Deck.html` (export a PDF copy too) |
| 9 | **Add the committee's GitHub accounts as collaborators** (usernames from Discord) | GitHub → Settings → Collaborators |
| 10 | **Confirm on Discord** the "API Premium sponsor technology" checkbox on the submit form (which sponsor? we use Replit and RunPod) | Submit form |
| 11 | **Make the repo public**, then submit the GitHub URL on sdchack.my and **open every link in an incognito window** | sdchack.my portal |
| 12 | **No commits after 07:59:59 MYT on 25 Oct** | — |

## Judging criteria

Score estimates are our own judgement (out of 10), assuming items 1–8 above are done. Without a working live link, Feasibility drops sharply, because the most important feature must run live.

| Criterion (weight) | What judges look for | Our evidence | Status | Estimate |
|---|---|---|---|---|
| **Innovation & Creativity (30%)** | Sharply framed problem, original approach, not a re-skinned chatbot | The visible reroute after a person approves a market change (README "What only HalaTuju does" #1); self-trained exposure model with baselines (#2, `ml/artifacts/eval.json`); 1,000-future stress test (#4, `shared/engine.js`); emerging-skill committee checked against all of ESCO (`eval/EMERGING.md`). AI reads and explains, formulas set numbers | ✅ | 8.5 |
| **Problem-Solution Fit (25%)** | Whole domain chain covered, all six must-haves explained, humans in control | README "Domain 1 must-haves" table (all six, with where); one persona with three questions; human approval for anything that reroutes, keep-or-switch, advisor approval; ESCO 3,039 jobs + DOSM + MyCOL for Malaysian fit | ✅ | 9 |
| **Feasibility of Build (25%)** | Most important feature shown live, backed by GitHub, hardest risk and fallback | README "Hardest risk and our fallback"; 419 tests + CI; benchmarks with held-out sets (`eval/RESULTS.md`, `eval/EMERGING.md`); RunPod training log; demo kit (`demo/`, `docs/DEMO.md`). **Live URL not deployed yet** | ⚠️ | 8 if live, 4 if not |
| **Clarity of Proposal (20%)** | Problem → approach → expected outcome; easy to explain back; follows format and length limits | README follows the organisers' template order (team, links, overview, stack, structure, how to run, Replit, RunPod, challenges, team, checklist, licence) with a scannable differentiator table; PRD draft on the template's word limits; pitch script 5:50. The README is long; the top table carries the story | ⚠️ (deck and video to make) | 7.5 |
| **Weighted estimate** | | | | **≈ 83 / 100** if live (≈ 69 if not) |

## Compulsory items

| Item | Requirement | Evidence | Status |
|---|---|---|---|
| Working prototype + functional UI + pitch | All three, or the submission is incomplete | App in `server/`, `web/`; pitch in `docs/PITCH.md` | ⚠️ pitch video and deck to record |
| 1. Product Requirement Doc | Official template: problem, SDG, users, scope, features | [`submission/PRELIMINARY_PROPOSAL.md`](../submission/PRELIMINARY_PROPOSAL.md) (draft in template order); earlier `proposal/HalaTuju_Proposal.md` | ⚠️ copy into the official template, fill brackets, PDF |
| 2. Pitch deck | Matches the video | — | ❌ team |
| 3. Live prototype link | Deployed link; a video or mock-up does not count | https://halatuju.replit.app (Reserved VM, Replit PostgreSQL 16) | ⚠️ deployed; check in incognito |
| 4. Tech & Tools Declaration | Every API, cloud service, AI tool, LLM, dataset, model, sponsor resource; Replit proof; RunPod proof for GPU work | [`submission/TECH_DECLARATION.md`](../submission/TECH_DECLARATION.md), [`submission/RUNPOD_PROOF.md`](../submission/RUNPOD_PROOF.md), [`submission/REPLIT_PROOF.md`](../submission/REPLIT_PROOF.md) | ⚠️ screenshots, Replit URL, signature |
| 5. GitHub repository | Public; reflects what you demo | https://github.com/shenenleow10521/SdcHackathon | ⚠️ still private |
| 6. Pitching video | 5:00–7:00 on YouTube, with a prototype demo; −1 point per 30 s over | Script 5:50 (`docs/PITCH.md`) | ❌ record |
| Replit (compulsory) | Proof from our own account | Deployed at https://halatuju.replit.app | ⚠️ screenshots |
| RunPod (GPU work) | Screenshot: pod ID or endpoint, GPU type, runtime | Pod `38jijj8fe5dazu` RTX 4090 2.5 min (`ml/artifacts/runpod_run.json`, `.log`); endpoint `a7ipau1nmqogxs` | ⚠️ console screenshots |
| Repo created after 19 Oct release | — | First commit 23 Oct 2026 00:58 MYT | ✅ |
| Apache License 2.0 | `LICENSE` at root | [`LICENSE`](../LICENSE) | ✅ |
| Committee accounts as collaborators | Usernames from Discord | — | ❌ team |
| Genuine commit history | One giant last-minute commit gets reviewed | 30+ commits from 23 Oct; work committed in batches. README "Build log" lists dated evidence (proposal 22 Oct, eval result files from 23 Oct 14:04, RunPod log, CI runs). Keep committing in small real steps until the freeze | ⚠️ batches |
| No exposed keys or passwords | Code and history | Pattern scan of tracked files and full history on 24 Oct (Gemini, RunPod, OpenAI-style, Tavily, JWT, Postgres URLs with passwords): only false positives in news URLs. `.env` is git-ignored; `.env.example` has no values | ✅ |
| Public, open or synthetic data only; sources credited | No real personal data | Synthetic CVs and persona; sources and licences in README, `docs/DATA_SOURCES.md`, `ml/SOURCES.md` | ✅ |
| Declare every model; don't invent facts | — | Declaration §4; agents output database IDs only; fact checker; quotes checked word for word | ✅ |
| Humans in charge | — | Approval for route-changing knowledge changes, advisor approval, keep-or-switch | ✅ |
| At least one SDG | — | SDG 8 primary; every job and skill tagged (test-checked) | ✅ |
| All six Domain 1 must-haves | — | README "Domain 1 must-haves" | ✅ |
| Hardest risk + fallback | Part of Feasibility | README "Hardest risk and our fallback" | ✅ |
| AI usage declared, team can explain every feature | Undeclared use = deductions; unexplainable work is flagged | Declaration §4.3 discloses Claude Code (extensive), Claude agents (benchmark), Gemini, faster-whisper | ⚠️ every member should rehearse the Q&A in `docs/PITCH.md` |
| Sponsor checkbox on the submit form | "Our project integrates our API Premium sponsor's technology" | Replit + RunPod in use | ⚠️ confirm which sponsor on Discord |

## Repository hygiene (checked 24 Oct 2026)

- `LICENSE` (Apache 2.0) at the root.
- `.gitignore` keeps out `.env`, `data/`, `competitors/`, organiser materials (`*.zip`, `extracted/`) and logs (the two cited logs are added explicitly).
- All relative links and paths in `README.md`, `submission/*.md` and this file resolve (scripted check).
- `npx vitest run`: **419 passed** (24 files). CI runs on Node 22 and 24; the PDF reader needs Node 22, so `.replit` now uses `nodejs-22` (on Node 20 every PDF upload failed).
