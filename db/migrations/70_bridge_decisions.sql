-- People's decisions on proposed cross-field bridges (server/services/bridges.ts, review queue in server/routes/knowledge.ts).
-- A discovered bridge is used in routes and the match only once a person approves it here; "rejected" keeps it out.
-- Bridges are identified by their two ESCO skill ids (the built file db/seed/esco_bridges.json.gz is static seed data,
-- so there is no foreign key). One row per bridge: a later decision replaces the earlier one (the audit log keeps both).
CREATE TABLE IF NOT EXISTS bridge_decisions (
  from_skill text NOT NULL,
  to_skill   text NOT NULL,
  status     text NOT NULL CHECK (status IN ('approved', 'rejected')),
  actor      text NOT NULL,
  decided_at timestamptz NOT NULL DEFAULT now(),
  note       text,
  PRIMARY KEY (from_skill, to_skill)
);
