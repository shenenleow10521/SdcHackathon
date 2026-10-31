# Data sources

This page lists every external dataset HalaTuju uses, where it came from, its licence, what we took from it and how we changed it. It also lists what is still **sample** data and why. All sources were accessed on **2026-10-23** unless a row says otherwise. Every value in `db/seed/*.json` comes from these files or APIs. Where a source has no value for something, we leave it out rather than estimate it.

The fetch and transform scripts are in [`scripts/data/`](../scripts/data/). They use only the Python standard library, are read-only, identify themselves with the User-Agent `HalaTuju-hackathon-data/0.1 (SDC Hackathon 2026; non-commercial research)`, and wait between requests. Downloads are cached in `data/raw/`, which git ignores, and are read as data only. To rebuild:

```bash
python -I scripts/data/build_esco_map.py   # -> db/seed/esco_map.json
python -I scripts/data/build_studies.py    # -> db/seed/studies.json   (needs pdftotext from poppler; Git for Windows ships it)
python -I scripts/data/fetch_dosm.py       # -> db/seed/dosm.json
python -I scripts/data/check_courses.py    # re-checks every course URL in db/seed/courses.json
```

The AI-exposure **model** in `ml/` has its own sources and licences. They are listed in [`ml/SOURCES.md`](../ml/SOURCES.md) and not repeated here.

## Summary: what is real and what is sample

| Area | Real | Still sample | Why it is still sample |
|---|---|---|---|
| Occupation to ESCO / ISCO-08 | 16 of 16 occupations | none | — |
| Occupation to O\*NET-SOC | 14 of 16 | `opsRole` (Finance Automation Specialist), `aiQaRole` (AI Data Quality Specialist) | No credible O\*NET occupation, and the ESCO concepts are not in the ESCO–O\*NET crosswalk |
| Skill to ESCO | 24 of 29 skills (6 exact, 13 close, 5 nearest) | `three` (three-way matching), `ghg` (GHG accounting), plus the emerging skills `aisup`, `prompt`, `aiinv` | ESCO v1.2.1 has no equivalent concept, so we leave the URI empty rather than force a match |
| AI exposure ("Studies disagree") | 57 rows across 4 studies (details below) | the `outlook` exposure and demand curves in `knowledge.json` | The engine's scenario curves are the prototype's values. The studies are shown next to them and do not replace them |
| Courses | 30 listed courses covering all 29 skills; 26 with a published or free price; 26 with stated hours | Practice and prove tasks for each course | These are our own learning design, not provider data |
| HRD Corp claimable | none marked claimable | — | No course could be confirmed on an official HRD Corp page. Two providers say they are claimable on their own pages (see Courses) |
| Employers | none | both employers in `employers.json` | They are fictional, so no real company has requirements attributed to it |
| Malaysian labour context | 4 DOSM extracts, 125 rows; median wage and wage earners by MASCO major group shown for every ESCO job and catalogue job | — | — |
| Persona, skill routes and weights, posting shares, sector notes | — | everything in `knowledge.json` | Prototype values, labelled *Sample* in the UI |

---

## 1. ESCO: occupations and skills

- **Source:** ESCO REST API, https://ec.europa.eu/esco/api (`/search`, `/resource/occupation`, `/resource/skill`), pinned with `selectedVersion=v1.2.1`. v1.2.1 is the current version according to esco.ec.europa.eu.
- **Licence:** free reuse, including commercial reuse, under Commission Decision 2011/833/EU on the reuse of Commission documents. We use no CC BY-SA ESCO components.
- **Used for:** `db/seed/esco_map.json`. For each occupation: the ESCO URI, preferred title, ESCO code and ISCO-08 unit group. For each skill: the URI, preferred label, description and up to 8 alternative labels, which power CV matching.
- **Changes we made:**
  - We chose the concepts by hand after comparing ESCO search results and concept descriptions.
  - Each mapping has a `match` grade: `exact`, `close`, `nearest` or `none`, plus a `note` saying what we compromised on.
  - The aliases are a hand-picked subset of each concept's ESCO alternative labels. The script checks that every alias really is an alternative label of that concept.
  - ISCO-08 comes from the record's `broaderIscoGroup`, or else from the ISCO prefix of the ESCO code (for example, `2411.1.7` gives 2411).
