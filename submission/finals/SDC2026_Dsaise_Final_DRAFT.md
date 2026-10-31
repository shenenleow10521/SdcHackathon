# SDC2026_Dsaise_Final: draft text for the official finalist template

Copy each block into the official **Phase 2: Final Project & Prototype Report** template, then save as `SDC2026_Dsaise_Final.pdf`.

- `{measure}` = a number still to be read off the final build. Never submit one.
- `[confirm]` = a fact the team must check.
- Word counts are given under each limited section.

---

## 1. Team & Project Overview

| Field | Value |
|---|---|
| Team Name | Dsaise |
| Project / Product Name | HalaTuju |
| Final Live Deployment URL | https://halatuju.replit.app |
| Codebase Repository URL | https://github.com/shenenleow10521/SdcHackathon |
| Name (Leader) | Leow Shen En |
| Email & phone (Leader) | leowshenen@gmail.com, 018-2335269 |

## 2. Project Description (max 250 words)

> HalaTuju shows a worker which of their skills AI is taking over, what to learn next, and whether their plan still holds as AI changes. A person uploads a CV, pastes text or answers a short task quiz. A privacy scrubber removes personal details before any AI model sees the text. The app then matches their experience against all 13,939 ESCO skills.
>
> Every skill gets an AI-exposure score from our own model, trained on human task ratings on a RunPod GPU. The worker sees three groups: skills at risk, skills AI assists, and skills that stay theirs. They can choose to stay and become AI-ready in their current job, or move. For a move, HalaTuju ranks roles from 3,039 ESCO occupations, explains each match score and its skills gap, and builds an ordered plan fitted to their weekly hours, using free or low-cost courses that were checked by hand.
>
> Every plan is replayed in 1,000 simulated futures and shown under Today and 2030 Slow, Steady and Fast AI adoption, labelled as estimates. Every job and skill carries an SDG tag with a reason. The plan view shows how the chosen path supports each goal.
>
> A researcher agent reads 74 trusted sites. Three AI agents vote on each new claim, and a person decides split votes. Users affected by an approved change choose to keep or switch their route. Fixed formulas, not the language model, set every score. HR teams see an opt-in team skills view.

_≈ 240 words._

## 3. Upgraded Product & Technical Execution

### 3.1 Final System Architecture

> **Browser app** (JavaScript, HTML/CSS, English and Bahasa Melayu): onboarding (CV, pasted text or task quiz), My skills, Explore (career map where distance is time to job-ready), Plan (route, futures chart, Today vs 2030 Slow/Steady/Fast), My goal (weekly check-ins, proof of each skill), and For HR (opt-in team progress).
>
> **API**: Node 22, TypeScript, Express 5, served from one Replit Reserved VM. Main modules:
> - *Profile intake*: local Tesseract OCR, privacy scrubber, then an LLM splits the CV into phrases. bge-m3 embeddings on RunPod Serverless find candidate ESCO skills, and a second LLM call confirms skills and the current job. The user confirms or removes each skill.
> - *Scoring engine* (`shared/engine.js`, shared by server and browser): fixed formulas for match score (skill overlap weighted by level and exposure), route time and RM cost, scenario shift, and the 1,000-future Monte Carlo stress test.
> - *ESCO services*: 3,039 occupations, 13,939 skills, 126,051 links, O*NET tasks with human exposure ratings, ILO WP140, DOSM wages and MyCOL flags. Routes can be built for any ESCO job, with cross-field bridges reviewed before use.
> - *Trend pipeline (Road Watch)*: a scheduled researcher searches 74 trusted domains (Tavily, RSS, arXiv, OpenAlex, GDELT). Quotes are checked word for word. Three voter agents on models from two vendors (evidence checker, skill matcher, sceptic) vote; 2–3 of 3 apply, 1 of 3 goes to a person, 0 is rejected. Every vote is logged. Approved changes create a new knowledge version (which can be undone), and affected users get a keep-or-switch notice.
> - *SDG mapping* (`shared/sdg.js`): hand-written reasons for catalogue items, a rule-based mapping for every ESCO job and skill, summed into the user's path contribution.
>
> **AI models**: `[confirm which ships]` KrackedDevs proxy (main gpt-5.5, reviewer DeepSeek-V4-Pro, voters gpt-5.5 / gpt-6-sol / DeepSeek-V4-Pro), with Google Gemini (gemini-3.5-flash-lite / gemini-3.1-flash-lite) as fallback; BAAI/bge-m3 on RunPod Serverless; our ridge exposure model trained on RunPod. LLMs only read text and explain. They return database IDs, never free-text jobs or courses.
>
> **Data**: Replit PostgreSQL 16 (profiles, versioned knowledge, signals, votes, goals, audit log). Sign-in: Replit-managed Clerk, with guest access. CI: GitHub Actions (type-check and {measure} automated tests).
>
> Diagram: attach `docs/system-diagram.png` `[update it for the vote panel, SDG module and HR view if time allows]`.

