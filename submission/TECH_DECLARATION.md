# SDC Hackathon 2026 · Technical & Tools Declaration

> **For the teammate filling the official form.** This file follows the official template `2. SDC Hackathon_ Technical Tools Declaration Template.docx` field by field, in the same order and with the same labels, column options and word limits.
>
> 1. Open a **copy** of the official .docx (the originals are in the organisers' Google Drive folder, "2. Template for docs inside GitHub Rep").
> 2. Copy each answer below into the matching box or table. Where a table has more items than blank rows, add rows in Word (right-click → Insert → Rows Below).
> 3. Fill every **🟨 TEAM** item. Only the team can answer these. Search this file for 🟨 to find them all.
> 4. The template's rule: **no field may be left blank.** Where something doesn't apply, write "None" or tick "No".
> 5. Tick the boxes: ☒ = tick, ☐ = leave empty. Check each word count after pasting (limits are in the headings).
> 6. Never paste an API key, password or token into this document.
> 7. Sign, date, then **File → Save As → PDF** named **`SDC2026_TeamName_TechDeclaration.pdf`** (replace `TeamName`). Put it in this `submission/` folder.

**Submission deadline:** 25 October 2026 (the template says "[Insert date]"; write this in)

---

## 1. Team & Project Overview

| Field | Answer |
|---|---|
| Team Name | 🟨 TEAM |
| Project / Solution Name | HalaTuju: a live career map that reroutes as AI changes work |
| Name (Leader) | 🟨 TEAM |
| Email & Phone (Leader) | 🟨 TEAM (as on the registration form) |
| University Affiliation(s) | 🟨 TEAM |
| Live Prototype URL | https://halatuju.replit.app |
| Code Repository URL (public / access granted to judges) | https://github.com/shenenleow10521/SdcHackathon |

---

## 2. Architecture & Technology Stack

### 2.1 System Architecture Overview *[Maximum 200 words]*

> Template asks: how the components connect end to end (UI → backend → AI model/API → database → cloud hosting). A block diagram can be attached as an appendix. 🟨 TEAM: use the same diagram screenshot as the PRD, as "Appendix A: System block diagram".

The user opens a vanilla-JavaScript web app with a 3D career map, served by a **Node 22 + TypeScript + Express** server deployed on **Replit**, with **Replit PostgreSQL** as a versioned knowledge base.

A CV arrives as a PDF, a pasted text, or a scan or photo. Scans are read by **local OCR** (tesseract.js) on our server. Personal details are removed **before any AI call**. **Gemini** splits the CV into phrases, **bge-m3 embeddings on RunPod Serverless** find candidate skills among ESCO's 13,939, and Gemini picks the skills and current job.

Scores, routes and the 1,000-future stress test are **fixed formulas** in a shared engine (`shared/engine.js`) that runs on the server and in the browser; no AI sets a number.

A daily **Job market researcher** agent searches 74 vetted sites (Tavily, RSS, GDELT, Hacker News, arXiv, OpenAlex), checks each quote word for word, and a second Gemini model reviews each claim. Deterministic triage applies small multi-source changes and sends the rest to a person. An approved change re-scores plans and reroutes them on the map.

Our own **AI-exposure model** (bge-m3 + ridge regression, trained on a RunPod GPU pod) scores tasks and skills.

*Word count: 195*

### 2.2 Languages, Frameworks & Libraries

Main languages: TypeScript, JavaScript, Python 3.11 (ML pipeline, data scripts), SQL, HTML/CSS.

| Name & Version | Purpose in Project | License |
|---|---|---|
| Node.js 22 | Server runtime | MIT |
| Express 5.3.0 | HTTP API | MIT |
| TypeScript 7.0.2, tsx 4.23.15 | Typed server code, running TypeScript directly | Apache-2.0 / MIT |
| zod 4.6.7 | Request and AI-output validation | MIT |
| multer 2.5.0 | CV file uploads (in memory, never stored) | MIT |
| unpdf 1.9.1 (pdf.js) | PDF text extraction | MIT (pdf.js Apache-2.0) |
| tesseract.js 7.0.0 + Tesseract eng/msa language data | Local OCR for scanned and photographed CVs | Apache-2.0 |
| fast-xml-parser 5.11.2 | RSS and arXiv feeds | MIT |
| pg 8.23.1 | PostgreSQL client | MIT |
| @electric-sql/pglite 0.5.11 | Embedded PostgreSQL for local runs and tests | Apache-2.0 |
| dotenv 18.0.8 | Local environment variables | BSD-2-Clause |
| Vitest 5.0.5, supertest 7.3.1 | 419 automated tests (development only) | MIT |
| 3d-force-graph 1.79.0 (three.js) | 3D career map | MIT |
| GSAP 3.12.5 | Map animations | GreenSock standard licence (free) |
| Lucide 0.469.0 | Icons | ISC |
| Geist font (Google Fonts) | Typeface | SIL OFL 1.1 |
| sentence-transformers, PyTorch, scikit-learn, pandas, NumPy, SciPy | Exposure-model embedding, training and evaluation (`ml/`) | Apache-2.0 / BSD |
| Infinity (michaelfeil/infinity) | Local bge-m3 embedding server for development and fallback | MIT |
| reportlab | Generates the synthetic demo CV PDF (`demo/make-cv-pdf.py`) | BSD |
| Remotion | Renders the pitch video from code (`video/project/`; not part of the app) | Remotion licence (free for individuals and small teams) |

---

## 3. APIs & Cloud Services

### 3.1 External APIs

| API & Provider | Purpose in Project | Access Tier (free / paid / sponsor-provided) |
|---|---|---|
| Google Gemini API: `gemini-3.5-flash-lite` (main), `gemini-3.1-flash-lite` (reviewer and fallback), `gemini-embedding-001` (last-resort embedding fallback) | CV reading, Job market researcher extraction, AI reviewer, emerging-skill committee, route explanations | Free |
| RunPod Serverless API (endpoint `a7ipau1nmqogxs`) | bge-m3 embeddings at run time | Sponsor-provided |
| RunPod GraphQL / REST API | Launching, monitoring and stopping the training pod (`ml/runpod_train.py`) | Sponsor-provided |
| Tavily Search API | Web search limited to trusted domains, for the Job market researcher and the committee | Free |
| ESCO REST API (European Commission) | Building the ESCO mappings (build time only) | Free |
| arXiv API, OpenAlex API, GDELT, Hacker News (Algolia) API, RSS feeds of vetted publishers | AI-capability, adoption and demand signals | Free |
| data.gov.my / OpenDOSM API | DOSM wage data (build time only) | Free |
| Supabase Auth | Optional email-and-password sign-in; switched off in the live demo, which needs no account | Free |

Job boards (JobStreet, LinkedIn, Indeed) are plain links only; the app never calls them.

### 3.2 Cloud Platforms & Deployment

| Service & Provider | Purpose in Project | Plan / Region |
|---|---|---|
| Replit | Hosts the app (Deployments, Reserved VM) and its only database (Replit PostgreSQL 16); Secrets hold all keys | Replit Core (sponsor-provided) / 🟨 TEAM: region shown in the deployment settings |
| RunPod Serverless | bge-m3 embedding endpoint, 0–1 workers | Sponsor credit |
| RunPod GPU Cloud | Final exposure-model training run (pod `38jijj8fe5dazu`, RTX 4090, 2.5 min) | Sponsor credit, Secure Cloud |
| Supabase | PostgreSQL during local development only; the live app uses Replit PostgreSQL | Free |
| GitHub, GitHub Actions | Repository; type-check and tests on every push (Node 22 and 24) | Free |

**How the prototype is deployed:** Replit Deployments (Reserved VM) runs `npm start` on Node 22 with Replit PostgreSQL 16. Steps are in `submission/REPLIT_PROOF.md`.

---

## 4. AI Tools, Models & Datasets

### 4.1 AI Models Used in the Solution

| Model & Version | Source / Provider | Usage (pre-trained / fine-tuned / self-trained) | License / Terms |
|---|---|---|---|
| gemini-3.5-flash-lite | Google, Gemini API | Pre-trained. CV phrase splitting and skill picking, signal extraction, emerging-skill proposer, explanations | Gemini API terms |
| gemini-3.1-flash-lite | Google, Gemini API | Pre-trained. AI reviewer, committee skeptic, fallback | Gemini API terms |
| gemini-embedding-001 | Google, Gemini API | Pre-trained. Last-resort embedding fallback | Gemini API terms |
| BAAI/bge-m3 | Hugging Face, run on RunPod Serverless (Infinity worker) | Pre-trained. Embeddings for CV-to-ESCO matching, signal de-duplication, ESCO duplicate checks, exposure-model input | MIT |
| HalaTuju AI-exposure model (bge-m3 + ridge regression) | Our team; final training run on RunPod (RTX 4090) | **Self-trained.** Estimates how much of a task or skill AI can do; shown next to published studies | Ours (Apache-2.0); training labels MIT |
| Tesseract LSTM models (eng, msa) | tesseract.js / tesseract-ocr | Pre-trained. Local OCR of scans and photos, before any AI call | Apache-2.0 |

Our exposure model was trained by the team on 15,306 of 19,265 O\*NET tasks, and evaluated on the other 3,959 tasks from 185 held-out occupations (per occupation r 0.919, MAE 0.065; per task MAE 0.203, worse than a nearest-neighbour baseline's 0.176). No model was fine-tuned.

### 4.2 Datasets

> Template asks: every dataset used for training, evaluation or in the running app, and whether it holds personal or sensitive data.

| Dataset Name | Source / URL | Type (public / private / self-collected / synthetic) | License | Personal Data? (Y/N) |
|---|---|---|---|---|
| ESCO v1.2.1 (3,039 occupations, 13,939 skills) | https://esco.ec.europa.eu | Public | EU reuse policy (CC BY 4.0), attribution | N |
| ESCO–O\*NET crosswalk v1 | https://esco.ec.europa.eu (ESCO Secretariat with USDOL/ETA) | Public | Reuse with attribution | N |
| O\*NET task statements and ratings | https://www.onetcenter.org | Public | CC BY 4.0 | N |
| "GPTs are GPTs" task exposure labels | https://github.com/openai/GPTs-are-GPTs (pinned commit) | Public | MIT | N |
| ILO Working Paper 140 exposure index | https://www.ilo.org (International Labour Organization) | Public | CC BY 4.0 | N |
| Anthropic Economic Index | https://huggingface.co/datasets/Anthropic/EconomicIndex | Public | CC BY (data), MIT (code) | N |
| MyCOL 2024/2025 critical occupations | TalentCorp Malaysia and ILMIA (published list) | Public | Facts and link, with citation | N |
| DOSM wages by MASCO major group, 2021–2025 | https://data.gov.my (OpenDOSM) | Public | CC BY 4.0 | N |
| 30 course listings | Course providers' public pages | Self-collected | Facts and link only | N |
| News and research items | 74 vetted sites, arXiv, OpenAlex (CC0), GDELT, Hacker News | Self-collected | Short quotes with link | N (personal details scrubbed before storage) |
| 50 benchmark CVs and answer keys (`eval/cv/`), demo CV (`demo/`) | Written by AI agents for this project | Synthetic | Ours | N (fictional people) |
| Sample catalogue (16 jobs, 29 skills, persona Priya Nair, fictional employers and HR team) | Our own design | Synthetic (labelled *Sample* in the app) | Ours | N |

### 4.3 AI-Assisted Development Tools

> Template note: declaring these tools does not reduce your score; undeclared use may.

Did your team use any generative-AI tool to help create code, design, text, or other project material?

☒ Yes ☐ No

If yes, list them below:

| Tool & Version | Used For | Extent of Use (minor / moderate / major) |
|---|---|---|
| Claude Code (Anthropic), Claude Opus models | Writing, refactoring and reviewing server, engine, web and ML code and tests; data-building scripts; debugging; documentation, README, pitch script, pitch deck and pitch video code; competitor research on public repos | Major |
| Claude agents (Anthropic) | Writing the 50 synthetic benchmark CVs and their blind answer keys; the blind precision judge for the CV benchmark | Moderate |
| Google Gemini (gemini-3.5-flash) | A first benchmark judge run; its verdicts were discarded when the free quota ran out | Minor |
| faster-whisper large-v3 (local GPU) | Transcribing the organisers' submission tutorial video for our requirements notes | Minor |
| Microsoft Edge neural voice (edge-tts) | Timing the pitch-video narration lines; not used in the final audio | Minor |
| 🟨 TEAM: any other AI tool a member used (e.g. ChatGPT, Copilot, Gemini app, image or voice tools), or delete this row | 🟨 TEAM | 🟨 TEAM |

Briefly describe how your team reviewed, tested, and took responsibility for AI-generated output: *[Maximum 100 words]*

The team chose the problem, persona, the reroute idea, the data sources and every design decision, and directed each change. AI-written code ships only with tests: 419 automated tests and a type-check run on every push in CI. Each number in the README is copied from a result file in the repo, and each benchmark was run on held-out data with its weak results reported (per-task model error, blind privacy score 82.6%). Every team member can explain every core feature. 🟨 TEAM: adjust to what you actually did, e.g. who reviewed which part.

*Word count: 92*

---

## 5. Sponsor-Provided Resources

Did your project use any official SDC sponsor-provided resource?

☒ Yes ☐ No

If yes, list them below:

| Sponsor | Resource (API / credits / platform / data) | How It Was Used in the Project |
|---|---|---|
| RunPod | Credits (US$25): GPU pod and Serverless | Final training run of our AI-exposure model (pod `38jijj8fe5dazu`, RTX 4090); bge-m3 embedding endpoint `a7ipau1nmqogxs` for CV matching, signal de-duplication and ESCO duplicate checks. Proof: `SDC2026_TeamName_Runpod_POU.pdf` |
| Replit | Platform: Replit Core and Deployments | Hosts the live app and its PostgreSQL database; Secrets hold all keys. Proof: `SDC2026_TeamName_Replit_POU.pdf` |
| 🟨 TEAM: mentoring session, if the team used one (the template lists mentoring as a sponsor resource), or delete this row | Mentoring | 🟨 TEAM |

Was the sponsor resource essential to the core functionality of the prototype, or could it be replaced? Explain briefly: *[Maximum 100 words]*

RunPod is essential to the quality of CV reading: the 13,939 ESCO skill vectors are bge-m3 vectors, so matching needs the same model, and GPU work must run on RunPod under the rules. The app degrades safely without it: it fails over to a local bge-m3 server, then Gemini embeddings, then keyword matching, and labels the result "basic". Replit hosts the app and database; the same code also runs on any Node 22 host with PostgreSQL.

*Word count: 76*

---

## 6. Security, Privacy & Responsible Use

### 6.1 Data Handling & Privacy *[Maximum 150 words]*

> Template asks: what user or personal data is collected, stored or sent to third parties (including AI APIs), how it is protected, and how long it is kept.

**Collected:** confirmed skills and levels, current role, weekly study hours, target date, budget, goals and saved plans, under a random profile ID. The live demo needs no account; optional sign-in (Supabase Auth) is switched off. Age, gender, race and religion are never collected or used, and a test checks that they don't change any result.

**CVs:** read in memory and never stored. Scans are read by OCR on our own server. Names, MyKad numbers, phones, emails, addresses and attribute lines are removed **before any AI sees the text** (99.4% of planted details on held-out test CVs), and the user sees what was removed.

**Control:** each account sees only its own data; **Delete my data** removes the profile and everything linked to it. Profiles are kept until the user deletes them.

**Protection:** keys in Replit Secrets only; staff routes need a role or admin token; fetched pages are treated as data, never instructions.

*Word count: 147*

### 6.2 Known Limitations & Risks *[Maximum 150 words]*

> Template asks: the main technical limits of the AI parts (hallucination, bias, rate limits, single-provider dependency) and the mitigations.

- **Wrong signals:** a misread article could move plans. Mitigation: trusted domains, quotes checked word for word, an AI reviewer, deterministic triage, a person approves any route change, and every version can be undone.
- **Estimate error:** our model's per-task error is higher than a nearest-neighbour baseline; we use it per occupation and skill, and feed its measured error into the stress test.
- **Sample catalogue:** the 16-job map's exposure and demand curves are sample data, labelled in the app; "check any job" uses real ESCO data.
- **Synthetic evaluation:** the CV benchmark uses 50 AI-written CVs and an AI judge; real CVs will be messier.
- **Provider limits:** Gemini free quota and RunPod cold starts; fallbacks are labelled ("basic", "replayed").
- **Emerging skills:** about half the watching candidates hold up by hand; thresholds and a person keep the rest out.

*Word count: 141*

---

## 7. Compliance & Readiness Checklist

Tick all boxes that apply before submitting.

- ☒ All APIs, cloud services, AI tools, models, and datasets used in the project are declared in this document. 🟨 TEAM: tick only after the 4.3 "other AI tool" row is answered.
- ☒ All third-party code, datasets, and models are used in accordance with their licenses, and attribution is provided where required (README, `docs/DATA_SOURCES.md`, `ml/SOURCES.md`).
- ☒ No API keys, passwords, or other credentials are exposed in the code repository, prototype, or this document.
- ☒ Any use of generative-AI tools for development has been disclosed and reviewed by the team.
- ☒ Any use of official SDC sponsor resources has been declared in Section 5.
- ☐ The prototype described here is accessible to judges through the links provided in Section 1. 🟨 TEAM: tick after the Replit URL opens in an incognito window.
- ☐ All fields in this template have been completed within the word limits stated. 🟨 TEAM: tick after every 🟨 is filled.

---

## 8. Declaration

By submitting this document, the team leader confirms that the information provided is complete and accurate to the best of the team's knowledge, and that every API, cloud service, AI tool, dataset, model, and sponsor resource used in the project has been declared.

[Signature] 🟨 TEAM: leader signs

[Date] 🟨 TEAM
