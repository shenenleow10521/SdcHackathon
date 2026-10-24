# SDC Hackathon 2026 · Technical Tools Declaration (draft)

> Our answers, in the section order of the official **Technical Tools Declaration Template**. Copy them into the official form, fill the _[brackets]_, sign, and save the result here as a PDF. Word limits are the template's.

## 1. Team and project overview

| Field | Answer |
|---|---|
| Team name | _[team name]_ |
| Project / solution name | **HalaTuju**: a live career map that reroutes as AI changes work |
| Name (leader) | _[leader name]_ |
| Email and phone (leader) | _[as on the registration form]_ |
| University affiliation(s) | _[university]_ |
| Live prototype URL | _[Replit deployment URL]_ |
| Code repository URL | https://github.com/shenenleow10521/SdcHackathon |

## 2. Architecture and technology stack

### 2.1 System architecture overview *(200 words max)*

The user opens a vanilla-JavaScript web app with a 3D career map, served by a **Node 22 + TypeScript + Express** server deployed on **Replit**, with **PostgreSQL** (Replit PostgreSQL or Supabase) as a versioned knowledge base.

A CV arrives as a PDF, a pasted text, or a scan or photo. Scans are read by **local OCR** (tesseract.js) on our server. Personal details are removed **before any AI call**. **Gemini** splits the CV into phrases, **bge-m3 embeddings on RunPod Serverless** find candidate skills among ESCO's 13,939, and Gemini picks the skills and current job.

Scores, routes and the 1,000-future stress test are **fixed formulas** in a shared engine (`shared/engine.js`) that runs on the server and in the browser; no AI sets a number.

A daily **Job market researcher** agent searches 74 vetted sites (Tavily, RSS, GDELT, Hacker News, arXiv, OpenAlex), checks each quote word for word, and a second Gemini model reviews each claim. Deterministic triage applies small multi-source changes and sends the rest to a person. An approved change re-scores plans and reroutes them on the map.

Our own **AI-exposure model** (bge-m3 + ridge regression, trained on a RunPod GPU pod) scores tasks and skills.

*Word count: 195*

### 2.2 Languages, frameworks and libraries

Languages: TypeScript, JavaScript, Python 3.11 (ML pipeline, data scripts), SQL, HTML/CSS.

| Name and version | Purpose in project | Licence |
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
| Vitest 5.0.5, supertest 7.3.1 | 418 automated tests (development only) | MIT |
| 3d-force-graph 1.79.0 (three.js) | 3D career map | MIT |
| GSAP 3.12.5 | Map animations | GreenSock standard licence (free) |
| Lucide 0.469.0 | Icons | ISC |
| Geist font (Google Fonts) | Typeface | SIL OFL 1.1 |
| sentence-transformers, PyTorch, scikit-learn, pandas, NumPy, SciPy | Exposure-model embedding, training and evaluation (`ml/`) | Apache-2.0 / BSD |
| Infinity (michaelfeil/infinity) | Local bge-m3 embedding server for development and fallback | MIT |
| reportlab | Generates the synthetic demo CV PDF (`demo/make-cv-pdf.py`) | BSD |

## 3. APIs and cloud services

### 3.1 External APIs

| API and provider | Purpose in project | Access tier |
|---|---|---|
| Google Gemini API: `gemini-3.5-flash-lite` (main), `gemini-3.1-flash-lite` (reviewer and fallback); `gemini-embedding-001` as a last-resort embedding fallback | CV reading, Job market researcher extraction, AI reviewer, emerging-skill committee, route explanations | Free tier |
| RunPod Serverless API (endpoint `a7ipau1nmqogxs`) | bge-m3 embeddings at run time | Sponsor credit |
| RunPod GraphQL / REST API | Launching, monitoring and terminating the training pod (`ml/runpod_train.py`) | Sponsor credit |
| Tavily Search API | Web search limited to trusted domains, for the Job market researcher and the committee | Free tier |
| ESCO REST API (European Commission) | Building the ESCO mappings (build time only) | Free |
| arXiv API, OpenAlex API, GDELT, Hacker News (Algolia) API, RSS feeds of vetted publishers | AI-capability, adoption and demand signals | Free |
| data.gov.my / OpenDOSM API | DOSM wage data (build time only) | Free |
| Replit-managed Clerk | Email-and-password sign-in and account sessions; guest CV intake remains available | Included through Replit |

Job boards (JobStreet, LinkedIn, Indeed) are plain links only; the app never calls them.

### 3.2 Cloud platforms and deployment

