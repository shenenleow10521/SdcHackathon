# HalaTuju API contract

All routes are under `/api`, JSON in and out. Errors are always `{ "error": { "code", "message", "details?" } }` with a proper HTTP status.
Common query parameters: `profile` (int, default `1` = demo persona), `year` (2026–2030, default 2026), `scenario` (`moderate` | `fast`), `mode` (`closest` = Easiest start, the default | `safest`; the old names `fastest` → closest and `noregret` → safest are still accepted, for saved plans and URLs).
Weeks in responses are **at the user's own pace** (`displayWeeks(weeks, hours)`) unless the field name ends in `Ref` (reference 6 h/week).
**Accounts.** When Replit-managed Clerk is configured (`CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`), the browser signs in through Clerk (loaded via the `/api/__clerk` proxy) and the server reads the verified Clerk session. Visitors who don't sign in get a private guest session: a signed, HttpOnly `ht_guest` cookie (`SESSION_SECRET`). Then:
- Any request that names a profile (`/profile/:id…`, `/esco/profile/:id…`, `?profile=`, body `profileId`, or `/plans/:id/send|route-update`) must come from that profile's owner, signed-in account or guest browser: **401** `sign_in_required` otherwise, **403** `forbidden` for someone else's profile. The sample persona (profile 1) stays open to everyone. Users with a staff role may read, not change, any profile.
- `POST /profile/intake` links the new profile to the signed-in account, or to the guest session.
- Browser writes must come from this site (`Origin` check); other origins get **403** `cross_site_request`.

