-- Goal progress on the server (server/services/goal.ts, routes in server/routes/goal.ts). Additive and idempotent.
-- Until now the goal lived only in the browser (web/js/features/goal.js, localStorage).

-- The one job a person commits to. job = a catalogue job id or "esco:<uuid>" (static seed data, so no foreign key).
CREATE TABLE IF NOT EXISTS goals (
  profile_id int PRIMARY KEY REFERENCES profiles(id) ON DELETE CASCADE,
  job        text NOT NULL,
  mode       text NOT NULL DEFAULT 'closest' CHECK (mode IN ('closest', 'safest')),
  set_at     date NOT NULL,                        -- the day this job became the goal (a new job starts a new date)
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ticks on the goal's steps (one row per skill ticked at least once). Changing the goal's job deletes them.
-- A tick raises the profile's skill so plans recompute; the *_before / *_set columns let an untick undo exactly that.
CREATE TABLE IF NOT EXISTS goal_steps (
  profile_id   int NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  skill_id     text NOT NULL,                      -- catalogue skill id, ESCO skill uuid or ai:<slug>
  done         boolean NOT NULL DEFAULT false,
  done_at      timestamptz,
  hours        real,                               -- the step's hours when ticked (a done step leaves the plan's gap list)
  raised_skill text,                               -- the catalogue skill whose level the tick raised, or null
  level_before int,                                -- its level before (null: the profile did not have it)
  level_set    int,                                -- the level the tick set
  esco_added   boolean NOT NULL DEFAULT false,     -- the tick added this ESCO skill to profile_esco_skills
  PRIMARY KEY (profile_id, skill_id)
);

-- Who vouches for a skill. Kept per skill (not per goal), so evidence survives a change of goal and appears on the
-- skills record. kind: check = passed the HalaTuju skill check; advisor = an advisor confirmed it;
-- credential = a link the person added (shown as "Show credential"; never counts as verified).
CREATE TABLE IF NOT EXISTS skill_proofs (
  id         serial PRIMARY KEY,
  profile_id int NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  skill_id   text NOT NULL,
  kind       text NOT NULL CHECK (kind IN ('check', 'advisor', 'credential')),
  vouched_by text NOT NULL,                        -- "HalaTuju skill check", the advisor's name, or the credential's provider
  at         timestamptz NOT NULL DEFAULT now(),
  url        text,                                 -- credentials only (https)
  title      text,                                 -- credentials only
  CHECK (kind <> 'credential' OR (url IS NOT NULL AND title IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS skill_proofs_profile_idx ON skill_proofs(profile_id, skill_id);

-- Weekly check-ins: hours studied in the week starting week_start (a Monday). One row per week; a new check-in replaces it.
CREATE TABLE IF NOT EXISTS goal_checkins (
  profile_id int NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  week_start date NOT NULL,
  hours      real NOT NULL CHECK (hours >= 0 AND hours <= 80),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, week_start)
);

-- The person's choice to show their goal progress to their employer's HR view. Off unless they turn it on.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS share_progress boolean NOT NULL DEFAULT false;

-- Same as 50_auth.sql: no access through Supabase's public REST API. Harmless on PGlite and plain PostgreSQL.
ALTER TABLE goals ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE goal_checkins ENABLE ROW LEVEL SECURITY;
