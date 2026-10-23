# HalaTuju API contract

All routes are under `/api`, JSON in and out. Errors are always `{ "error": { "code", "message", "details?" } }` with a proper HTTP status.
Common query parameters: `profile` (int, default `1` = demo persona), `year` (2026–2030, default 2026), `scenario` (`moderate` | `fast`), `mode` (`fastest` | `noregret` | `safest`).
Weeks in responses are **at the user's own pace** (`displayWeeks(weeks, hours)`) unless the field name ends in `Ref` (reference 6 h/week).
**Accounts.** When `SUPABASE_URL` and `SUPABASE_ANON_KEY` are set, the browser signs in with Supabase Auth and sends `Authorization: Bearer <access token>`; the server checks it with Supabase on every request (cached for a minute). Then:
- Any request that names a profile (`/profile/:id…`, `/esco/profile/:id…`, `?profile=`, body `profileId`, or `/plans/:id/send|route-update`) must come from that profile's owner: **401** `sign_in_required` when signed out, **403** `forbidden` for someone else's profile. The sample persona (profile 1) stays open to everyone. Users with a staff role may read, not change, any profile.
- `POST /profile/intake` needs a signed-in user; the new profile is linked to the account (one per account: a new intake replaces the old profile).
- A token that is invalid or expired gives **401** `invalid_session`.

Without those variables the app is an open demo: no sign-in, and profile routes are not checked.

**Staff routes.** 🔒 = admin role, 🧑‍🏫 = advisor role (admins count as advisors). Roles come from the `ADMIN_EMAILS` / `ADVISOR_EMAILS` allow-lists. Without the role: **401** when signed out, **403** when signed in. The `x-admin-token` header (when `ADMIN_TOKEN` is set) also opens every staff route, for scripts and tests. With neither accounts nor `ADMIN_TOKEN` configured, staff routes are open (local demo). The audit log records the signed-in user's email as the actor (otherwise `x-actor`, default `admin`).

## Accounts (`server/routes/account.ts`, `server/lib/auth.ts`)
| Method & path | Response |
|---|---|
| `GET /config` | `{ auth:{ enabled:true, url, anonKey } }` or `{ auth:{ enabled:false } }` (the anon key is public by design) |
| `GET /me` | `{ authEnabled, user:{id,email}\|null, roles:['admin'\|'advisor'], profileId\|null }` |
| `DELETE /me/data` | signed in only: deletes the account's profile and everything linked to it (skills, ESCO skills, plans, snapshots, audit entries) → `{ profileId, deleted, plans }`. The sign-in account itself stays |
Anything not from a real source carries `source: "sample"` (or `isSample: true`) so the UI can label it.

## Foundation (done)
| Method & path | Response |
|---|---|
| `GET /health` | `{ ok, kbVersion, demoMode, db:{ok,kind}, llm:{ok,configured,models:{main,reviewer},keys,lastError}, embed:{ok,provider,model,configured}, scheduler:{enabled,intervalHours,lastScout}, time }` |
| `GET /graph?kb=latest\|<n>` | `{ kbVersion, kbNote, kbCreatedAt, nodes:{id:{name,type:'occupation'\|'skill'\|'job', e:[3], d:[3], emerging?:{status,...}, stay, blurb, postings, conf, split, sdg, source, sourceUri, tasks:[{text,mode}], aliases, angle, outlookSource}}, edges:[{from,to,weeks,why,kind}], req:{job:[{skill,weight,need,share,status,source}]}, sectors:[{id,name,icon,note,jobs}], courses:{skill:[{id,title,provider,url,format,formatText,hours,costRm,hrdClaimable,practice,prove,source}]}, deltas:{e,d}, appliedChanges:[...], sdgs, thresholds }` |
| `GET /kb/versions` | `{ versions:[{id,createdAt,note,actor,changes}] }` |

The browser runs the same engine (`/shared/engine.js`, ES module) on `/graph` + the profile for instant slider feedback. Server results are authoritative.

## Profile & intake (intake agent — `server/routes/profile.ts`)
| Method & path | Body / query | Response |
|---|---|---|
| `POST /profile/intake` | multipart field `cv` (PDF ≤ 5 MB) **or** JSON `{ text }` (paste, ≤ 30k chars); optional `hours` | `{ profileId, profile, draft:{ occupation:{id,title,confidence,matchedFrom}, skills:[{skillId,label,level,confidence:'cv',evidence}], unmatched:[phrase] }, questions:[{id,text,skillId?,field?,options:[{value,label}]}], scrubbed:{removed:[kind]}, providers:{llm,embed,matching:'semantic'\|'basic'} }` |
| `POST /profile/:id/answers` | `{ answers:{ [questionId]: value } }` | `{ profile }` (answered skills become `confidence:'self'`) |
| `GET /profile/:id` | | `Profile` (see `server/repo.ts`) |
| `PUT /profile/:id` | any of `{displayName,hours,budgetRm,targetDate,sdgPriority,lang,occupationId}` | `{ profile }` |
| `PUT /profile/:id/skills` | `{ skills:[{skillId,level}] }` (level 0 removes) | `{ profile }` |
| `GET /skills/:skillId/check?profile=` | | `{ checkId, skillId, questions:[{id,text,options:[string]}] }` (no answers) |
| `POST /skills/:skillId/check` | `{ profileId, checkId, answers:{[qid]:optionIndex} }` | `{ passed, score, total, confidence, profile }` (pass → `verified`) |

