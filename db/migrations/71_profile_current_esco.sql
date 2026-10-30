-- The person's current job as an ESCO occupation (best ESCO match of the CV's job title, or the quiz's top job), so
-- a nurse's header says "nurse responsible for general care" even though the catalogue job is "other".
-- ESCO occupation id (last part of its URI); the taxonomy is static seed data, so no foreign key.
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS current_esco_id text;
