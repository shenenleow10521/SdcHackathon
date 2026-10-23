-- One rule for every job: a skill counts as yours at level 3 of 5 ("I can do it on my own").
-- ESCO publishes no proficiency levels, so the catalogue's per-job levels (set by hand) are replaced
-- by this one level. Employer-entered requirements (employer_requirements) keep their own level.
-- Same value as HAVE_LEVEL in shared/engine.js.
UPDATE occupation_skills SET level_needed = 3 WHERE level_needed <> 3;