Without Clerk keys the app is an open demo: no sign-in, and profile routes are not checked.

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
| `GET /profile/:id` | | `Profile` (see `server/repo.ts`), including `currentEsco:{id,title}\|null`: the person's current job as an ESCO occupation (CV: best ESCO match of the CV's job title, rank words like "senior"/"staff" dropped, ties broken by the ESCO skills the CV shows; quiz: its top job unless the quiz is unsure). The sample persona has none |
| `PUT /profile/:id` | any of `{displayName,hours,budgetRm,targetDate,sdgPriority,lang,occupationId,currentEscoId,shareProgress}` (`currentEscoId`: an ESCO occupation uuid or null; `shareProgress`: boolean, default false: show my goal progress in my employer's HR view) | `{ profile }` (`profile.shareProgress`) |
| `PUT /profile/:id/skills` | `{ skills:[{skillId,level}] }` (level 0 removes) | `{ profile }` |
| `GET /skills/:skillId/check?profile=` | | `{ checkId, skillId, questions:[{id,text,options:[string]}] }` (no answers) |
| `POST /skills/:skillId/check` | `{ profileId, checkId, answers:{[qid]:optionIndex} }` | `{ passed, score, total, confidence, saved, profile, goalSteps:[skillId] }` (pass → `verified`; a pass on a goal step also records proof `{kind:'check', by:'HalaTuju skill check'}` on it and ticks it: `goalSteps` lists those steps, usually `[]` or `[skillId]`) |

## Goal progress (`server/routes/goal.ts`, maths in `server/services/goal.ts`)
The one job a person commits to, stored on the server (it used to live only in the browser, `web/js/features/goal.js`). Every number is computed in code from the plan and the database; no AI model is called. All routes take the optional query `year` (2026–2030) and `scenario` (`moderate`|`fast`) for the plan behind the numbers. Ownership: the usual profile rules above (owner writes; staff may read). **The sample persona (profile 1) is read-only**: its `GET` routes work (it has no stored goal: `goal:null, readOnly:true`), every write returns **403** `demo_profile_read_only`; the UI keeps the persona's goal in the browser as before.

| Method & path | Body / query | Response |
|---|---|---|
| `GET /profile/:id/goal` | | `GoalView` (below), or with no goal `{ profileId, readOnly, goal:null, match:null, weeksLeft:null, hoursPerWeek, progress:null, steps:[], checkIns, pace:null }` |
| `PUT /profile/:id/goal` | `{ job, mode? }`: `job` = catalogue job id or `esco:<uuid>` (a bare ESCO uuid also works, stored as `esco:<uuid>`); `mode` = `closest` (default) \| `safest` (old names accepted) | `GoalView`. Same job: only the mode changes (date and ticks kept). **A different job resets the ticks and `setAt` = today** (like `goal.js`); skill levels, proofs and check-ins stay. Unknown job → **400** |
| `DELETE /profile/:id/goal` | | `{ profileId, goal:null }` (ticks deleted; proofs and check-ins kept) |
| `POST /profile/:id/goal/steps/:skillId` | `{ done: boolean }` | `{ change:{ skillId, done, levelChanged, before:{match,weeks}, after:{match,weeks} }, ...GoalView }`. Ticking raises the profile (see below) so the plan recomputes; `before`/`after` are the goal plan's `match` and `weeks` (same code as `GET /plan`), for "Match 48% → 56%, 8 weeks left". Unticking undoes exactly what the tick changed. Errors: **409** `no_goal`, **404** `not_a_step` (unknown skill, or not a step of this goal), **400** bad body |
| `POST /profile/:id/goal/steps/:skillId/proof` | `{ kind:'credential', url, title, provider? }`: `url` https only, ≤ 500 chars; `title` 2–120; `provider` 2–80 (default: the link's host name) | **201** `GoalView`. Shown as "Show credential"; **never counts as verified** and does not tick the step. At most 5 per skill (**409** `too_many_credentials`). **400** for http/javascript/other links or bad lengths, **404** `not_a_step`, **409** `no_goal`. Rate-limited (20/min) |
| `DELETE /profile/:id/goal/steps/:skillId/proof/:proofId` | | `GoalView` (credentials only; checks and advisor confirmations can't be removed) → **404** otherwise |
| `POST /profile/:id/checkins` | `{ weekStart:'YYYY-MM-DD', hours:0–80 }` (any day: stored as that week's Monday; rounded to 0.1 h) | `{ checkIn:{weekStart,hours}, checkIns:[{weekStart,hours}], pace }`. One per week: a second check-in for the same week replaces it. **400** for a week that hasn't started, **409** `no_goal` |
| `GET /profile/:id/stay` | | `{ profileId, readOnly, done:[{ skillId, name, doneAt:ISO, hours\|null }] }`: the ticked skills of the "Stay AI-ready in your job" track |
| `POST /profile/:id/stay/:skillId` | `{ done: boolean }` | `{ change:{ skillId, done, levelChanged }, profileId, readOnly, done:[...] }`. The skill must be on your stay track (below) or ticked before, else **404** `not_on_stay_track`. A tick raises the profile exactly as a goal step's tick does, so My skills and every match follow; an untick undoes it. **403** on the sample persona (its stay ticks stay in the browser), **400** bad body |
| `GET /profile/:id/record` | | The skills record (below) |
| `POST /advisor/profiles/:id/goal/steps/:skillId/confirm` 🧑‍🏫 | `{ name? }` (2–80; the advisor's display name, default the signed-in email / `x-actor`) | Same as the tick: `{ change, ...GoalView }`; records proof `{ kind:'advisor', by:name }`, ticks the step and marks the catalogue skill `verified`. Not under `/profile/:id` because those writes are owner-only. **401/403** without the advisor role, **403** on the sample persona, **404** `not_a_step`, **409** `no_goal` |
| `GET /hr/:employerId/progress` 🧑‍🏫 | `year,scenario` | `{ employer:{id,name,isSample}, asOf, members:[{ profileId, name, hoursPerWeek, goal:{job,title,source,mode,setAt}\|null, match, weeksLeft, stepsDone, stepsTotal, verified, lastCheckIn:{weekStart,hours}\|null, status:'ahead'\|'on_track'\|'behind'\|null, pace }], notSharing:int, note }`. **Only team members with `shareProgress` on are listed**; the others are only counted. Unknown employer → **404** |

```
GoalView = { profileId, readOnly,
  goal: { job, title, source:'catalogue'|'esco', mode, setAt:'YYYY-MM-DD' },
  match, weeksLeft,                  // the goal plan's match % and weeks to job-ready at your hours (GET /plan's `weeks`)
  hoursPerWeek,
  progress: { done, total, verified },
  steps: [{ skillId, name, key, kind:'reskill'|'upskill'|'evolve'|null, type:'skill'|'knowledge', hours, weeks,
            done, doneAt:ISO|null, verified,       // verified = a 'check' or 'advisor' proof (credentials never count)
            proofs:[{ id, kind:'check'|'advisor'|'credential', by, at:ISO, url|null, title|null }],
            practise:[{ text, onet, occupation }] }],   // "Practise at work": 0-2 real O*NET task statements
  checkIns: [{ weekStart, hours }],
  pace: { status:'ahead'|'on_track'|'behind', setAt, today, daysElapsed, weeksElapsed, hoursPerWeek,
          expectedHours, studiedHours, differenceHours, toleranceHours, checkInsCounted, lastCheckIn:{weekStart,hours}|null },
  practiseSource }
```

- **Steps** = the goal plan's `missing` list (every skill still needed, plan order, `key` = a numbered route step), then the ticked steps that have left that list, with the hours they had when ticked. Ticking a step: a catalogue skill's level becomes the level the job needs (`levelTo` for a level-up, else the job's requirement, else 3), never lower; an ESCO skill is added to the person's ESCO skills (`source:'self'`); an AI-era skill raises its catalogue twin (`prompt`, `aisup`) to 3, and without a twin changes nothing (the step is still ticked). Passing the skill check, or an advisor's confirmation, also ticks the step and marks the catalogue skill `verified`.
- **Stay AI-ready track** (`stay_steps`, migration 74): the same track the app shows (`web/js/features/stay.js`): the missing skills of a hand-made "stay & adapt" catalogue job whose match is ≥ 40 (`STAY.catKeep`, = `CAT_KEEP` in the app), else the `stay.items` of `GET /esco/profile/:id/outlook`. A catalogue skill is raised to the level that job needs (`levelTo`, else its requirement, else 3); ESCO and AI-era skills as for goal steps. Ticks are about the job you have, so changing or clearing the goal keeps them; a ticked skill that has left the track stays listed (with its hours).
- **Proofs are kept per skill**, not per goal, so they survive a change of goal and appear on the record. A skill check proof is recorded only when the checked skill is a step of the current goal (or the catalogue equivalent of an ESCO / AI-era step).
- **On track**: `expectedHours = hoursPerWeek × daysElapsed / 7` (days since `setAt`); `studiedHours` = check-in hours from the week `setAt` falls in onwards; `differenceHours = studied − expected`; `toleranceHours = hoursPerWeek × 1` (one week of study, `GOAL_PACE.toleranceWeeks`). `ahead` if difference > tolerance, `behind` if difference < −tolerance, else `on_track`. No check-ins: on track for the first 7 days, then behind.
- **Practise at work**: for each step, up to 2 O\*NET task statements (the original text, never the LLM-written quiz chips) that pass two bars, else `[]` (an empty list beats an off-topic task). **Link**: in `db/seed/quiz_tasks.json` the task's best ESCO link is this skill (bge-m3 cosine ≥ 0.62 among the skills of the task's own occupations; `PRACTISE.escoRank` = 1), or its catalogue link is ≥ 0.70 (`PRACTISE.catLink`; the quiz's 0.68 let "Start machines, monitor operations" through for "Supervising AI workflows"); a catalogue skill also uses the ESCO skills mapped to it, an AI-era skill its catalogue twin. **Near**: the task's O\*NET occupation is the goal job's own or that of one of the goal job's 10 closest ESCO jobs (skill-overlap network, `PRACTISE.nearJobs`). The goal job's own tasks first, then core tasks, then the stronger link. Measured with `scripts/practise-report.ts` (the sample persona's four catalogue goals and five varied ESCO jobs): 126 tasks over 235 steps before, many off-topic (a grinding-machine operator's on "Supervising AI workflows", a flight attendant's on a bus driver's step); 23 after, each one a thing a person in that role does.

The skills record (`GET /profile/:id/record`), for a printable page:
```
{ profileId, name, isSample, asOf, currentJob:{id,title}, goal:{job,title,mode,setAt}|null,
  counts: { skills, verified, credentials },
  skills: [{ skillId, name, source:'catalogue'|'esco'|'ai'|'other', level:1-5|null (ESCO/AI: null),
             basis:'cv'|'self'|'quiz'|'verified'|null, evidence|null,
             held,                  // false = only a proof so far (e.g. a credential on a goal step not yet ticked)
             verified, proofs:[proof], uri|null }],      // verified first, then held, then by name
  sources: [{ kind:'catalogue'|'esco'|'ai-skill'|'check'|'credential', label, url|null }],
  note }
```

## Planning (planning agent — `server/routes/plan.ts`)
| Method & path | Query / body | Response |
|---|---|---|
| `GET /map` | `profile,year,scenario,mode,sector=best\|<id>,sdg?` | `{ kbVersion, futureScore, sector, jobs:[{job,title,match,rank,outlook,weeks,risk,routeKey,sdg,stay}] }` |
| `GET /plan` | `profile,job,mode,year,scenario,employer?` — `job` = a catalogue job id **or any ESCO occupation** as `esco:<uuid>` (a bare ESCO uuid also works) | See "The plan (`GET /plan`)" below |
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

### The plan (`GET /plan`)

Same shape for catalogue jobs and ESCO jobs (ESCO jobs leave out the catalogue-only fields marked ¹):

```
{ kbVersion, job, source:'catalogue'|'esco', title, mode:'closest'|'safest', year, scenario, hours,
  match,                                   // %; ONE rule for every job ("Match = how much of what the job needs you already have"):
                                           // catalogue jobs over their requirements (engine), ESCO jobs over their ESSENTIAL skills:
                                           // have 1, a close skill up to 0.5 (skill network / bridge relatedness), knowledge weight 0.5
  route: { key, nodes:[you, ..., job], risk, weeks, weeksRef,
           legs:[{ from, to, toName, kind:'own'|'build'|'evolve'|'bridge', why, weeks, weeksRef, rel, bridge }],
           names?: { [nodeId]: name } },   // ESCO jobs: names for every route node (ESCO skill ids are uuids)
  keySkills: [id],                         // the new skills on the route (ESCO jobs: 3-5 key stepping stones)
  missing: [{ id, name, type:'skill'|'knowledge', key, group, groupName, estimated, hours, weeks, rel, exposure,
              kind?, levelFrom?, levelTo?, course?, uri?,
              aiEra?, exposureNote?, description?, catalogue?, sources? }],   // EVERY skill still needed; group = the key skill it belongs to
                                           // AI-era skills (ESCO jobs): id 'ai:<slug>', basis 'emerging', aiEra:true, exposure:null,
                                           // exposureNote 'AI-era skill: grows with AI', sources:[{publisher,title,url,date}]
  emerging?: [{ id, name, description, category, aiEra:true, exposure:null, exposureNote, catalogue, sources, have }],
                                           // ESCO jobs: the AI-era skills this job now asks for (not in ESCO 2022, not in the match)
  weeks,                                   // THE one figure: weeks to job-ready at your hours, from all of `missing`
  weeksReady, weeksReadyRef¹, weeksEstimated, totalHours,
  saferAlternative: null | { mode:'safest', route, keySkills,
      avoids:[{ id, name, owned, exposure, aiSharePct, reason:'signal'|'exposure', exposureSource?:'model'|'knowledge-base',
                signal:{title,sourceUrl,kbVersion}|null }],
      adds:[{ id, name }], weeks, addedWeeks },   // only when mode=closest, the safest route is a different road AND it avoids
                                                  // a skill AI does a lot of (see below); avoids lists only those skills
  breakdown¹, alternatives¹, steps¹, humanEdge¹, cost, deadline, sources:[{kind,label,url,date}],
  uri?, escoId?, counts? }                 // ESCO jobs: the occupation's ESCO URI (also in sources); counts.emerging = AI-era skills
```

- **Route order = relatedness** ("start from what you know"), not time: edge cost `0.1 + (1 − relatedness)` + an AI-exposure term (closest: `5 × max(0, e − 0.5)²`; safest: `6 × max(0, e − 0.35)²`). Hand-made edges have relatedness `4 / (4 + weeks)`. Taken-over skills stay closed roads.
- **ESCO jobs** route over a hybrid network: the ESCO skill network (`server/services/skill-network.ts`) within a field, plus the hand-made catalogue edges and any data bridge a person approved (review queue below) as cross-field bridges (`kind:'bridge'`). Proposed (unreviewed) bridges are never used, in routes or the match. Key skills are picked from the job's missing practical skills by distinctiveness (idf), closeness to your skills and future relevance (1 − exposure). Knowledge items are never route stops; they are in `missing` and the time.
- **Time** (`missing[].hours`): a real course's hours when a course of at least 6 h is listed, else an estimate (`estimated:true`) that grows with distance from your nearest skill. Catalogue: `12 + 36 × (1 − rel)` h, raising a skill you have = 6 h per level. ESCO items (finer-grained): `(6 + 24 × (1 − rel))` h for a skill, `(4 + 12 × (1 − rel))` h for knowledge, × `(0.4 + 0.6 × idf)` (common skills are quicker), × `(1 − 0.5 × relatedness to its key skill)` for non-key items. `weeks = round(totalHours / hours_per_week)`.
- **Safer route** (`saferAlternative`) is offered only when a skill on the default road is one AI does a lot of — our model's exposure ≥ 0.6 for an ESCO skill, the knowledge base's exposure ≥ 0.5 for a catalogue skill (`PARAMS.saferMinExposure`), or an approved signal raised it — and that skill is at least 0.1 (`PARAMS.saferMinGain`) more exposed than every skill on the safer road. Otherwise `null`. `aiSharePct` = round(100 × exposure), for "AI can do 62% of this work".
- **AI-era skills** (`server/services/ai-skills.ts`, `db/seed/ai_skills.json`): 27 sourced skills ESCO doesn't have, attached to ESCO jobs whose computed link score is ≥ 0.5, minus generic hubs and hand-checked wrong pairs (`GET /ai-skills` lists them). In the route network they link to their nearest ESCO skills. No exposure number: never "at risk", never penalised, left out of `route.risk`, and the safer route's future-relevance term favours them (at most one is a key skill). A catalogue skill that is the same thing (`prompt`, `aisup`) at level 3 counts as having it; catalogue jobs keep their own catalogue nodes (no duplicates).
- `weeksCore` was removed (one weeks figure). Employer extra requirements (`employer=`) apply to catalogue jobs only.
- `GET /plan?job=esco:…` is read-only. `POST /plans` still takes catalogue jobs only; it stores `mode` as `closest`/`safest` and `route.weeks` = weeks to job-ready (reference weeks at 6 h/week).

## Knowledge pipeline (knowledge agent — `server/routes/knowledge.ts`)
| Method & path | Body / query | Response |
|---|---|---|
| `POST /scout/run` 🔒 | `{ sources?:['gdelt','hn','arxiv','openalex','rss','websearch'], nodes?:[id], replay?:bool }` | `{ runId, status:'ok'\|'failed'\|'replayed', replayed, counts:{fetched,candidates,rejected,auto,flagged,duplicates}, signals:[signal] }` |
| `GET /scout/runs` | | `{ runs:[{id,kind,status,trigger,startedAt,finishedAt,summary}] }` |
| `GET /sources` | | `{ trusted:[{domain,kind,why}], linkOnly:[{name,url,why}], policy:[string] }` |
| `GET /review` 🔒 | | `{ pending:[signal], emerging:[candidate], handled:[signal\|candidate], spotcheck:[signal], counts, bridges:{ status, total, offset, limit, bridges:[bridge] (top 10 proposed), counts } }` |
| `GET /review/bridges` 🔒 | `status=proposed\|approved\|rejected` (default proposed), `skill?` (ESCO id or words in either title), `family?` (field family, e.g. `health & care`), `offset`, `limit` (≤100, default 20) | `{ status, total, offset, limit, bridges:[bridge], counts:{proposed,approved,rejected,team,approvedByPeople}, families:[string] }`, strongest first |
| `POST /review/bridges/:id/approve` 🔒 | `{ note? }` | `{ bridge }`: used in ESCO routes and the match from now on (stored in `bridge_decisions`, audit `bridge.approve`) |
| `POST /review/bridges/:id/reject` 🔒 | `{ note? }` | `{ bridge }`: never used (also takes back an earlier approval). Team bridges → **409** |
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

`bridge` = `{ id, from:{id,title,field,family}, to:{id,title,field,family}, score, source:'discovered'|'team', status:'proposed'|'approved'|'rejected', why, evidence:{sharedActivities,tasksFrom,tasksTo,occFrom,occTo}, decision:{status,actor,decidedAt,note}|null }` (`id` = position in `db/seed/esco_bridges.json.gz`; `scripts/list-demo-bridges.ts` prints strong candidates for review, and approves nothing).

`signal` = `{ id, nodeId, nodeName, kind, title, deltaE, deltaD, quote, sourceUrl, sourceTitle, sourceDate, nSources, reviewer:{supports,confidence,issue} (old signals only), votes:{votes:[{role:'evidence'|'skill'|'sceptic',vote:'include'|'exclude',confidence,reason,model}],error}|null, voteTally:'2 of 3'|null, approvedBy:'agent vote (2 of 3)'|null, triage, triageReasons:[string], status, usersRerouted, needsSpotcheck, decidedBy, decidedAt, kbVersion, isSample }`

## Employers & HR (planning agent — `server/routes/employers.ts`)
| Method & path | Body / query | Response |
|---|---|---|
| `GET /employers` | | `{ employers:[{id,name,sector,careersUrl,source,verified,jobs:[job],hasTeam}] }` (`hasTeam`: at least one profile is linked to the employer) |
| `GET /employers/:id` | | `{ employer, requirements:[{occupationId,skillId,weight,levelNeeded,quote,sourceUrl,sourceDate}] }` |
| `POST /employers` | employer form `{ name, sector, careersUrl?, requirements:[{occupationId,skillId,weight,levelNeeded}] }` | `{ employer }` source `employer_form`, `verified:false` |
| `POST /employers/extract` 🔒 | `{ url }` (approved careers domains only) | `{ employerName, requirements:[...with quote], rejected?:reason }` (draft, not saved) |
| `GET /employers/:id/match` | `profile,job,mode,year,scenario` | `{ match, matchCatalogue, extraStops:[skillId], plan }` |
| `GET /hr/:employerId/progress` 🧑‍🏫 | `year,scenario` | goal progress of team members who chose to share it: see "Goal progress" |
| `GET /hr/:employerId/redeployment` 🧑‍🏫 | `year,scenario` | `{ employer, team:[{profileId,name,current,options:[{job,match,weeks,costRm,readyBy,onTime}]}], openRoles:[{job,openings,deadline}], assignment:[{profileId,job,match,weeks,costRm}], totals:{costRm, onTime, people} }` |

## Full ESCO taxonomy: "check any job" (`server/routes/esco.ts`)

| Route | Input | Output |
|---|---|---|
| `GET /esco/stats` | | `{ available, version, counts:{occupations,skills,skillLinks,occupationsWithoutIlo}, source, ilo, mycol:{occupations,escoOccupationsFlagged}, onet:{counts}, modelScores:{skills,embeddingModel,provider,iloAgreement} }` |
| `GET /esco/occupations` | `q` (2–100 chars), `limit` (≤30) | `{ results:[{id,title,isco,essential,optional,iloExposure,critical}] }` |
| `GET /esco/occupations/:id` | `profile?` | `{ id,title,description,code,isco,uri,match, counts:{essential,have,related,optional}, emerging:[AI-era skill], exposure:{ilo,model,gptsBeta,aei}, critical, malaysia:{group,year,since,medianWageRm,wageEarnersK,wageEarnersChangePct,medianWageChangePct,source,url}, onet:{code,title,match,split:{ai,tools,human},tasks:[{text,rating,core}]}, essential:[skill], optional:[skill] }` where skill = `{id,title,type,modelExposure,confirmed,basis:'have'\|'related'\|'missing',via,coverage}` |
| `GET /esco/skills` | `q`, `limit` | `{ results:[{id,title,type,modelExposure}] }` |
| `GET /esco/profile/:id/best-jobs` | `limit` (1-60, default 10) | `{ profileId, method, pickMethod, current:{id,title}\|null, defaultPick:id\|null, jobs:[{id,title,isco,match,have,close,essential,gaps,iloExposure,critical,weeks,weeksRef,reach,isCurrent,stepDown,pickScore}], skills:[{id,title,type,jobs,fromCatalogue}] }`: best matches across all ESCO jobs (same match rule, sorted by match), and the ESCO skills you have, most useful for those jobs first. `weeks` = rough weeks to job-ready at your hours (the ESCO plan's time formula on the essential gaps; the plan gives the real figure). `defaultPick` = the job to open on: highest `pickScore = match × 52 / (52 + weeksRef)`, never your current job (`isCurrent`) or a move to a lower ISCO skill level (`stepDown`, e.g. nurse → nurse assistant; still listed) |
| `GET /ai-skills` | | `{ note, params, linksMethod, skills:[{ id, name, description, category, aiEra:true, exposure:null, exposureNote, catalogue, sources:[{publisher,title,url,date}], occupations:[{id,title,score}], neighbours:[{id,title,rel}] }], excluded:[{skill,occupation,title,score,why}] }` |
| `GET /ai-skills/:id` | `id` = `ai:<slug>` | one skill, same shape |
| `GET /esco/profile/:id/skills` | | `{ skills:[escoSkillId] }` confirmed by the person |
| `PUT /esco/profile/:id/skills` | `{ add?:[id], remove?:[id] }` | `{ skills }` (unknown ids → 400) |

## Self-trained AI-exposure model (`server/routes/exposure.ts`)
| Method & path | Body / query | Response |
|---|---|---|
| `GET /exposure/model` | | `{ trained, available, embeddingModel, activeEmbeddingModel, embeddingProvider, target, trainedOn, run:{where,gpu,time}, evaluation, measures }` |
| `POST /exposure/score` | `{ tasks:[string] }` (1–50, 3–300 chars) | `{ scores:[{task, exposure}], model }` |
| `GET /exposure/skill/:id` | | `{ skillId, name, tasks:[{task, exposure, sampleMode}], modelMean, knowledgeBase:{exposure2026, source}, model }` |
Needs bge-m3 embeddings (RunPod or local); otherwise **503** `exposure_model_unavailable`.

The sample persona (profile 1) is read-only: `PUT /profile/1`, `PUT /profile/1/skills`, `POST /profile/1/answers` and every goal-progress write (`/profile/1/goal…`, `/profile/1/checkins`, the advisor confirmation) return **403** `demo_profile_read_only`; a check on it is scored with `saved:false`.

## Live external APIs (all free, no key needed unless noted)
GDELT DOC 2.0 (news search), Hacker News Algolia (tech news), arXiv, OpenAlex, curated RSS feeds, ESCO API (skills/occupations), OpenDOSM / data.gov.my (Malaysian labour data). Optional: Gemini Google Search grounding (needs quota), `BRAVE_API_KEY` or `TAVILY_API_KEY` web search, RunPod bge-m3 embeddings.
Every fetch: approved domains only, robots.txt obeyed, identified user agent, rate-limited, cached, and only facts + a short quote + the link are stored. Job boards are link-only.