- **Main judgement calls:**
  - `ap` and `stayRole` map to *billing clerk* (ISCO 4311). ESCO has no accounts-payable clerk, and *billing clerk* lists "accounts payable officer" as an alternative label.
  - `esgRole` maps to *sustainability manager*, which is new in v1.2 and lists "sustainability analyst".
  - `intAudit` and `assurRole` map to *financial auditor*, which lists "internal auditor". ESCO has no sustainability-assurance occupation.
  - `lcaRole` maps to *environmental expert*, which lists "climate change specialist" (nearest).
  - `greenRole` maps to *investment analyst* (nearest).
  - `opsRole` maps to *ICT business analyst*, which lists "business process specialist" (nearest).
  - `three` and `ghg` have no ESCO equivalent and are left unmapped. The nearest concept for `ghg`, *advise on carbon emissions reduction*, is advisory work, not accounting.
  - The emerging skills `aisup`, `prompt` and `aiinv` have no ESCO equivalent. The nearest knowledge concept, *principles of artificial intelligence*, is not equivalent, so it is not mapped.

## 2. O\*NET-SOC codes

- **Sources:**
  - The **ESCO–O\*NET crosswalk (occupations)**, version 1 (Sep 2022), by the ESCO Secretariat with USDOL/ETA. It maps O\*NET-SOC 2019 to ESCO v1.1.0. CSV: https://esco.ec.europa.eu/system/files/2023-08/ONET_%28Occupations%29_0_updated.csv (linked from https://esco.ec.europa.eu/en/use-esco/other-crosswalks).
  - **O\*NET OnLine** keyword search, `https://www.onetonline.org/find/quick?s=…`. robots.txt allows this path. We made one request per title.
- **Licence:** O\*NET is CC BY 4.0 (USDOL/ETA). The crosswalk is published by the European Commission for reuse.
- **Used for:** `onet` and `onetTitle` in `esco_map.json`.
- **Rule:** we take the crosswalk match for the chosen ESCO concept. Where that match is clearly worse for the catalogue role than O\*NET OnLine's top search result for the role title, we use the search result instead. This applies to `ap` and `stayRole` (43-3031.00 Bookkeeping, Accounting, and Auditing Clerks) and `scmRole` (13-1081.02 Logistics Analysts). `onetBasis` and `crosswalkMatch` record which rule we used for each occupation. Where neither source gives a credible match (`opsRole`, `aiQaRole`), `onet` is null.

## 3. AI-exposure studies (`db/seed/studies.json`)

Each study is joined to the codes in `esco_map.json`. We do not interpolate, so an occupation has no row for a study that does not cover its code. `value` is on a 0–1 scale only where the study itself publishes a 0–1 exposure score. The `note` on each row names the exact code and title the value belongs to. This matters because several of our roles share a broader ISCO or SOC group.