## Planning (planning agent — `server/routes/plan.ts`)
| Method & path | Query / body | Response |
|---|---|---|
| `GET /map` | `profile,year,scenario,mode,sector=best\|<id>,sdg?` | `{ kbVersion, futureScore, sector, jobs:[{job,title,match,rank,outlook,weeks,risk,routeKey,sdg,stay}] }` |
| `GET /plan` | `profile,job,mode,year,scenario,employer?` | `{ kbVersion, job, mode, match, breakdown:[...], route:{legs,nodes,weeks,risk,key}, alternatives:[route], steps:[{type:'reuse'\|'upskill'\|'evolve'\|'reskill', skillId, weeks, course, learn,practice,prove}], weeksCore, weeksReady, cost:{totalRm, hrdClaimableRm, outOfPocketRm, unknownCount, items:[{skillId,title,costRm,hrdClaimable,source}]}, deadline:{targetDate, weeksAvailable, weeksNeeded, status:'on_track'\|'ahead'\|'behind'\|'none', readyBy}, humanEdge:{split:[ai,assist,human], risingSkills:[...]}, sources:[{kind,label,url,date}] }` |
| `GET /rank` | `profile,year,scenario,sdg` | SDG-aware ranking: `{ sdg, jobs:[{job, match, weeks, rank, rankWithoutSdg, sdgFit, tradeoff:{matchDelta, weeksDelta}}] }` |
| `GET /jobs/search` | `q` | `{ results:[{job,title,score,via}], unknown?:{ title, nearest:[{job,title,score}], esco?:[{uri,title}], confidence:'low' } }` |
| `GET /explain` | `profile,node` (or `job`) + scenario params | `{ text, citations:[id], removed:int, model, cached }` (fact checker drops sentences citing unknown IDs) |
| `GET /studies` | `job` | `{ job, studies:[{study,value,rawValue,note,sourceUrl,source}], spread, disagree:boolean }` |
| `POST /plans` | `{ profileId, job, mode, employerId? }` | `{ plan }` status `draft` |
| `GET /plans` | `profile` | `{ plans:[plan] }` |
| `POST /plans/:id/send` | `{ note? }` | `{ plan }` status `sent` |
| `GET /advisor/queue` 🧑‍🏫 | | `{ plans:[plan + profile summary] }` |
| `POST /plans/:id/decision` 🧑‍🏫 | `{ decision:'approve'\|'changes', note }` | `{ plan }` |
| `POST /plans/:id/route-update` | `{ action:'keep'\|'switch' }` | `{ plan }` (after a knowledge change offered a new route) |
| `GET /profile/:id/history` | | `{ snapshots:[{kbVersion,futureScore,createdAt,changed:[...]}] }` |

