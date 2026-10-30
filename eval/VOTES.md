# Agent vote: replay accuracy

**Agents agreed with the human on 1 of 1 signals a person had already decided.** That is a very small sample (Y = 1), so it says almost nothing about accuracy. It shows the script works and what data exists today. It is not evidence that the vote is right.

- Date: 2026-10-30
- Script: `scripts/eval-votes.ts`, data: `data/pglite` (a local PGlite folder, copied before reading)
- Models: main `gemini-3.5-flash-lite`, reviewer `gemini-3.1-flash-lite`; models that actually answered: `gemini-3.1-flash-lite`, `gemini-3.5-flash-lite`
- Roles: evidence checker and sceptic on the reviewer model, skill matcher on the main model; 3 calls per signal (12 calls in this run)
- Rule tested: 2 or 3 of 3 include = auto-apply; 1 of 3 = a person decides; 0 of 3 = reject. "Agree" means: the person approved and the agents would auto-apply, or the person rejected and the agents would not auto-apply.
- Limit: the database keeps the quote, not the page, so the voters saw the quote as the page excerpt. In the live pipeline they also see the text around the quote.

## Human decisions found

35 real and sample signals with a quote and a source link in the folder. Counted: **1**.

| Signal | Human | Why it counts | Agents (evidence, skill, sceptic) | Agents would | Agree |
|---|---|---|---|---|---|
| #34 Microsoft named a Leader in the 2026 Gartner® Magic Quadrant | include | approved by admin | include 0.95, include 0.95, exclude 0.90 | auto-apply | yes |

## Confusion breakdown

| Human \ Agents would | auto-apply | flag (split) | reject | no vote (flag) |
|---|---|---|---|---|
| approved (include) | 1 | 0 | 0 | 0 |
| rejected (exclude) | 0 | 0 | 0 | 0 |

Humans rejected: 0. Humans approved: 1. A rejection count of 0 means the false-approve rate (a bad signal the agents would let through) cannot be measured at all yet.

## Reasons the agents gave

**#34**
- evidence (gemini-3.1-flash-lite): include, 0.95. The quote explicitly describes an AI agent performing the core tasks of vendor reconciliation, such as identifying ledger exceptions and suggesting resolutions.
- skill (gemini-3.5-flash-lite): include, 0.95. The quote directly discusses AI agents automating the reconciliation of accounts and identifying exceptions between ledgers, matching the tasks of vendor reconciliation.
- sceptic (gemini-3.1-flash-lite): exclude, 0.90. The claim relies entirely on a vendor's marketing material describing its own product features rather than evidence of actual industry-wide adoption or impact.

## Not counted

| Signal | Reason |
|---|---|
| #67 Invoice capture FAQ - Finance / Dynamics 365 / Microsoft Lea | still waiting for a person |
| #68 Invoice capture FAQ - Finance / Dynamics 365 / Microsoft Lea | still waiting for a person |
| #69 Set Up Payables Agent in Business Central - Business Central | still waiting for a person |
| #70 Business Central AI - Business Central / Microsoft Learn | still waiting for a person |
| #71 Business Central AI - Business Central / Microsoft Learn | still waiting for a person |
| #72 Business Central AI - Business Central / Microsoft Learn | approved, then undone (Undone in version 3 by e2e-test): an undo, not a judgement of the evidence |
| #73 Payables Agent Frequently Asked Questions - Business Central | still waiting for a person |
| #100 An Integrated ABC–VED, Machine-Learning Forecasting, and Opt | still waiting for a person |
| #101 Bill, Billtrust, Visa pilot AI payments without human authen | still waiting for a person |
| #102 Senior AI Scientist – Business Intelligence at Intuit | still waiting for a person |
| #103 Senior AI Scientist – Business Intelligence at Intuit | still waiting for a person |
| #104 Senior AI Scientist – Business Intelligence at Intuit | still waiting for a person |
| ... and 22 more | same reasons (pending, rules-applied or rejected by rules) |

Counts by reason: still waiting for a person: 31; approved, then undone: 1; applied by rules, never checked by a person: 2.

## Not scored: what the vote says about signals no person has decided

| Signal | Status today | Agents (evidence, skill, sceptic) | Agents would |
|---|---|---|---|
| #35 Microsoft named a Leader in the 2026 Gartner® Magic Quadrant | still waiting for a person | include, include, exclude | auto-apply |
| #36 Build the future of agentic ERP with new Microsoft Dynamics  | still waiting for a person | include, include, exclude | auto-apply |
| #37 Microsoft named a Leader in the 2026 IDC MarketScape for AI- | still waiting for a person | exclude, include, exclude | flag (split) |

These are not part of X of Y: nobody has said whether they are right.
