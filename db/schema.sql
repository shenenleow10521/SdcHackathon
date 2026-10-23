-- HalaTuju schema (PostgreSQL; also runs on PGlite for local dev and tests).
-- Extra tables go in db/migrations/NN_name.sql, applied in name order after this file.

-- ---------- Knowledge base (versioned) ----------
CREATE TABLE IF NOT EXISTS kb_versions (
  id         serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  note       text NOT NULL,
  actor      text NOT NULL DEFAULT 'system'      -- 'system' | 'auto' | 'admin:<name>'
);

-- Every change to the knowledge base. The graph at version V = seed + all changes with kb_version <= V.
-- kind: 'delta'           node_id, delta_e, delta_d      (AI exposure / demand shift from a signal)
--       'emerging_status' node_id, payload {status}       ('provisional' | 'confirmed' | 'retired')
--       'add_skill'       payload {skill:{id,label,e,d,emerging}, edges:[...], req:[{job,skill,weight,need,status}]}
--       'revert'          payload {change_ids:[...]}       (undo: those changes stop counting from this version)
CREATE TABLE IF NOT EXISTS kb_changes (
  id         serial PRIMARY KEY,
  kb_version int NOT NULL REFERENCES kb_versions(id),
  kind       text NOT NULL,
  node_id    text,
  delta_e    real NOT NULL DEFAULT 0,
  delta_d    real NOT NULL DEFAULT 0,
  payload    jsonb,
  signal_id  int,
  source_url text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS occupations (
  id             text PRIMARY KEY,
  title          text NOT NULL,
  is_destination boolean NOT NULL DEFAULT true,
  stay           boolean NOT NULL DEFAULT false,  -- "stay and adapt" option
  blurb          text,
  postings       int,
  conf           text,
  split          jsonb,                            -- task split [[ai,assist,human] 2026, 2030m, 2030f]
  sdg            jsonb NOT NULL DEFAULT '[]',      -- [[goal, reason], ...]
  source         text NOT NULL DEFAULT 'sample',   -- 'esco' | 'onet' | 'sample'
  source_uri     text,                             -- ESCO occupation URI
  isco_code      text,
  onet_code      text
);

CREATE TABLE IF NOT EXISTS skills (
  id              text PRIMARY KEY,
  label           text NOT NULL,
  description     text,
  source          text NOT NULL DEFAULT 'sample',  -- 'esco' | 'onet' | 'emerging' | 'sample'
  source_uri      text,
  embedding       jsonb,                           -- number[]; provider in embedding_model
  embedding_model text,
  emerging        jsonb,                           -- {postings, employers, weeks, synonyms, status}
  sdg             jsonb,                           -- [goal, reason]
  angle           real                             -- fixed angle on the inner ring (UI)
);

CREATE TABLE IF NOT EXISTS skill_aliases (
  skill_id text NOT NULL REFERENCES skills(id),
  alias    text NOT NULL,
  PRIMARY KEY (skill_id, alias)
);

CREATE TABLE IF NOT EXISTS tasks (
  id          serial PRIMARY KEY,
  skill_id    text NOT NULL REFERENCES skills(id),
  text        text NOT NULL,
  mode        text NOT NULL,                       -- 'ai' | 'assist' | 'human'
  source      text NOT NULL DEFAULT 'sample',
  source_date date
);

CREATE TABLE IF NOT EXISTS occupation_skills (
  occupation_id   text NOT NULL REFERENCES occupations(id),
  skill_id        text NOT NULL REFERENCES skills(id),
  weight          int NOT NULL,
  level_needed    int NOT NULL,
  status          text NOT NULL,                   -- 'essential' | 'optional' | 'emerging'
  evidence_share  int,                             -- % of postings asking for it (sample)
  evidence_source text NOT NULL DEFAULT 'sample',
  PRIMARY KEY (occupation_id, skill_id)
);

CREATE TABLE IF NOT EXISTS edges (
  from_id text NOT NULL,
  to_id   text NOT NULL,
  kind    text NOT NULL,                           -- 'build' | 'evolve'
  weeks   int NOT NULL,
  reason  text NOT NULL,
  PRIMARY KEY (from_id, to_id)
);

-- Baseline outlook per node: AI exposure (0..1) and demand change (%), 2026 and 2030 under two scenarios.
CREATE TABLE IF NOT EXISTS outlook (
  node_id  text PRIMARY KEY,
  e2026 real NOT NULL, e2030m real NOT NULL, e2030f real NOT NULL,
  d2026 real NOT NULL, d2030m real NOT NULL, d2030f real NOT NULL,
  source   text NOT NULL DEFAULT 'sample'
);

CREATE TABLE IF NOT EXISTS sectors (
  id    text PRIMARY KEY,
  name  text NOT NULL,
  icon  text,
  note  text,
  jobs  jsonb,                                     -- ordered job ids; null = "best matches"
  ord   int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS courses (
  id            serial PRIMARY KEY,
  skill_id      text NOT NULL REFERENCES skills(id),
  title         text NOT NULL,
  provider      text,
  url           text,
  format        text,
  format_text   text,
  hours         int,
  cost_rm       real,                              -- null = unknown
  hrd_claimable boolean NOT NULL DEFAULT false,
  practice_task text,
  prove_check   text,
  source        text NOT NULL DEFAULT 'sample'
);

-- AI-exposure estimates from more than one study, shown side by side ("Studies disagree").
CREATE TABLE IF NOT EXISTS exposure_studies (
  id            serial PRIMARY KEY,
  occupation_id text NOT NULL REFERENCES occupations(id),
  study         text NOT NULL,                     -- e.g. 'ILO WP140', 'Anthropic Economic Index'
  value         real,                              -- normalised 0..1 where possible
  raw_value     text,
  note          text,
  source_url    text,
  source        text NOT NULL DEFAULT 'sample'
);

-- ---------- Signals and review ----------
CREATE TABLE IF NOT EXISTS runs (
  id          serial PRIMARY KEY,
  kind        text NOT NULL,                       -- 'scout' | 'committee' | 'rescore'
  started_at  timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  status      text NOT NULL DEFAULT 'running',     -- 'running' | 'ok' | 'failed' | 'replayed'
  trigger     text NOT NULL DEFAULT 'manual',      -- 'manual' | 'schedule' | 'seed'
  summary     jsonb
);

CREATE TABLE IF NOT EXISTS signals (
  id                  serial PRIMARY KEY,
  run_id              int,
  node_id             text NOT NULL,
  kind                text NOT NULL,               -- 'capability' | 'adoption' | 'demand'
  title               text NOT NULL,
  delta_e             real NOT NULL DEFAULT 0,
  delta_d             real NOT NULL DEFAULT 0,
  quote               text,
  source_url          text,
  source_title        text,
  source_date         date,
  n_sources           int NOT NULL DEFAULT 1,
  reviewer_supports   boolean,
  reviewer_confidence real,
  reviewer_issue      text,
  triage              text NOT NULL,               -- 'auto' | 'flagged' | 'rejected'
  triage_reasons      jsonb NOT NULL DEFAULT '[]',
  status              text NOT NULL,               -- 'applied' | 'pending' | 'rejected' | 'reverted'
  users_rerouted      int,
  needs_spotcheck     boolean NOT NULL DEFAULT false,
  decided_by          text,
  decided_at          timestamptz,
  kb_version          int,
  embedding           jsonb,
  is_sample           boolean NOT NULL DEFAULT false,
  created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS emerging_candidates (
  id           serial PRIMARY KEY,
  run_id       int,
  label        text NOT NULL,
  skill_id     text,                               -- set when accepted into skills
  synonyms     jsonb NOT NULL DEFAULT '[]',
  postings     int NOT NULL DEFAULT 0,
  employers    int NOT NULL DEFAULT 0,
  weeks        int NOT NULL DEFAULT 0,
  linked_skill text,
  committee    jsonb,                              -- {proposer, skeptic, duplicate}
  evidence     jsonb NOT NULL DEFAULT '[]',        -- [{quote, url, date}]
  status       text NOT NULL,                      -- 'pending' | 'provisional' | 'confirmed' | 'rejected' | 'merged'
  decided_by   text,
  decided_at   timestamptz,
  is_sample    boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ---------- People ----------
CREATE TABLE IF NOT EXISTS profiles (
  id                    serial PRIMARY KEY,
  display_name          text NOT NULL,
  current_occupation_id text NOT NULL REFERENCES occupations(id),
  hours_per_week        int NOT NULL DEFAULT 6,
  budget_rm             real,
  target_date           date,                       -- deadline, e.g. end of a redeployment window
  sdg_priority          int,                        -- e.g. 13 to favour climate jobs
  lang                  text NOT NULL DEFAULT 'en', -- 'en' | 'ms'
  employer_id           int,                        -- set for HR redeployment team members
  is_demo               boolean NOT NULL DEFAULT false,
  created_at            timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS profile_skills (
  profile_id int NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  skill_id   text NOT NULL REFERENCES skills(id),
  level      int NOT NULL CHECK (level BETWEEN 0 AND 5),
  confidence text NOT NULL DEFAULT 'self',          -- 'cv' | 'self' | 'verified'
  evidence   text,
  PRIMARY KEY (profile_id, skill_id)
);

CREATE TABLE IF NOT EXISTS profile_snapshots (
  id           serial PRIMARY KEY,
  profile_id   int NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kb_version   int NOT NULL,
  future_score int,
  matches      jsonb,                                -- {jobId: match%}
  routes       jsonb,                                -- {jobId: routeKey} for the profile's plan mode
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plans (
  id            serial PRIMARY KEY,
  profile_id    int NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  occupation_id text NOT NULL REFERENCES occupations(id),
  employer_id   int,
  mode          text NOT NULL DEFAULT 'fastest',
  route         jsonb,                               -- the route the user accepted
  kb_version    int,
  status        text NOT NULL DEFAULT 'draft',       -- 'draft' | 'sent' | 'approved' | 'changes_requested'
  advisor_note  text,
  decided_by    text,
  pending_route jsonb,                               -- set when a KB change would reroute this plan
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ---------- Employers ----------
CREATE TABLE IF NOT EXISTS employers (
  id          serial PRIMARY KEY,
  name        text NOT NULL,
  sector      text,
  careers_url text,
  source      text NOT NULL DEFAULT 'sample',       -- 'careers_page' | 'employer_form' | 'sample'
  verified    boolean NOT NULL DEFAULT false,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Extra or changed requirements an employer has for a catalogue job.
CREATE TABLE IF NOT EXISTS employer_requirements (
  id            serial PRIMARY KEY,
  employer_id   int NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  occupation_id text NOT NULL REFERENCES occupations(id),
  skill_id      text NOT NULL REFERENCES skills(id),
  weight        int NOT NULL DEFAULT 2,
  level_needed  int NOT NULL DEFAULT 3,
  quote         text,
  source_url    text,
  source_date   date
);

-- ---------- Infrastructure ----------
CREATE TABLE IF NOT EXISTS llm_cache (
  key        text PRIMARY KEY,
  model      text NOT NULL,
  response   jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS audit_log (
  id     serial PRIMARY KEY,
  at     timestamptz NOT NULL DEFAULT now(),
  actor  text NOT NULL,
  action text NOT NULL,
  target text,
  detail jsonb
);

CREATE TABLE IF NOT EXISTS schema_migrations (
  name       text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
);