| Study (`source`) | Rows | File / URL | What `value` is |
|---|---|---|---|
| **ILO Working Paper 140** (`ilo_wp140`) | 16 / 16 occupations | https://www.ilo.org/sites/default/files/2025-05/WP140_web.pdf (Annex Table A1); landing page https://www.ilo.org/publications/generative-ai-and-jobs-refined-global-index-occupational-exposure | The mean task-level GenAI exposure score of the ISCO-08 4-digit unit group, which is already on a 0–1 scale. `rawValue` adds the SD and the exposure gradient. We parse the table from the PDF text (`pdftotext -raw`). We checked the parse against the paper's Table 5 gradient rules and its text: for example, financial analysts are in gradient 4. |
| **Anthropic Economic Index: observed exposure** (`anthropic_economic_index`) | 13 occupations | `labor_market_impacts/job_exposure.csv` at HF revision `4e5f69fab13a9c3f7d0dcc31a6f893a9818738f6`: https://huggingface.co/datasets/Anthropic/EconomicIndex/resolve/4e5f69fab13a9c3f7d0dcc31a6f893a9818738f6/labor_market_impacts/job_exposure.csv. Method: https://www.anthropic.com/research/labor-market-impacts (Massenkoff & McCrory, 5 Mar 2026) | `observed_exposure` for the 6-digit SOC code, already 0–1. It is the share of an occupation's time-weighted O\*NET tasks that are LLM-feasible and seen in work-related Claude usage (Aug and Nov 2025). Automated use counts in full; augmentative use counts half. There is no row for 13-1023 Purchasing Agents (`procRole`). |
| **Anthropic Economic Index: Claude usage share** (`anthropic_economic_index`) | 14 occupations, `value: null` | `release_2026_06_26/data/aei_claude_ai_2026-06-26.csv` at the same revision. We stream the file and keep only `geo_id=GLOBAL`, `category_name=soc_occupation`, `hierarchy_level=0`, `metric_id=pct`, for the latest month (starting 2026-05-01) | `rawValue` is the occupation's percentage of Claude.ai conversations. A share of usage is not an exposure score: big occupations attract more conversations. We therefore do not put it on the 0–1 scale, which would distort the "disagree" spread. The `note` gives its percentile rank among the 718 occupations published that month. Published values are rounded to 0.01 percentage points, so "0.0%" means below 0.005%. |
| **Eloundou, Manning, Mishkin & Rock (2024), *GPTs are GPTs*, Science 384(6702)** (`eloundou_gpts_are_gpts`) | 14 occupations | `data/occ_level.csv` at commit `0471612fef3cc22b74fb884d27bff9dbd3770582`: https://raw.githubusercontent.com/openai/GPTs-are-GPTs/0471612fef3cc22b74fb884d27bff9dbd3770582/data/occ_level.csv | `human_rating_beta`, the share of tasks exposed with β = E1 + 0.5·E2 from human annotators, for the exact O\*NET-SOC code. Already 0–1. |

**Read with care:**
- The ILO values are averages for the whole ISCO unit group. `scmRole` and `procRole` both fall in 3323 Buyers, and `dataRole` and `opsRole` both fall in 2511 Systems Analysts.
- `esgRole`'s Anthropic observed exposure is for SOC 13-1199 "Business Operations Specialists, All Other", the broad group that contains Sustainability Specialists.
- The studies measure different things: task feasibility (Eloundou), expert and LLM task scoring (ILO), and actual usage (Anthropic). That is why they disagree.

## 4. Courses (`db/seed/courses.json`)

- **Sources:** the providers' own course pages. Each entry has its URL, the exact price text (`priceStated`), an `evidence` snippet taken from the page, and `checkedAt`.
  - Coursera: 18 courses.
  - Microsoft Learn: 8 modules. Durations come from Microsoft's public catalogue API, https://learn.microsoft.com/api/learn/catalog (`duration_in_minutes`), which is what the module page displays.
  - IFRS Foundation e-learning: https://www.ifrs.org/sustainability/knowledge-hub/courses/
  - GHG Protocol Corporate Standard training webinar recording: https://ghgprotocol.org/corporate-standard-training-webinar
  - BSI Group Malaysia, Bursa Malaysia Sustainability Reporting Guide training.
  - Wanfah Prosper, Understanding Malaysian SST.
- **Checked:** all 30 URLs returned HTTP 200 on 2026-10-23 (`scripts/data/check_courses.py`).
- **`hours`:** taken from the listing when it is stated. "N weeks at H hours a week" is multiplied out, and Microsoft Learn minutes are rounded to whole hours (minimum 1). Otherwise `hours` is null (4 courses).
- **`costRm`:**
  - `0` when the course is free or free to enrol. On Coursera "Enroll for free" pages the certificate costs extra and its price is not shown on the page.
  - The RM price as published, for the one Malaysian paid course: SST, normal price RM1,318.
  - `null` when no price is published: 3 Coursera courses without free enrolment, and the BSI course.
  - No course was priced only in USD, so no currency conversion was used. If one is added, convert at a fixed, stated rate and note it here.