### 3.2 Implementation & Hackathon Deliverables (max 300 words)

> **What judges told us to fix, and what we changed.** The Phase 1 prototype answered "where can I move?" but users first ask "will AI take my job, and which of my skills?" We changed the order of the product to stay first, then move.
>
> **Built and deployed in the final round (30–31 Oct):**
> 1. *My skills outlook*: every confirmed skill sorted into at risk, AI-assisted and still yours, with one action per skill.
> 2. *Stay AI-ready track and My goal*: weekly check-ins, proof of each skill, a skills record, and opt-in team progress for HR.
> 3. *Routes for any ESCO job*: Phase 1 had routes for 16 sample jobs. Now any of 3,039 occupations works, with AI-era skills, cross-field bridges (reviewed before use), practice tasks and {measure} hand-checked learning links (every URL opened on 30 Oct).
> 4. *Map by time*: distance now means months to job-ready (3/6/12/24-month rings), and size means match.
> 5. *Three-agent vote*: one AI reviewer replaced by three voters on two vendors' models, with an audit log; split votes go to a person.
> 6. *Scenarios*: Today vs 2030 Slow/Steady/Fast side by side, driven by an adoption-speed parameter, with what shifts spelled out; a futures chart.
> 7. *SDG mapping for every ESCO job and skill*, with a reason, and the path contribution shown in Plan.
> 8. *No-CV task quiz* for thin profiles (4,017 O*NET tasks).
>
> **Problems we solved along the way:** Gemini free-tier quotas forced a second provider `[confirm KrackedDevs ships]`. Bridge suggestions between unrelated fields were sometimes wrong, so we added validation scripts and human review. A single reviewer could be fooled by vendor marketing, so we added a sceptic voter.
>
> Tests grew from 418 to {measure} (543 on 31 Oct, 11:30 MYT).

_≈ 290 words. Re-count after filling {measure}._

## 4. Environmental & SDG Impact Verification

Rule: Phase 1 pilot targets were **not** run. Say so plainly. Judges reward honest gaps and penalise inflated claims.

| Metric Category | Response |
|---|---|
| **Target SDG Metric Achievement** | SDG 8.5 and 4.4 (8.2 secondary). Against the Phase 1 KPIs: **(1) Current-job identification:** target 95% on a fresh blind set; result **97.2% (35/36)** on held-out synthetic CVs (95% CI 85.8–99.5). `[If a fresh blind set is run tonight, replace with that result.]` **(2) Personal details removed before AI calls:** target 99%; **99.4% (154/155)** after fixes, not blind (blind first run 82.6%). Fresh blind set: {measure} or "not yet run". **(3) Users finish a costed route within 60 s:** target 80%; result {measure} of {measure} testers, median {measure} s `[run a timed test with 5+ first-time users, or say "not measured"]`. **(4) Pilot participants with an advisor-approved plan:** target 70%; **not run**, because a consent-based pilot with real users was outside the hackathon window. **New in Phase 2:** coverage grew from 16 to 3,039 occupations with routes; {measure} of {measure} learning resources in a typical plan are free (HRD Corp-claimable: {measure}). |
| **Verification Evidence Method** | CV benchmark: `scripts/eval-cv.ts` over 50 synthetic CVs. Answer keys written by an independent annotator, and their sha256 is stored in each result file (`eval/results/cv-full-*.json`, `eval/RESULTS.md`). Skill precision was judged blind with decoys (`scripts/esco-judge.ts`). Vote replay: `scripts/eval-votes.ts` (`eval/VOTES.md`; only 1 human-decided signal so far, so it proves nothing about accuracy). Route timing: {measure: browser timing log or stopwatch sheet}. Every learning URL was opened and checked on 30 Oct (`db/seed/learning.json`). {measure} automated tests in CI. |
| **Socio-Economic / Civic Value** | Context: 1,360,100 Malaysian clerical wage recipients in 2025 (OpenDOSM), a group with high GenAI exposure (ILO WP140). First channels: university career centres and TVET providers (advisor approval flow), then HR teams (opt-in team view, keep-or-switch). A worker gets a sourced, costed plan in minutes instead of a one-off assessment that goes stale. SDG tags change choices: the ranking can favour roles that support the user's chosen goals. |
| **Deployment & Commercial Feasibility** | Free for individuals. Paid per-seat HR and career-centre dashboard. The engine can be called as an API by learning-management systems. Running cost: researcher run {measure} LLM calls/day ≈ RM {measure}/month; RunPod bge-m3 scales to zero (≈ US$ {measure} per 1,000 CVs); Replit Reserved VM ≈ US$ {measure}/month. Trend data refreshes daily (10 skills per run, all skills every 3 days). Privacy under PDPA: scrubbed before AI calls, CV files not stored, user can delete their profile. Fairness: `[run a check: same CV with name/gender/age changed gives the same ranking? report result, or say "planned"]`. |

