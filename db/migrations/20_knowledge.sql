-- Knowledge pipeline (scout, triage, review, committee). Idempotent: safe to run more than once.

-- Every network fetch we make: what, when, result, a hash and a short excerpt. Never full pages.
CREATE TABLE IF NOT EXISTS fetch_log (
  id         serial PRIMARY KEY,
  url        text NOT NULL,
  host       text NOT NULL,
  status     int,                      -- HTTP status (null = no response)
  ok         boolean NOT NULL,
  reason     text,                     -- why it was refused or failed
  sha256     text,                     -- hash of the body we received
  excerpt    text,                     -- <= 300 characters of plain text
  fetched_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fetch_log_at ON fetch_log (fetched_at DESC);

-- Signals: extra evidence and human-check fields.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS source_kind text;            -- 'gdelt' | 'hn' | 'arxiv' | 'openalex' | 'rss' | 'websearch'
ALTER TABLE signals ADD COLUMN IF NOT EXISTS sources jsonb;               -- [{url, domain, title, date, quote, sourceKind}] corroborating items
ALTER TABLE signals ADD COLUMN IF NOT EXISTS claim text;                  -- what the extractor says the quote shows
ALTER TABLE signals ADD COLUMN IF NOT EXISTS replayed boolean NOT NULL DEFAULT false;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS decision_note text;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS spotcheck text;              -- null | 'ok' | 'wrong'
ALTER TABLE signals ADD COLUMN IF NOT EXISTS spotcheck_by text;
ALTER TABLE signals ADD COLUMN IF NOT EXISTS spotcheck_at timestamptz;
CREATE INDEX IF NOT EXISTS signals_node_created ON signals (node_id, created_at DESC);

-- Emerging-skill candidates: a stable key per phrase, and what the evidence counts mean.
ALTER TABLE emerging_candidates ADD COLUMN IF NOT EXISTS phrase_key text;
ALTER TABLE emerging_candidates ADD COLUMN IF NOT EXISTS evidence_basis text NOT NULL DEFAULT 'sample';  -- 'trusted_source_mentions' | 'sample'
ALTER TABLE emerging_candidates ADD COLUMN IF NOT EXISTS kb_version int;
CREATE UNIQUE INDEX IF NOT EXISTS emerging_phrase_key ON emerging_candidates (phrase_key) WHERE phrase_key IS NOT NULL;

-- Each verified mention of a possible new skill in a trusted source, kept across committee runs
-- so the thresholds (mentions, organisations, weeks) are counted by code from stored evidence.
CREATE TABLE IF NOT EXISTS emerging_mentions (
  id           serial PRIMARY KEY,
  run_id       int,
  phrase_key   text NOT NULL,
  label        text NOT NULL,
  linked_skill text,
  url          text NOT NULL,
  domain       text NOT NULL,
  quote        text NOT NULL,
  source_date  date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (phrase_key, url)
);