| Service and provider | Purpose in project | Plan / region |
|---|---|---|
| Replit | Hosting the app (Deployments, Reserved VM) with PostgreSQL 16; Secrets | Replit Core (sponsor) |
| RunPod Serverless | bge-m3 embedding endpoint, 0–1 workers | Sponsor credit |
| RunPod GPU Cloud | Final exposure-model training run (pod `38jijj8fe5dazu`, RTX 4090, 2.5 min) | Sponsor credit, Secure Cloud |
| Supabase | Optional production PostgreSQL and Auth | Free, _[region]_ |
| GitHub, GitHub Actions | Repository; type-check and tests on every push (Node 22 and 24) | Free |

## 4. AI tools, models and datasets

### 4.1 AI models used in the solution

| Model and version | Source / provider | Usage | Licence / terms |
|---|---|---|---|
| gemini-3.5-flash-lite | Google, Gemini API | CV phrase splitting and skill picking, signal extraction, emerging-skill proposer, explanations | Gemini API terms |
| gemini-3.1-flash-lite | Google, Gemini API | AI reviewer, committee skeptic, fallback | Gemini API terms |
| BAAI/bge-m3 | Hugging Face, run on RunPod Serverless (Infinity worker) | Embeddings for CV-to-ESCO matching, signal de-duplication, ESCO duplicate checks, exposure model input | MIT |
| HalaTuju AI-exposure model (bge-m3 + ridge regression) | **Trained by our team**, final run on RunPod (RTX 4090) | Estimates how much of a task or skill AI can do; shown next to published studies | Ours (Apache-2.0); training labels MIT |
| Tesseract LSTM models (eng, msa) | tesseract.js / tesseract-ocr | Local OCR of scans and photos, before any AI call | Apache-2.0 |

