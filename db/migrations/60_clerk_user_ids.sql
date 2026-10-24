-- Clerk user IDs (e.g. user_...) are strings, not UUIDs.
-- Preserve any existing Supabase UUID ownership values rather than dropping account links.
ALTER TABLE profiles ALTER COLUMN auth_user_id TYPE text USING auth_user_id::text;
