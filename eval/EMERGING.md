# Emerging-skill benchmark

Can the Job Market Researcher's emerging-skill committee find work skills that ESCO does not have? We ran it for real, on a separate database, and checked every result by hand.

This file has two parts: **After the fix** (24 Oct 2026, 04:00, the shipped committee after the changes below) and the original benchmark (24 Oct 2026, 02:11), which found the problems.

## After the fix (24 Oct 2026)

**Runs:** three runs of the shipped `runCommittee()` back to back on one separate database (`data/pglite-committee`, bge-m3 on RunPod, scheduler off), 24 Oct 2026 03:59, 04:03 and 04:10 Malaysia time. The port-3000 demo server and its database were not touched. Raw output: `eval/results/emerging-run-after-fix-{1,2,3}.json`.

### What changed in the committee (`server/agents/committee.ts`)

1. **Page selection.** Sources are now web search on the trust list (Tavily, through the scout's client and `server/sources/policy.ts`), RSS, HN, arXiv and OpenAlex. Each run takes the next 3 of 12 finance / audit / accounts payable / ESG / carbon / shared services / procurement queries (`COMMITTEE_QUERIES_PER_RUN`, default 3; the three runs below were made with 4 per run, before the default was lowered). Code scores every item: it needs an AI term plus a finance / ESG word or words of a skill on our map, and work words (skills, staff, auditors...) add to the score. Pages are read best first, 24 per run, at most 4 per organisation, and a page read in the last 14 runs is not read again. The vetted-domain policy is unchanged.
2. **ESCO duplicate check.** Every candidate is compared with all 13,939 ESCO skills (bge-m3 int8 vectors) and our catalogue. Same name or alternative label, or cosine 0.85 or more, makes it an alias, and the ESCO match is stored on the candidate. With another embedder the run logs that the vectors can't be used and falls back to a word-overlap search over all ESCO titles and labels (exact names still match).
3. **Skeptic.** It sees the 3 nearest catalogue skills (with their tasks) and the 5 nearest ESCO skills (with descriptions), each with its similarity. "duplicate" counts only if it names one of those skills; otherwise it judges the evidence: product name, not a person's skill, hype, weak evidence, or keep.
4. **Accumulation.** Mentions (quote, URL, date, organisation) are stored per candidate across runs; a page is counted once even under URL variants (trailing slash, www., utm tags); a new wording within cosine 0.9 of a watched candidate joins it. Thresholds are unchanged (15 mentions, 5 organisations, 4 weeks, growing, linked) plus one explicit rule: evidence from a single run never passes. The scheduler now runs the committee after every daily scout (it ran weekly), and the admin queue shows these candidates as "Watching: 1 of 15 mentions, 1 of 5 organisations, 1 of 4 weeks" with no Confirm button.

### Funnel

| Step | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Queries | AI skills accountants; AI agents finance teams skills; generative AI accounts payable invoice; AI audit skills | AI sustainability reporting ESG; AI carbon accounting; AI shared services finance operations; AI finance jobs new skills | AI CFO finance talent; AI tax accountants; AI procurement skills; AI governance finance controls |
| Items collected (Tavily / RSS / arXiv; HN 0, OpenAlex rate limited) | 353 (40 / 288 / 30) | 329 (39 / 288 / 2) | 329 (40 / 288 / 1) |
| Items relevant | 153 | 125 | 129 |
| Skipped, read by an earlier run | – | – (rule added after run 2) | 19 |
| Pages read | 24 | 24 | 24 |
| Proposals from the AI / quote found / words in text | 10 / 10 / 9 | 11 / 11 / 7 | 9 / 9 / 6 |
| Distinct phrases | 8 | 7 | 6 |
| Duplicates: catalogue by code / ESCO by vector (0.85) | 0 / 0 | 0 / 0 | 0 / 0 |
| Duplicates named by the skeptic (catalogue / ESCO) | 2 / 0 | 1 / 0 | 0 / 2 |
| Rejected by the skeptic | 3 | 4 | 2 |
| Watching (kept, below thresholds) | 3 | 2 (1 new) | 2 |
| Provisional | 0 | 0 | 0 |

After three runs the database holds 17 candidates from 18 stored mentions across 8 organisations: 6 watching, 5 merged, 6 rejected. Every watching candidate has 1 mention from 1 organisation, so none is near the thresholds, as designed. No new wording joined an existing candidate in these runs (that path is covered by tests).

Run 2 re-read most of run 1's pages (RSS repeats; "preview allocations before posting" was proposed again from the same URL and correctly not counted twice), which is why the "read before" rule was added before run 3.

The ESCO vector score never reached 0.85: the best ESCO cosine for any candidate was 0.69 (*manage standard enterprise resource planning system*). All 5 duplicates came from the skeptic naming a listed skill, which is why the skeptic now gets the nearest skills with descriptions.

### Hand check of the 6 watching candidates

We fetched each URL by hand (HTTP 200) and searched for the quote, and searched all ESCO titles and labels for the key words.

| Candidate | Source (date) | Quote at URL | Absent from ESCO? | A work skill, not a product? | Our verdict |
|---|---|---|---|---|---|
| integrate LLMs into finance workflows | TechCrunch, [Mavi bets on the AI boom](https://techcrunch.com/2026/09/28/mavi-bets-on-the-ai-boom-creating-demand-for-a-new-kind-of-accountant) (28 Sep) | Yes: "someone who can integrate LLMs into finance and accounting workflows" | Yes: no ESCO label mentions LLMs, language models or generative AI | Yes | **Right to watch.** One company spokesperson so far |
| evaluating AI-related risks | Accounting Today, [AICPA proposes valuation framework](https://www.accountingtoday.com/news/aicpa-proposes-valuation-framework) (13 Oct) | Yes: "The guidance will aid CPAs in evaluating AI-related risks, understanding how AI may affect controls..." | Yes: ESCO has ICT, network and blockchain risk skills, no AI risk skill | Yes (auditors) | **Right to watch.** The case the original benchmark's skeptic wrongly called a duplicate |
| evaluating AI financial models | Accounting Today, [AICPA practice guide for auditors dealing with AI](https://www.accountingtoday.com/news/aicpa-releases-practice-guide-for-auditors-dealing-with-ai) (14 Oct) | Yes, but indirect: "If management doesn't have the understanding of those models and the potential risks ... may indicate a lack of appropriate skill sets and competencies. The same is true for AI." | Yes: only *utilise machine learning*, *principles of artificial intelligence* | Yes | **Plausible, weak quote.** Close to the AI risk candidate above; they were not merged (cosine below 0.9) |
| preview allocations before posting | Microsoft Dynamics 365 blog (22 Oct) | Yes | Partly: *perform account allocation* covers allocations | No: a Dynamics feature ("capabilities designed to help teams ... preview allocations before posting") | **Wrong.** Should have been rejected |
| de-identifying data for AI training | Accounting Today, BizBuyData / Mode (16 Oct) | Yes: "Mode collects and de-identifies the data..." | Partly: *ensure information privacy*, *data protection* | No: what a company does | **Wrong.** Should have been "not a person's skill" |
| attributing economic value across mixed workflows | arXiv 2609.32476 (26 Sep), a fiscal policy paper | Yes (in the abstract) | Yes | No: a research problem the paper names | **Wrong** |

**3 of 6 watching candidates hold up by hand** (2 clearly, 1 plausibly). The 3 wrong ones each have 1 mention, so the thresholds keep them out of the knowledge base, and a person reviews anything that passes. Hand check of the other 11: the 6 rejections are right except *Agentic AI architectures* (a Deloitte AI-architect job ad; a real skill, but an IT one outside our finance scope). Of the 5 merges, 3 are right (*reviewing automated spreadsheet outputs* and *evaluate whether AI produces reliable outcomes* as our *Supervising AI workflows*, *managing ERP operations* as ESCO's ERP skill), *digital procurement solutioning* as *use e-procurement* is roughly right, and *agent orchestration* as *Supervising AI workflows* is debatable (ESCO has nothing; our skill covers setting up AI agents, not designing multi-agent systems).

One honest caveat on method: a first run at 03:52 (same directory, which was then reset; output not kept) used an earlier skeptic prompt that said the same skill "usually scores above 0.8". That is false for short phrases (they rarely pass 0.7), and that skeptic kept all 4 candidates, including *review and manage AI tools*, which is our catalogue's *Supervising AI workflows*. We changed the prompt (the skeptic now sees our skills' tasks, and is told scores are only a hint) before runs 1 to 3, so these runs are not blind to that case.

### Cost and time

| | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| Gemini calls (proposer gemini-3.5-flash-lite / skeptic) | 12 / 8 | 12 / 7 | 12 / 6 |
| Gemini failures | 0 | 0 | 0 |
| Tavily searches | 4 | 4 | 4 |
| Page and API fetches | 57 | 71 | 68 |
| RunPod bge-m3 calls (texts, seconds) | 2 (124, 6.8 s) | 2 (126, 2.4 s) | 2 (131, 27 s, a cold start) |
| Wall time | 172 s | 165 s | 185 s |

A daily run costs about 20 Gemini calls, 4 Tavily searches (3 at the new default) and 2 RunPod calls, in about 3 minutes. With the scout's ~30 searches a day that is about 1,020 Tavily searches a month at 4 queries a run, slightly over the free 1,000; the default is now 3 a run (`COMMITTEE_QUERIES_PER_RUN`), about 990 a month.

### What still limits it

- Precision at the watching stage is about half. The skeptic still keeps product capabilities and company processes that are worded like skills.
- 4 to 6 of the 24 pages per run are weak Malaysian market news that mention AI and finance words (scores 17 to 22 against 30 to 40 for the best pages).
- The same press story on two sites (Mavi on TechCrunch and Accounting Today) would count as 2 organisations.
- At 2 to 3 new watching candidates a day with 1 mention each, reaching 15 mentions from 5 organisations over 4 weeks will take weeks of daily runs, and only for skills that many sources name in the same words (or within cosine 0.9).

### How to reproduce

```
PGLITE_DIR=data/pglite-committee EMBED_PROVIDER=runpod SUPABASE_URL= SUPABASE_ANON_KEY= DATABASE_URL= SCOUT_SCHEDULE=off DEMO_MODE= npx tsx scripts/bench-emerging.ts eval/results/emerging-run-after-fix-1.json
```

The script refuses to run unless `PGLITE_DIR` contains "bench" or "committee" and `DATABASE_URL` is empty. Run it again on the same directory to see evidence accumulate.

---

# Original benchmark (before the fix)

**Run:** 24 Oct 2026, 02:11 Malaysia time (23 Oct 18:11 UTC). 4 min 42 s. Raw output: `eval/results/emerging-run-latest.json` and `.log`.

## Headline

- **ESCO pre-check:** ESCO v1.2.1 (13,939 skills) has **no equivalent for any of our 5 hand-built emerging skills**. 2 have no close neighbour at all, 3 have only partial neighbours.
- **Live committee run:** read **24 trusted pages** (picked from 379 items), proposed **4 skill phrases**, all 4 with quotes we confirmed word for word at the cited URL. It accepted **0**: the skeptic judged all 4 to be duplicates. By hand we think 3 of those rejections are right and 1 (*evaluating AI-related risks*) is probably wrong: ESCO has no AI risk skill.
- A single run can never make a skill provisional: the thresholds need 15 mentions from 5 organisations over 4 weeks. Every candidate here had 1 mention.

## 1. ESCO pre-check (our 5 "no ESCO equivalent" skills)

Method: text search of all ESCO titles, alternative labels and descriptions (prompt, generative, artificial intelligence, AI, machine learning, LLM, chatbot, automation, greenhouse, emission, carbon, footprint, sustainability reporting, invoice, purchase order, three-way, reconcile, payable, and others), plus bge-m3 vector search over the ESCO skill index (RunPod).

| Our skill | Closest ESCO skills | Verdict |
|---|---|---|
| Prompting AI tools for finance (`prompt`) | *utilise machine learning*, *principles of artificial intelligence* (theory, not tool use). No ESCO label mentions prompts for AI, generative AI, LLMs or chatbots ("prompt" only appears in theatre and first-aid skills) | **None** |
| Supervising AI workflows (`aisup`) | *principles of artificial intelligence* (knowledge), *monitor automated machines* (factory machinery), *manage workflow processes* | **None** (only distant neighbours) |
| AI invoice review & exceptions (`aiinv`) | *perform account allocation* (match transactions to invoices), *process payments*, *issue sales invoices*. Nothing on checking AI-captured data | **Partial** (the invoice work exists, the AI review part does not) |
| GHG emissions accounting (`ghg`) | *measure company's sustainability performance*, *lead the sustainability reporting process*, *global standards for sustainability reporting*, *advise on carbon emissions reduction* (advice). No "greenhouse gas" or "carbon accounting" skill | **Partial** (reporting neighbours, no emissions accounting) |
| Three-way matching (`three`) | *perform account allocation*, *issue purchase orders*, *receive kitchen supplies* (alt label "reconcile delivered kitchen items with items ordered") | **Partial** (pieces exist, no PO / receipt / invoice match) |

Vector search agrees: the best bge-m3 cosine for each of the 5 is only 0.51 to 0.60 (the duplicate threshold is 0.85). Top hits: *use business simulation tools* 0.545, *manage workflow processes* 0.595, *issue sales invoices* 0.511, *advise on carbon emissions reduction* 0.535, *match vehicles with routes* 0.569.

## 2. The live run

### Why the last scheduled run (23 Oct) found nothing

Committee run 68 on the demo database collected 352 items and read 8 pages, and the AI proposed 0 skills. The 8 pages were a robotaxi story, "AI agents started playing", an Ambani/Jio IPO story, two currency stories and three Bursa market openings. The cause is page selection, not the AI, the thresholds or the duplicate check:

- The committee takes the **first 8 items, newest first**, whose text contains the word "AI" (or agent, generative, automation) anywhere.
- RSS news is always the newest, so it fills all 8 slots. The finance-focused committee queries only steer HN, arXiv and OpenAlex, whose items sort below the RSS items.
- The committee does not use Tavily web search at all.

We reproduced this exactly in phase A below: a different 8 off-topic pages (robotaxi, Gmail ads, retro gaming, PHP security, ringgit) and 0 proposals.

Two more design facts matter for any demo claim:

- **The committee's duplicate check is against our 29-skill catalogue, not ESCO.** It embeds the phrase and the catalogue names with whichever embedder is active (with `EMBED_PROVIDER=gemini` that is Gemini, which works; it is not skipped). ESCO is never consulted. The ESCO vector index (bge-m3) is only used by CV intake.
- The thresholds (15 mentions, 5 organisations, 4 weeks, growing) cannot be met in one run by design.

### What ran

Separate database `data/pglite-bench`, `EMBED_PROVIDER=runpod` (bge-m3 on RunPod, so the ESCO index works), accounts and scheduler off. The demo server on port 3000 and its database were not touched.

- **Phase A, as designed:** `runCommittee()` unchanged.
- **Phase B, focused:** the committee's own proposer prompt, word-for-word quote check, catalogue duplicate check and skeptic prompt, with three changes, all in `scripts/bench-emerging.ts`:
  1. Sources: Tavily search on trusted domains only, plus RSS, arXiv, OpenAlex, HN, with 8 finance / audit / accounts payable / ESG / carbon queries.
  2. Pages ranked by how often they mention AI terms, finance or ESG terms, and work terms (skills, jobs, teams). 24 pages instead of 8 (so 12 proposer calls instead of 4, still 2 pages per call).
  3. An ESCO duplicate check: the phrase is compared with all 13,939 ESCO skills (bge-m3, cosine 0.85 = duplicate), and the 5 closest ESCO skills, with descriptions, are given to the skeptic as "existing skills" so it can call a duplicate.
  Thresholds were not changed.

### Funnel

| Step | Phase A (as designed) | Phase B (focused) |
|---|---|---|
| Items collected from trusted sources | about 350 | 379 (Tavily 74, RSS 287, arXiv 32, HN 0, OpenAlex 0: rate limited) |
| Items mentioning AI and finance or ESG | not filtered | 114 |
| Pages read by the proposer | 8 (all off-topic) | 24 |
| Proposals that passed the quote check | 0 | 4 |
| Duplicates of our catalogue (embedding or name) | 0 | 0 |
| Duplicates of ESCO by vector (cosine 0.85 or more) | 0 | 0 (best 0.59 to 0.61) |
| Rejected by the skeptic | 0 | 4 (all "duplicate") |
| Kept by the skeptic | 0 | **0** |
| Passed the evidence thresholds | 0 | 0 (1 mention each) |
| Confirmed by hand as a skill ESCO lacks | 0 | 0 accepted; 1 rejected candidate we think should have been kept |

We cannot say how many raw AI proposals the code dropped: `propose()` returns only the ones whose quote is found word for word on the page and whose key words appear in the text.

### The 4 candidates

All 4 quotes were found word for word at the cited URL when we fetched the pages by hand (HTTP 200, exact string present).

| Candidate | Source (date) | Quote | Committee | Closest ESCO | Our hand verdict |
|---|---|---|---|---|---|
| managing AI use and expansion | Salesforce newsroom, [CFOs use AI and agents](https://www.salesforce.com/uk/news/stories/cfos-ai-agents-to-tame-revenue-complexity) (6 Oct 2026) | "Over three-quarters of finance leaders say the scope of their role increased in the last year — and managing AI use and expansion is the top-cited reason" | Duplicate of our *Supervising AI workflows* | *manage information access aids* 0.588, *utilise machine learning* 0.587 | Rejection right: it is our catalogue's `aisup`, which ESCO lacks (see pre-check). A real signal for an existing emerging skill, not a new one |
| handling the entire accounts payable process | Accounting Today, [Tipalti AI agent](https://www.accountingtoday.com/list/tech-news-tipalti-touts-ai-agent-to-manage-entire-ap-process) (23 Oct 2026) | "Payments platform Tipalti announced the launch of a new AI agent that can handle the entire accounts payable process" | Duplicate of *process payments*, *accounting department processes* | *process payments* 0.612 | Rejection right, for a better reason: this is what the AI agent does, not a human skill. Good evidence for an AI-exposure signal on AP skills |
| climate risk management | EY careers, [Sustainability & AI Consulting Assistant](https://careers.ey.com/ey/job/Luxembourg-Sustainability-&-AI-Consulting-Assistant-L-1855/1434028533) (3 Oct 2026) | "support clients in transforming their sustainability strategies, ESG reporting, climate risk management, sustainable finance, and decarbonization initiatives through data-driven and AI-enabled solutions." | Duplicate of environmental risk management | *advise on environmental risk management systems* 0.606; ESCO also has *climate change impact* (knowledge) | Rejection defensible: partial ESCO coverage, and it is an ESG skill, not an AI-era one |
| evaluating AI-related risks | Accounting Today, [AICPA proposes valuation framework](https://www.accountingtoday.com/news/aicpa-proposes-valuation-framework) (13 Oct 2026; the quote is about the AICPA AI practice guide, covered on that page) | "The guidance will aid CPAs in evaluating AI-related risks, understanding how AI may affect controls, and determining appropriate audit responses and the auditor's use of AI tools when performing the audit." | Duplicate of ICT risk management / internal audit | *identify ICT security risks* 0.600, *implement ICT risk management* 0.585 | **Probably wrongly rejected.** ESCO has no AI risk skill (it does have *recognise blockchain risks*, the same kind of skill for another technology). A real work skill for auditors, from a professional body's guidance. Still only 1 mention, so it would stay "watching" |

Precision of accepted skills: not defined (0 accepted). Hand-checked quote accuracy: 4 of 4.

## Cost (both phases)

| | Count |
|---|---|
| Gemini calls | 20 (16 proposer on gemini-3.5-flash-lite, 4 skeptic on gemini-3.1-flash-lite), 0 failures |
| Tavily searches | 8 |
| Page and API fetches | 93 |
| RunPod bge-m3 | 6 calls, 445 texts, 44.6 s wall time (about 37 s of it the cold start). Billed worker time not measured; a few cents at most |
| Wall time | 282 s |

## Limitations

- One run, one day. The committee is built to accumulate mentions over weeks, so one run tests the pipeline, not the thresholds.
- Phase B's page selection is ours (a keyword score), not the committee's. It shows what the committee does when it reads relevant pages; it is not what the shipped code does.
- The ESCO vector check is weak on its own: ESCO vectors embed title, alternative labels and description, so a short phrase rarely scores above 0.65 even against a near match. In practice the skeptic, given the 5 nearest ESCO skills, made every duplicate call. The skeptic is generous with "duplicate" (it called AI risk evaluation a kind of ICT risk management).
- OpenAlex was rate limited (HTTP 429) during phase B. HN returned nothing.
- Hand checks were done by one reviewer (this agent), not blind.

## How this was run

This run used the earlier version of `scripts/bench-emerging.ts` (phase A plus the phase B prototype, in git history before the fix). The script now runs the shipped committee; see "After the fix" above. It uses the RunPod key and endpoint from `.env`; the first call can take a minute while a worker starts.
