-- The sample persona's deadline: a fixed demo date (15 Feb 2027) instead of "seeded day + 6 months".
-- Only the demo profile (id 1, is_demo) changes; on a fresh database the seed sets the same date.
UPDATE profiles SET target_date = '2027-02-15' WHERE id = 1 AND is_demo;
