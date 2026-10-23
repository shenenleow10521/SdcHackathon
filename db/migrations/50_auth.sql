-- Accounts (Supabase Auth). A signed-in user owns at most one profile; the shared demo persona
-- and the sample HR team have none (NULL).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS auth_user_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS profiles_auth_user_idx ON profiles(auth_user_id);

-- On Supabase, tables in "public" are reachable through its REST API with the public anon key.
-- Row-level security with no policies closes that door; the app's own connection owns the tables
-- and is not affected. Harmless on PGlite and plain PostgreSQL.
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
