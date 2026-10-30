-- The three-agent vote on a signal (server/agents/voters.ts). Idempotent: safe to run more than once.
-- votes: {"votes":[{role, vote, confidence, reason, model}], "error": null | "why the vote could not finish"}
-- Null for signals that never reached a vote (rejected by the gate) and for signals made before the vote existed.
ALTER TABLE signals ADD COLUMN IF NOT EXISTS votes jsonb;