### 4.1 Mathematical Proof / Code Logic Snippet (optional, bonus)

Pick the snippet that backs the strongest claim above. Suggested: the match score and scenario shift from `shared/engine.js`. Paste the real function, not a summary. Then add one line of real output, e.g.:

```
Persona: AP clerk, 6 h/week. Target: <job>.
Today:        match {measure}%, {measure} weeks, RM {measure}
2030 Fast AI: match {measure}%, {measure} weeks; top pick changes from <A> to <B>
1,000 futures: plan still job-ready by deadline in {measure}% of runs
```

Also usable: the vote rule (2–3 of 3 apply, 1 of 3 to a person, 0 reject) from `server/triage.ts`.

## 5. Market Viability & Future Scalability Plan (max 250 words)

> **Who first:** three Malaysian university career centres and two TVET providers in a consent-based pilot, then HR teams in shared-services centres (Penang, Klang Valley), where clerical and finance roles are most exposed.
>
> **Scaling the data:** the trend pipeline already runs on a schedule over 74 trusted domains. With funding we would add licensed Malaysian job-ad feeds and Bahasa Melayu news, and cover all ESCO skills each cycle instead of 10 per run. eMASCO/MASCO codes would sit beside ESCO so results match Malaysian statistics.
>
> **Scaling compute:** bge-m3 on RunPod Serverless scales from zero to many workers. Scoring runs in fixed formulas with no LLM call, so the cost per extra user is mostly storage. LLM calls happen once per CV and once per evidence check, not on every screen.
>
> **Trust at scale:** every model decision is logged. Human review stays on split votes and route-changing evidence. We would add a published fairness test each release and a PDPA-compliant data-retention policy reviewed by a partner's legal team.
>
> **Partners:** HRD Corp for claimable programmes; TalentCorp for MyCOL updates; Rotary and XMUM research links for pilot sites and an outcome study (did users reach an approved plan by their deadline?).
>
> **Business model:** free for individuals; per-seat licence for HR and career-centre dashboards; an API for learning-management systems.

_≈ 220 words._

## 6. Final Submission Checklist

Tick only what is true at submission time:

- [ ] Live and accessible at https://halatuju.replit.app (check in an incognito window after the last deploy)
- [ ] README has install instructions (it does; re-check after final edits)
- [ ] Commit history shows incremental updates in the hacking window (commit in small steps; avoid one big final commit)
- [ ] Final pitch deck exported as a flattened PDF
- [ ] All fields complete, word limits respected

## 7. IP & Originality Declaration

- **7.1 Pre-existing work:** No. `[confirm]` Prototype HTML files from before 22 Oct? The prelim answered No; if nothing changed, tick "No change from Phase 1 declaration".
- **7.2 Third-party code, datasets, models:** Yes. List (adds to Phase 1):

| Name | Type | License |
|---|---|---|
| Node.js, Express, TypeScript, Tesseract.js, pg, PGlite, 3d-force-graph, three.js, GSAP, Clerk SDK | Code | MIT / Apache-2.0 / BSD / GreenSock standard |
| BAAI/bge-m3 | Model | MIT |
| Google Gemini (gemini-3.5-flash-lite, gemini-3.1-flash-lite) | Model (API) | Gemini API terms |
| GPT-5.5, gpt-6-sol, DeepSeek-V4-Pro via KrackedDevs proxy `[confirm]` | Model (API) | Provider and sponsor terms |
| ESCO v1.2.1, ESCO–O*NET crosswalk | Dataset | CC BY 4.0 / EC reuse policy |
| O*NET tasks, ratings, Detailed Work Activities | Dataset | CC BY 4.0 |
| ILO WP140; Anthropic Economic Index; GPTs are GPTs labels | Dataset | CC BY 4.0 / CC BY / MIT |
| DOSM/OpenDOSM; MyCOL 2024/25 | Dataset | CC BY 4.0 / facts cited |
| Learning resources (YouTube, Microsoft Learn, Open Library, IIA, course providers), links only | Dataset (links) | Linked only; provider terms |

- **7.3 Employment IP conflicts:** No `[confirm with every member]`.

## 8. Declaration

Leader signature and date (1 Nov 2026 or 31 Oct 2026).
