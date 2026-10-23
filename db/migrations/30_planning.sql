-- Planning, advisor and HR redeployment (owner: planning agent). Idempotent.

-- Open roles an employer wants to fill from its own team (HR redeployment view).
CREATE TABLE IF NOT EXISTS open_roles (
  id            serial PRIMARY KEY,
  employer_id   int NOT NULL REFERENCES employers(id) ON DELETE CASCADE,
  occupation_id text NOT NULL REFERENCES occupations(id),
  openings      int NOT NULL CHECK (openings > 0),
  deadline      date NOT NULL,                      -- people must be job-ready by this date
  source        text NOT NULL DEFAULT 'sample',
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS open_roles_employer_idx ON open_roles(employer_id);

-- The user's own note when sending a plan to an advisor, and when it was sent.
ALTER TABLE plans ADD COLUMN IF NOT EXISTS user_note text;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS sent_at timestamptz;
ALTER TABLE plans ADD COLUMN IF NOT EXISTS decided_at timestamptz;
CREATE INDEX IF NOT EXISTS plans_profile_idx ON plans(profile_id);
CREATE INDEX IF NOT EXISTS plans_status_idx ON plans(status);
CREATE INDEX IF NOT EXISTS profile_snapshots_profile_idx ON profile_snapshots(profile_id, created_at);
CREATE INDEX IF NOT EXISTS employer_requirements_employer_idx ON employer_requirements(employer_id, occupation_id);