Our exposure model was **trained by the team**: 15,306 tasks from 738 occupations, evaluated on 185 held-out occupations (per occupation r 0.919, MAE 0.065; per task MAE 0.203, worse than a nearest-neighbour baseline's 0.176). No other model was trained or fine-tuned.

### 4.2 Datasets

| Dataset name | Source / URL | Type | Licence | Personal data? |
|---|---|---|---|---|
| ESCO v1.2.1 (3,039 occupations, 13,939 skills) | https://esco.ec.europa.eu | Taxonomy | EU reuse policy (CC BY 4.0), attribution | No |
| ESCO–O\*NET crosswalk v1 | ESCO Secretariat with USDOL/ETA | Mapping | Reuse with attribution | No |
| O\*NET task statements and ratings | https://www.onetcenter.org | Occupational data | CC BY 4.0 | No |
| "GPTs are GPTs" task exposure labels | https://github.com/openai/GPTs-are-GPTs (pinned commit) | Training labels | MIT | No |
| ILO Working Paper 140 exposure index | International Labour Organization | Research data | CC BY 4.0 | No |
| Anthropic Economic Index | Hugging Face `Anthropic/EconomicIndex` | Research data | CC BY (data), MIT (code) | No |
| MyCOL 2024/2025 critical occupations | TalentCorp Malaysia and ILMIA | Published list (facts only) | Facts and link, with citation | No |
| DOSM wages by MASCO major group, 2021–2025 | data.gov.my / OpenDOSM | Official statistics | CC BY 4.0 | No |
| 30 course listings | Course providers' public pages | Facts and links | Facts and link only | No |
| News and research items | 74 vetted sites, arXiv, OpenAlex (CC0), GDELT, HN | Short quotes and links | Quotation with link | Scrubbed |
| 50 synthetic CVs and answer keys (`eval/cv/`), demo CV (`demo/`) | Written by AI agents for this project | Synthetic test data | Ours | **No: fictional people** |
| Sample catalogue (16 jobs, 29 skills, persona Priya Nair, fictional employers and HR team) | Our own design | Sample data, labelled *Sample* in the app | Ours | No |

### 4.3 AI-assisted development tools

Did the team use any generative-AI tool to help create code, design, text or other project material? **Yes.**

| Tool and version | Used for | Extent of use |
|---|---|---|
| Claude Code (Anthropic), Claude Opus models | Writing, refactoring and reviewing server, engine, web and ML code and tests; data-building scripts; debugging; documentation, README and pitch drafts; competitor research on public repos | Extensive |
| Claude agents (Anthropic) | Writing the 50 synthetic benchmark CVs and the blind answer keys (an annotator that never saw our code); the blind precision judge for the CV benchmark | Benchmark only |
| Google Gemini (gemini-3.5-flash) | A first benchmark judge run; its verdicts were discarded when the free quota ran out | Minor |
| faster-whisper large-v3 (local GPU) | Transcribing the organisers' submission tutorial video for our requirements notes | Minor |
| _[any other AI tool the team used, e.g. ChatGPT, Copilot, image tools]_ | _[what for]_ | _[extent]_ |

**How the team reviewed, tested and took responsibility for AI-generated output** *(100 words max)*

The team chose the problem, persona, the reroute idea, the data sources and every design decision, and directed each change. AI-written code ships only with tests: 418 automated tests and a type-check run on every push in CI. Each number in the README is copied from a result file in the repo, and each benchmark was run on held-out data with its weak results reported (per-task model error, blind privacy score 82.6%). Every team member can explain every core feature. _[Team: adjust to what you actually did, e.g. who reviewed which part.]_

*Word count: 92*

## 5. Sponsor-provided resources

Did the project use any official SDC sponsor-provided resource? **Yes.**

| Sponsor | Resource (API / credits / platform / data) | How it was used in the project |
|---|---|---|
| RunPod | GPU pod and Serverless credits (US$25) | Final training run of our AI-exposure model (pod `38jijj8fe5dazu`, RTX 4090); bge-m3 embedding endpoint `a7ipau1nmqogxs` for CV matching, signal de-duplication and ESCO duplicate checks. Proof: `submission/RUNPOD_PROOF.md` |
| Replit | Replit Core platform and Deployments | Hosts the live app and its PostgreSQL database; Secrets hold all keys. Proof: `submission/REPLIT_PROOF.md` |

**Was the sponsor resource essential to the core functionality, or could it be replaced?** *(100 words max)*

RunPod is essential to the quality of CV reading: the 13,939 ESCO skill vectors are bge-m3 vectors, so matching needs the same model, and GPU work must run on RunPod under the rules. The app degrades safely without it: it fails over to a local bge-m3 server, then Gemini embeddings, then keyword matching, and labels the result "basic". Replit hosts the app and database; the same code also runs on any Node 22 host with PostgreSQL.

*Word count: 76*

## 6. Security, privacy and responsible use

### 6.1 Data handling and privacy *(150 words max)*

**Collected:** confirmed skills and levels, current role, weekly study hours, target date, budget, goals and saved plans, under a random profile ID. Users can create an account through Replit-managed Clerk, or use CV intake as a guest. Age, gender, race and religion are never collected or used, and a test checks that they don't change any result.

**CVs:** read in memory and never stored. Scans are read by OCR on our own server. Names, MyKad numbers, phones, emails, addresses and attribute lines are removed **before any AI sees the text** (99.4% of planted details on held-out test CVs), and the user sees what was removed.

**Control:** each account sees only its own data; **Delete my data** removes the profile and everything linked to it.

**Protection:** keys in Replit Secrets only; staff routes need a role or admin token; fetched pages are treated as data, never instructions.

*Word count: 139*

### 6.2 Known limitations and risks *(150 words max)*

- **Wrong signals:** a misread article could move plans. Mitigation: trusted domains, quotes checked word for word, an AI reviewer, deterministic triage, a person approves any route change, and every version can be undone.
- **Estimate error:** our model's per-task error is higher than a nearest-neighbour baseline; we use it per occupation and skill, and feed its measured error into the stress test.
- **Sample catalogue:** the 16-job map's exposure and demand curves are sample data, labelled in the app; "check any job" uses real ESCO data.
- **Synthetic evaluation:** the CV benchmark uses 50 AI-written CVs and an AI judge; real CVs will be messier.
- **Provider limits:** Gemini free quota and RunPod cold starts; fallbacks are labelled ("basic", "replayed").
- **Emerging skills:** about half the watching candidates hold up by hand; thresholds and a person keep the rest out.

*Word count: 141*

## 7. Compliance and readiness

- [x] All APIs, cloud services, AI tools, models and datasets used in the project are declared in this document.
- [x] All third-party code, datasets and models are used in accordance with their licences, and attribution is provided where required (README, `docs/DATA_SOURCES.md`, `ml/SOURCES.md`).
- [x] No API keys, passwords or other credentials are exposed in the code repository, prototype or this document.
- [x] Any use of generative-AI tools for development has been disclosed and reviewed by the team.
- [x] Any use of official SDC sponsor resources has been declared in Section 5.
- [ ] The prototype described here is accessible to judges through the links provided in Section 1. _(after the Replit deployment)_
- [ ] All fields in this template have been completed within the word limits stated. _(after filling the brackets)_

## 8. Declaration

By submitting this document, the team leader confirms that the information provided is complete and accurate to the best of the team's knowledge, and that every API, cloud service, AI tool, dataset, model and sponsor resource used in the project has been declared.

Signature: _[leader name] (Team Leader, typed)_ Date: _[date]_
