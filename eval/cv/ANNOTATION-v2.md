# CV benchmark v2: annotation notes

v2 adds 36 synthetic CVs (`cases/c15-*` … `cases/c50-*`), a core-catalogue key for them (`labels-v2.json`) and an
ESCO key for all 50 cases (`esco-labels.json`). It was written **blind**, like v1. The annotator read only
`db/seed/knowledge.json`, `db/seed/esco_map.json`, `db/seed/esco_full.json.gz`, `README.md`, the hackathon rules and
the v1 benchmark (`labels.json`, `ANNOTATION.md`, `cases/c01-c14`). It opened no system code, prompts, tests or outputs.
ESCO skills were found with a small stdlib search script (title, alt labels and description), kept outside the repo.

All people are fictional. Emails use `example.com` / `example.my`, phones use `555` blocks, and the MyKad numbers,
addresses and company names are invented. Public bodies (BNM, Bursa, polytechnics, public universities) are named only as context.

## Tiers (`tier` on each v2 case)

| Tier | Cases | What it tests |
|---|---|---|
| `clean` | c15–c32 (18) | Well-formatted CVs, 250–600 words, dated roles with bullets. c18, c21 and c26 are in Bahasa Malaysia. 16 finance / supply-chain / data roles plus HR (c31) and civil engineering (c32). |
| `linkedin` | c33–c44 (12) | LinkedIn "Save to PDF" text: sidebar first (Contact, Top Skills, Languages, Certifications), a buzzword headline, short or missing role descriptions, company tenure lines and `Page x of y` footers. Top Skills are listed without evidence. Graphic design (c34) and digital marketing (c42) are outside finance. |
| `messy` | c45–c50 (6) | An OCR scan (c45), extreme keyword stuffing (c46), two-column interleave (c47, c50), a very short Manglish CV (c48) and wrapped bullets with an aspiration headline (c49). |

## Core key (`labels-v2.json`)

The rules are exactly those in `ANNOTATION.md`: `required` (with an exact quote and a level range), `acceptable`
(with an optional `levelMax` cap), and everything else counts as a false positive. The occupation rules are also the same.
The traps planted on purpose, and how they were decided:

| Trap | Cases | Decision |
|---|---|---|
| "SQL Accounting" / "SQL Payroll" packages | c15, c31, c44, c50 | Not `sql`, and not acceptable. The packages count only as weak `erp` (≤1–2). |
| Society, association or committee treasurer | c15, c21, c44, c49, c50 | Not `treasury`. |
| Ordering materials, parts or consumables | c32, c45, c48 | Not `procure`. Comparing three subcontractor quotes (c32) is acceptable ≤2. |
| Receiving check vs three-way match | c28, c45, c48 | Checking a delivery against PO/DO and signing the GRN is acceptable `three` (≤1–2). Matching an invoice to PO and GRN (c15, c45 AP role) is required. |
| Stock or WMS reconciliation vs `recon` | c18, c28 | Not `recon`. Bank, GL and intercompany recons stay acceptable near-neighbours (c16, c23). |
| audit vs audit2 | c16, c21, c37, c43, c47 | Answering or supporting auditors is `audit`. Testing controls or assurance sampling is `audit2`. MSPO certification audits (c47) and RCSA (c22) are only acceptable `audit2`. |
| excel vs viz | c17, c34, c42 | Each must be shown separately. Infographics and a "Data Visualization" top skill (c34) are not dashboards (≤1). A Looker Studio dashboard the founders use daily (c42) is `viz`. |
| Payroll vs payment runs | c31 | A salary bank file is acceptable `pay` ≤2, not required. |

Occupation judgement calls:
- c16 (GL accountant) → `other`; `faRole` and `ap` are acceptable. No catalogue id fits record-to-report work.
- c24 (bank credit analyst) → `faRole`, with `other` acceptable.
- c22 (AML/compliance) → `other`, with `intAudit` acceptable.
- c35 (AP specialist reviewing AI capture) → `ap`, with `stayRole` acceptable (same reasoning as c13).
- c44 (graduate whose internship has ended) → `other`, with `ap` acceptable (as c09).
- c48 (storekeeper) → `other`, with `invRole` acceptable.
- c50 (full-set account assistant) → `ap`, with `other` acceptable.

## ESCO key (`esco-labels.json`, all 50 cases)

- A **fact** is one distinct skill or knowledge area that the CV shows the person *using*, in duties, projects or results.
  Skills that are only listed (Top Skills, skills sections, summaries, headlines) are **not** facts. Neither are
  aspirations, or "provided data to a consultant" (c03 LCA, c14 PCAF, c20 corporate GHG inventory).
- `quote` is an exact substring of the case file and sits on one line. Short quotes are used where the PDF wrapped text.
- `escoIds` lists **every** ESCO v1.2.1 skill or knowledge concept a careful reviewer would accept as a correct label for the
  fact: near-equivalents (for example *issue sales invoices* / *follow up accounts receivables* / *credit control processes*),
  not merely related concepts. Most facts have 2–4 ids. Ids are keys of `skills` in `db/seed/esco_full.json.gz`, and
  `escoTitles` follows the same order.
- The same skill gets the same id set across cases. For example, vendor-statement recon is always *identify accounting errors*,
  *check accounting records* and *perform account allocation*, and payment runs are always *carry out financial transactions*
  and *handle financial transactions*.

Gaps in ESCO and the calls made:
- ESCO has no "accounts payable", "three-way match", "GHG accounting", "RPA" or "prompting" concepts. AP work maps to the
  generic accounting-records skills. GHG maps to *measure company's sustainability performance* and *analyse environmental data*.
  RPA and Power Automate map to *automation technology* and *develop data processing applications*. AI threshold or oversight
  work maps only to *principles of artificial intelligence*.
- Facts with no defensible ESCO equivalent are left out rather than forced. Examples are drafting text with Copilot or ChatGPT
  (c13, c17) and "facilitate intake of automation ideas" (c38).
- Cash-adjacent items: teller and till work maps to *handle financial transactions*, *carry out end of day accounts* and
  *manage cash desk*. Corporate treasury maps to *manage corporate bank accounts*, *liquidity management* and *handle cash flow*.
  The two sets are not mixed.
- *process payments* (point-of-sale payment taking) is used only for cashier and teller work, never for AP payment runs.
  *negotiate settlements* (insurance claims) is never used for vendor disputes; *handle financial disputes* is used instead.
- c13 has 14 facts (a long CV); thin CVs have 2–4 facts (c09, c12, c36, c37, c40).
