-- ESCO skills a person confirms they have ("Check this job" panel; later also from CV intake). Idempotent.
-- skill_id is an ESCO v1.2.1 skill id (the last part of its URI); the taxonomy itself is static seed data
-- loaded in memory (db/seed/esco_full.json.gz), so there is no foreign key to it.
CREATE TABLE IF NOT EXISTS profile_esco_skills (
  profile_id int  NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  skill_id   text NOT NULL,
  source     text NOT NULL DEFAULT 'self' CHECK (source IN ('self', 'cv')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (profile_id, skill_id)
);
