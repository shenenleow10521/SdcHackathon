-- Ticks on the "Stay AI-ready in your job" track, kept on the server for your own profile (server/services/goal.ts
-- "the Stay AI-ready track", routes in server/routes/goal.ts). Additive and idempotent. Until now they lived only in the
-- browser (web/js/features/goal.js, localStorage); the sample persona's still do.
-- Same columns as goal_steps: a tick raises the profile's skill, and the *_before / *_set columns let an untick undo it.
-- Unlike goal_steps, changing the goal never clears these: the stay track is about the job you have.
CREATE TABLE IF NOT EXISTS stay_steps (
  profile_id   int NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  skill_id     text NOT NULL,                      -- catalogue skill id, ESCO skill uuid or ai:<slug>
  done         boolean NOT NULL DEFAULT false,
  done_at      timestamptz,
  hours        real,                               -- the item's hours when ticked (a ticked skill can leave the track)
  raised_skill text,                               -- the catalogue skill whose level the tick raised, or null
  level_before int,                                -- its level before (null: the profile did not have it)
  level_set    int,                                -- the level the tick set
  esco_added   boolean NOT NULL DEFAULT false,     -- the tick added this ESCO skill to profile_esco_skills
  PRIMARY KEY (profile_id, skill_id)
);

-- Same as 50_auth.sql: no access through Supabase's public REST API. Harmless on PGlite and plain PostgreSQL.
ALTER TABLE stay_steps ENABLE ROW LEVEL SECURITY;
