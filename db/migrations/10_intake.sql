-- Intake agent tables (CV intake, embeddings cache, "Prove" skill checks). Idempotent.

-- Embedding cache: one vector per (model, sha256 of the text). Vectors from different models are never mixed.
CREATE TABLE IF NOT EXISTS embedding_cache (
  model      text NOT NULL,
  text_hash  text NOT NULL,
  vector     jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (model, text_hash)
);

-- A "Prove" check handed to a user. The answer key stays here and is never sent to the browser.
CREATE TABLE IF NOT EXISTS skill_checks (
  id           text PRIMARY KEY,                  -- random id given to the client
  profile_id   int NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  skill_id     text NOT NULL REFERENCES skills(id),
  questions    jsonb NOT NULL,                    -- [{id, text, options}] as shown to the user
  answer_key   jsonb NOT NULL,                    -- {questionId: correctOptionIndex}
  created_at   timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz,                       -- set once; a check can only be submitted once
  score        int,
  total        int,
  passed       boolean
);
