# CV benchmark: annotation guidelines

The answer key for `eval/cv/cases/*.txt` is `labels.json`. It was written **blind**: the annotator read only
`db/seed/knowledge.json` (skill ids, labels and tasks; occupation ids), `db/seed/esco_map.json` (ESCO descriptions),
`README.md` and the hackathon rules. No system code, prompts, tests or outputs were opened.

All 14 people are fictional. Names, emails (`example.com` / `example.my`), `555` phone numbers, MyKad numbers and
addresses are invented. Company names are fictional except public bodies named only as context (BNM, Bursa, polytechnics, UiTM).

## Skill labels

- **required**: the CV shows the person actually **did** the skill, in an experience bullet, project or responsibility.
  Each has an exact `quote` (a substring of the file, typos included) and a level range.
- **acceptable**: arguable. The skill is only named in a skills or summary list, mentioned vaguely, done with
  help, or a near-neighbour of the catalogue skill. Outputting it or leaving it out is not penalised.
  Optional `levelMax` (an extension to the format): if the system outputs the skill above this level, count it as
  a level error. This is how keyword-stuffed skills are checked: listed-only skills are capped at 1–2.
- **anything else is a false positive.**

The test is what the person *did*, not which words appear. A skill described only indirectly still counts as
required (for example "Menyelaras penyata vendor dengan lejar" = recon).

## Levels (1–5)

1 knows what it is · 2 does it with help / under review · 3 does it on their own · 4 handles hard cases, approves,
trains others · 5 improves how it is done (redesigns the process, owns it across teams).
Each range is usually 2 wide (e.g. 2–3) to reflect real uncertainty from a CV. Signals used: "assist/bantu" → ≤2;
"prepare … for approval" → 2–3; "approve / release / train / escalation point" → 4; "redesigned, adopted across
teams" → 5.

## Confusions decided on purpose

| Pair | Decision |
|---|---|
| recon vs bank / GL / intercompany recon | Only **vendor statement ↔ ledger** work is required recon. Bank, GL and sub-ledger recons are *acceptable* near-neighbours. Till cash-up variance (c10) is **not** recon. |
| audit vs audit2 | Collecting evidence for or answering auditors = **audit**. Testing controls and reporting findings = **audit2**. Supporting auditors never earns audit2 (c01, c02, c13). |
| three vs receiving check | Checking a delivery against the PO and signing the GRN without an invoice (c10) is only *acceptable*. Auditing a 3WM override (c04) is **not** three. |
| procure vs dispute vs ordering | Comparing quotes, negotiating and evaluating suppliers = procure. Ordering spare parts (c12) is **not** procure. Settling short-delivery issues with suppliers is *acceptable* dispute. |
| treasury vs cash handling | Corporate cash position and forecasting = treasury. Till cash and "Treasurer" of a temple, surau or society are **not** treasury. |
| excel vs viz | Pivot reports = excel. A dashboard others use (Power BI) = viz. Being listed is not enough for either. |
| sql vs "SQL Accounting" | "SQL Accounting" (c09) is a Malaysian accounting package. It is **not** evidence of SQL and not acceptable. |
| ghg / lca / disc via a consultant | Only "provided data", "helped collect" or "contributed text" → *acceptable*, not required (c03 lca, c14 ghg/disc). |
| inventory in non-finance jobs | Ward consumables (c11) and parts log (c12) stock checks → *acceptable* invent at a low cap. They are incidental, not analytics. |

## Occupation

`expectedOccupation` is the **current** job mapped to the closest catalogue occupation. `ap` is the only current-job
id for clerical AP work, including an AP team lead (c13). `acceptableOccupations` lists other ids a reasonable
reader could defend. Judgement calls:
- c03: finance executive who spends half her time on sustainability → `faRole`, `esgRole` acceptable.
- c09: fresh graduate, internship only, no current job → `other`, `ap` acceptable.
- c10: retail supervisor whose headline says "aspiring … Accounts Payable" → `other`, because the aspiration is not the current job.
- c13: AP lead already running AI invoice tools → `ap`, `stayRole` acceptable.

## Personal details

`plantedPii` lists every planted personal string exactly as it appears: names (including lower-case footers),
emails, phones, MyKad, addresses, date of birth, age, gender, race, religion, marital status, nationality,
expected salary, religious-group roles and referee names/phones. A scrubber should remove or mask every one.
Professional URLs (LinkedIn, GitHub) are included because they identify the person.
