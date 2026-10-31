# Tech & Tools Declaration (finalist template): what to change from the 25 Oct version

Start from the text of `submission/SDC2026_Dsaise_TechDeclaration.pdf` and paste it into the **finalist** template. The section numbers are the same. Then apply the changes below and save as `SDC2026_Dsaise_TechDeclaration.pdf`.

**Blocking question first:** does the final build call the **KrackedDevs proxy** (GPT-5.5, gpt-6-sol, DeepSeek-V4-Pro)? It is in the uncommitted code (`server/lib/llm.ts`, `.env.example`). If the Replit deployment has `KRACKEDDEVS_API_KEY` set, declare it in all the places marked **[KD]**. If not, delete those rows. KrackedDevs is the Domain 1 sponsor, so it also belongs in §5.

---

## Header

- Deadline line: **1st November 2026** (the template already says this).
- §1: unchanged.

## §2.1 System Architecture Overview (max 200 words): replace

> A JavaScript browser app in English and Bahasa Melayu (My skills, Explore map, Plan, My goal, For HR) is served by Node 22, TypeScript and Express on a Replit Reserved VM. CVs, pasted text or a task quiz enter the API. Local Tesseract OCR reads scans, and a scrubber removes personal details before any AI call. An LLM splits the CV into phrases. BAAI/bge-m3 on RunPod Serverless matches them against 13,939 ESCO skills, and a second LLM call confirms the skills and current job. Our ridge model, trained on a RunPod GPU, scores each skill's AI exposure. Fixed formulas in a shared engine set match scores, route time and cost, Slow/Steady/Fast scenarios and 1,000-future stress tests. A scheduled researcher collects dated evidence from 74 trusted domains. Quotes are checked, and three voter agents on two vendors' models decide: 2–3 of 3 apply, 1 of 3 goes to a person. Every vote is logged and every change can be undone. Replit PostgreSQL 16 stores profiles, knowledge versions, votes and goals. Sign-in uses Replit-managed Clerk, with guest access. GitHub Actions runs the type-check and tests.

_≈ 190 words._

## §2.2 Languages, Frameworks & Libraries

- Change the test row: `Vitest 5; supertest 7 | {measure} automated tests` (543 on 31 Oct, 11:30 MYT; 2 were failing on uncommitted work. Re-run before filling).
- Re-check versions against `package.json` on the final commit. No new npm packages were added since 25 Oct (checked against commit f4c8e8a).

## §3.1 External APIs: add or change

| API & Provider | Purpose | Access tier |
|---|---|---|
| **[KD]** KrackedDevs LLM proxy (OpenAI-compatible) | Main and reviewer models for CV reading, explanations, the three-agent vote | Sponsor-provided |
| Google Gemini API | Fallback models when the proxy is not set; embedding fallback | Free tier |
| YouTube oEmbed | Build-time check that learning videos exist | Free |

All other rows are unchanged (RunPod Serverless, RunPod GPU Cloud, Tavily, ESCO, OpenDOSM, arXiv/OpenAlex/GDELT/HN Algolia/RSS, Clerk).

## §3.2 Cloud Platforms: unchanged

Remove the Supabase row if it was never used for the final build `[confirm]`.

## §4.1 AI Models: add

| Model | Source | Usage | Terms |
|---|---|---|---|
| **[KD]** gpt-5.5 | OpenAI via KrackedDevs proxy | Pre-trained; main model, evidence voter | Provider and sponsor terms |
| **[KD]** gpt-6-sol | via KrackedDevs proxy | Pre-trained; skill-matcher voter | Provider and sponsor terms |
| **[KD]** DeepSeek-V4-Pro | DeepSeek via KrackedDevs proxy | Pre-trained; reviewer, sceptic voter | Provider and sponsor terms |

Keep the Gemini, bge-m3, ridge and Tesseract rows. Relabel Gemini as "fallback" if KD ships.

## §4.2 Datasets: add

| Dataset | Source | Type | License | Personal? |
|---|---|---|---|---|
| O*NET Detailed Work Activities | onetcenter.org | Public | CC BY 4.0 | N |
| ESCO transversal skills; skill network and bridges (derived) | esco.ec.europa.eu; built by our scripts | Public / derived | CC BY 4.0 | N |
| AI-era skill list with source links | Vetted public sources (`db/seed/ai_skills_links.json`) | Public facts, links | Linked, cited | N |
| Learning resources (links checked 30 Oct) | YouTube, Microsoft Learn, Open Library, IIA, course providers | Public links | Provider terms; linked only | N |
| Sample HR team (opt-in progress demo) | Created for project | Synthetic | Project Apache-2.0 | N |
| No-CV quiz chips | O*NET tasks, wording rewritten by an LLM | Public / derived | CC BY 4.0 | N |

## §4.3 AI-Assisted Development Tools

Keep all existing rows. Add any tool a member used during the final round, e.g. the tool used to build the .pptx deck or the HTML deck, and any image or voice tool used for the backup video `[ask every member]`.

Review text (max 100 words), replace the number: "…a TypeScript type-check and {measure} automated tests…" Add: "Vote decisions are logged with each agent's reason, and split votes go to a person."

## §5 Sponsor-Provided Resources

Add **[KD]**:

| Sponsor | Resource | How used |
|---|---|---|
| KrackedDevs | LLM API proxy | Runs every agent: CV reading, explanations, and the three-agent evidence vote on two vendors' models |

Essential or replaceable (max 100 words): "RunPod provides the GPU training run and matching embeddings; local bge-m3, Gemini embeddings and labelled keyword matching are fallbacks. **[KD]** The KrackedDevs proxy runs the agents; Google Gemini is a tested fallback through the same interface. Replit hosts the live app and database; the Node 22 and PostgreSQL app can run on a comparable host."

## §6.1 Data Handling & Privacy: add one sentence

"Goal check-ins and skill proof are stored with the profile. HR team progress is shown only when the worker opts in, and they can opt out."

## §6.2 Known Limitations: replace the last two sentences

"…The vote replay has only one human-decided signal so far, so agent accuracy is not yet measured. Routes now cover all 3,039 ESCO occupations, but cross-field bridges and AI-era skill links are partly LLM-suggested and reviewed. The emerging-skill watchlist is not treated as verified demand."

## §7–8

Tick only what is true. Re-sign and date it **31/10/2026 or 01/11/2026**. Keep Appendices A–C, and update A if the diagram changes.
