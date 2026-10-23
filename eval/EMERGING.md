# Emerging-skill benchmark

Can the Job Market Researcher's emerging-skill committee find work skills that ESCO does not have? We ran it once for real, on a separate database, and checked every result by hand.

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

## How to reproduce

```
PGLITE_DIR=data/pglite-bench EMBED_PROVIDER=runpod SUPABASE_URL= SUPABASE_ANON_KEY= SCOUT_SCHEDULE=off DEMO_MODE= npx tsx scripts/bench-emerging.ts
```

The script refuses to run unless `PGLITE_DIR` contains "bench". It writes `eval/results/emerging-run-latest.json` (pass another path as the first argument to keep older runs). It uses the RunPod key and endpoint from `.env`; the first call can take a minute while a worker starts.