## Knowledge pipeline (knowledge agent — `server/routes/knowledge.ts`)
| Method & path | Body / query | Response |
|---|---|---|
| `POST /scout/run` 🔒 | `{ sources?:['gdelt','hn','arxiv','openalex','rss','websearch'], nodes?:[id], replay?:bool }` | `{ runId, status:'ok'\|'failed'\|'replayed', replayed, counts:{fetched,candidates,rejected,auto,flagged,duplicates}, signals:[signal] }` |
| `GET /scout/runs` | | `{ runs:[{id,kind,status,trigger,startedAt,finishedAt,summary}] }` |
| `GET /sources` | | `{ trusted:[{domain,kind,why}], linkOnly:[{name,url,why}], policy:[string] }` |
| `GET /review` 🔒 | | `{ pending:[signal], emerging:[candidate], handled:[signal\|candidate], spotcheck:[signal], counts }` |
| `POST /review/signals/:id/approve` 🔒 | `{ note? }` | `{ kbVersion, rerouted:[{profileId,job,from,to}], signal }` |
| `POST /review/signals/:id/reject` 🔒 | `{ note? }` | `{ signal }` |
| `POST /review/emerging/:id/confirm` 🔒 | | `{ kbVersion, candidate }` |
| `POST /review/emerging/:id/reject` 🔒 | | `{ candidate }` |
| `POST /review/spotcheck/:id` 🔒 | `{ ok:boolean, note? }` | `{ signal }` |
| `POST /kb/versions/:id/undo` 🔒 | | `{ kbVersion }` (new version that reverts that version's changes) |
| `POST /committee/run` 🔒 | `{ replay? }` | `{ runId, candidates:[candidate] }` |
| `GET /signals` | `node?` | `{ signals:[applied signal with source] }` (feeds "Why this number?") |

Extras: `GET /scout/runs/:id` (run + its signals), `GET /sources/log` (fetch log: url, status, time, hash, short excerpt — never full pages).
A scout or committee run that fails outright returns **502** `{ error:{ code:'scout_failed'|'committee_failed', message, details:{ runId, summary } } }`; a partial failure stays 200 with per-source status in `sources:{name:{ok,items,errors,skipped}}`.

`signal` = `{ id, nodeId, nodeName, kind, title, deltaE, deltaD, quote, sourceUrl, sourceTitle, sourceDate, nSources, reviewer:{supports,confidence,issue}, triage, triageReasons:[string], status, usersRerouted, needsSpotcheck, decidedBy, decidedAt, kbVersion, isSample }`

## Employers & HR (planning agent — `server/routes/employers.ts`)
| Method & path | Body / query | Response |
|---|---|---|
| `GET /employers` | | `{ employers:[{id,name,sector,careersUrl,source,verified,jobs:[job]}] }` |
| `GET /employers/:id` | | `{ employer, requirements:[{occupationId,skillId,weight,levelNeeded,quote,sourceUrl,sourceDate}] }` |
| `POST /employers` | employer form `{ name, sector, careersUrl?, requirements:[{occupationId,skillId,weight,levelNeeded}] }` | `{ employer }` source `employer_form`, `verified:false` |
| `POST /employers/extract` 🔒 | `{ url }` (approved careers domains only) | `{ employerName, requirements:[...with quote], rejected?:reason }` (draft, not saved) |
| `GET /employers/:id/match` | `profile,job,mode,year,scenario` | `{ match, matchCatalogue, extraStops:[skillId], plan }` |
| `GET /hr/:employerId/redeployment` 🧑‍🏫 | `year,scenario` | `{ employer, team:[{profileId,name,current,options:[{job,match,weeks,costRm,readyBy,onTime}]}], openRoles:[{job,openings,deadline}], assignment:[{profileId,job,match,weeks,costRm}], totals:{costRm, onTime, people} }` |

## Full ESCO taxonomy: "check any job" (`server/routes/esco.ts`)

| Route | Input | Output |
|---|---|---|
| `GET /esco/stats` | | `{ available, version, counts:{occupations,skills,skillLinks,occupationsWithoutIlo}, source, ilo, mycol:{occupations,escoOccupationsFlagged}, onet:{counts}, modelScores:{skills,embeddingModel,provider,iloAgreement} }` |
| `GET /esco/occupations` | `q` (2–100 chars), `limit` (≤30) | `{ results:[{id,title,isco,essential,optional,iloExposure,critical}] }` |
| `GET /esco/occupations/:id` | `profile?` | `{ id,title,description,code,isco,uri,match, counts:{essential,have,related,optional}, exposure:{ilo,model,gptsBeta,aei}, critical, malaysia:{group,year,since,medianWageRm,wageEarnersK,wageEarnersChangePct,medianWageChangePct,source,url}, onet:{code,title,match,split:{ai,tools,human},tasks:[{text,rating,core}]}, essential:[skill], optional:[skill] }` where skill = `{id,title,type,modelExposure,confirmed,basis:'have'\|'related'\|'missing',via,coverage}` |
| `GET /esco/skills` | `q`, `limit` | `{ results:[{id,title,type,modelExposure}] }` |
| `GET /esco/profile/:id/skills` | | `{ skills:[escoSkillId] }` confirmed by the person |
| `PUT /esco/profile/:id/skills` | `{ add?:[id], remove?:[id] }` | `{ skills }` (unknown ids → 400) |

## Self-trained AI-exposure model (`server/routes/exposure.ts`)
| Method & path | Body / query | Response |
|---|---|---|
| `GET /exposure/model` | | `{ trained, available, embeddingModel, activeEmbeddingModel, embeddingProvider, target, trainedOn, run:{where,gpu,time}, evaluation, measures }` |
| `POST /exposure/score` | `{ tasks:[string] }` (1–50, 3–300 chars) | `{ scores:[{task, exposure}], model }` |
| `GET /exposure/skill/:id` | | `{ skillId, name, tasks:[{task, exposure, sampleMode}], modelMean, knowledgeBase:{exposure2026, source}, model }` |
Needs bge-m3 embeddings (RunPod or local); otherwise **503** `exposure_model_unavailable`.

The sample persona (profile 1) is read-only: `PUT /profile/1`, `PUT /profile/1/skills` and `POST /profile/1/answers` return **403** `demo_profile_read_only`; a check on it is scored with `saved:false`.

## Live external APIs (all free, no key needed unless noted)
GDELT DOC 2.0 (news search), Hacker News Algolia (tech news), arXiv, OpenAlex, curated RSS feeds, ESCO API (skills/occupations), OpenDOSM / data.gov.my (Malaysian labour data). Optional: Gemini Google Search grounding (needs quota), `BRAVE_API_KEY` or `TAVILY_API_KEY` web search, RunPod bge-m3 embeddings.
Every fetch: approved domains only, robots.txt obeyed, identified user agent, rate-limited, cached, and only facts + a short quote + the link are stored. Job boards are link-only.