- **`hrdClaimable`:** `false` for every course. The SST provider shows an HRD Corp programme number on its own page, and BSI says its course is HRD Corp claimable. Neither could be confirmed on an official HRD Corp page, so we do not claim it.
- **Not fetched:** learning.sap.com, because its robots.txt disallows automated access.

## 5. Malaysian labour context (`db/seed/dosm.json`)

- **Source:** Department of Statistics Malaysia (DOSM), via the data.gov.my open API (https://api.data.gov.my/data-catalogue). Dataset pages are at https://open.dosm.gov.my/data-catalogue/<id>.
- **Licence:** CC BY 4.0. Each dataset page says "This data is made open under the Creative Commons Attribution 4.0 International License (CC BY 4.0)".
- **Extracts:** `wages_occupation` (wage recipients and median and mean wages by MASCO major group, 2021–2025), `lfs_qtr_sru_age` (skills-related underemployment, 2025 Q1 – 2026 Q2), `lfs_qtr_state` (Pulau Pinang labour force, 2024 Q1 – 2026 Q2) and `wages_state` (Pulau Pinang wages, 2021–2025). Rows are kept exactly as returned. Each dataset records its exact API URL and access date.
- **How it could inform demand:** as a coarse prior, for example the trend for the clerical group versus professionals and technicians, plus Penang context for the persona.
- **Limits:**
  - MASCO major groups are much broader than our catalogue.
  - Wage-recipient counts measure employment, not vacancies.
  - No dataset on data.gov.my or OpenDOSM gives employment or vacancies by detailed occupation, or occupation by state.

## 6. Employers (`db/seed/employers.json`): sample only

The two employers, "Sample Green Reporting Co. (sample)" and "Sample Finance Analytics Hub (sample)", are fictional, with `source: "sample"` and `verified: false`. Their requirements are invented variations on the catalogue, for example the ESG employer also wants life-cycle assessment at level 2. We deliberately do not attach requirements to real company names. Real employer requirements come only from the careers-page extractor, which records a verbatim quote and a source URL, or from the employer form.

---

## 7. Added in the final round (29–31 Oct 2026)

| File | What it holds | Source and licence | Real or derived |
|---|---|---|---|
| `db/seed/learning.json` | 45 hand-picked learning resources for 17 skills, 38 of them free (videos, Microsoft Learn modules, guides, books). Every URL was opened and checked on 30 Oct 2026; videos were also checked with YouTube oEmbed | Providers include YouTube channels (e.g. Association for Financial Professionals), Microsoft Learn and Support, NIST AI Resource Center, GHG Protocol, IFRS Foundation, The IIA, ACCA, WBCSD/WRI, Wiley. We store only titles, facts and links | **Real** links |
| `db/seed/ai_skills.json` | 27 AI-era skills that ESCO v1.2.1 (2022, before generative AI) does not have. Each has 1–3 public sources with an exact quoted sentence | Curated by the team on 30 Oct 2026 from public sources (cited per skill) | **Real** sources; the selection is ours |
| `db/seed/ai_skills_links.json` | For each AI-era skill: its 10 nearest ESCO skills (bge-m3 cosine) and the ESCO occupations where it applies (O\*NET tasks with GPTs-are-GPTs β ≥ 0.4) | ESCO v1.2.1 (CC BY 4.0), O\*NET, Eloundou et al. (MIT); built by `scripts/link-ai-skills.ts` | **Derived** |
| `db/seed/onet_dwa.json.gz` | O\*NET Detailed, Intermediate and Generalized Work Activities linked to task statements | O\*NET 30.2 Database (CC BY 4.0, USDOL/ETA); built by `scripts/discover-bridges.ts prepare` | **Real** |
| `db/seed/esco_skill_network.json.gz` | Relatedness between ESCO skills: √(co-occurrence across ESCO occupations × bge-m3 similarity), top-k per skill | ESCO v1.2.1; built by `scripts/build-skill-network.ts`, checked by `scripts/validate-skill-network.ts` | **Derived** |
| `db/seed/esco_bridges.json.gz` | Bridges between skills in different fields, from shared O\*NET work activities (hierarchical soft cosine). Shown only after review | O\*NET 30.2 via the ESCO–O\*NET crosswalk; built by `scripts/discover-bridges.ts`, checked by `scripts/validate-bridges.ts` | **Derived**, reviewed |
| `db/seed/esco_transversal.json` | IDs of 86 transversal ESCO skills (reuse level 1), kept out of key steps | ESCO v1.2.1 skill data (reuse level field only, not the CC BY-SA transversal hierarchy) | **Real** |
| `db/seed/quiz_tasks.json` | 4,017 O\*NET tasks for the no-CV quiz, with ESCO links and short chips in English and Bahasa Melayu | O\*NET (CC BY 4.0), ESCO v1.2.1; chip wording rewritten by an LLM from the task statement only | **Real** links, LLM-worded chips |
| Sample HR team (`server/seed/hr.ts`) | Team members for the opt-in HR progress view | Created for the project | **Sample**, labelled |
| SDG tags (`shared/sdg.js`) | A goal and a one-line reason for every ESCO job and skill (topic words, then ISCO-08 group) | Our rule; UN SDG names and colours; official icons in `web/assets/sdg/` | **Rule-based**, reasons shown |

---

## Required attributions

- **ESCO:** "This service uses the ESCO classification of the European Commission." We modified it: we selected and mapped concepts to our own catalogue and kept a subset of the alternative labels. (ESCO v1.2.1)
- **O\*NET:** "This product includes information from O\*NET OnLine and the O\*NET Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. O\*NET® is a trademark of USDOL/ETA. HalaTuju has modified all or some of this information. USDOL/ETA has not approved, endorsed, or tested these modifications."
- **ESCO–O\*NET crosswalk:** "ESCO–O\*NET Crosswalk (Occupations), v1, ESCO Secretariat in collaboration with the U.S. Department of Labor/Employment and Training Administration, 2022."
- **ILO (CC BY 4.0):** Gmyrek, P., Berg, J., Kamiński, K., Konopczyński, F., Ładna, A., Nafradi, B., Rosłaniec, K., Troszyński, M. *Generative AI and Jobs: A Refined Global Index of Occupational Exposure.* ILO Working Paper 140. Geneva: International Labour Office, 2025. © ILO. Changes made: we took occupation-level means from Annex Table A1 and mapped them to our catalogue via ESCO and ISCO-08. This is an adaptation of a copyrighted work of the International Labour Organization (ILO). It has not been prepared, reviewed or endorsed by the ILO and should not be considered an official ILO adaptation. The ILO disclaims all responsibility for its content and accuracy. Responsibility rests solely with the author(s) of the adaptation.
- **Anthropic Economic Index:** dataset `Anthropic/EconomicIndex` on Hugging Face. The README says "Data released under CC-BY, code released under MIT License", and the dataset card's licence field says MIT. Cite: Massenkoff, M. & McCrory, P., "Labor market impacts of AI: A new measure and early evidence", Anthropic, 5 Mar 2026 (observed exposure). Massenkoff, M., Lyubich, E., Sacher, S., Hitzig, Z., Zhang, S., Heller, R. & McCrory, P., "Anthropic Economic Index report: Cadences", Anthropic, 26 Jun 2026 (usage data). Changes made: we selected rows and mapped them to our catalogue via O\*NET-SOC, and computed the percentile rank.
- **GPTs are GPTs (MIT licence):** Eloundou, T., Manning, S., Mishkin, P. & Rock, D. (2024). *GPTs are GPTs: Labor market impact potential of LLMs.* Science 384(6702). Data from github.com/openai/GPTs-are-GPTs.
- **DOSM (CC BY 4.0):** "Source: Department of Statistics Malaysia (DOSM), OpenDOSM / data.gov.my." The extracts are unmodified rows, filtered to small subsets.
- **Courses:** course titles, durations and prices belong to their providers (Coursera and partner universities, Microsoft, IFRS Foundation, GHG Protocol, BSI Group, Wanfah Prosper). We store only facts and links.
