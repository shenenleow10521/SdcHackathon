// Builds the real services from the environment.
import "dotenv/config";
import { openDb, migrate } from "./lib/db.ts";
import { seed } from "./lib/seed.ts";
import { createGeminiLlm, geminiKeysFromEnv } from "./lib/llm.ts";
import { createEmbedder } from "./lib/embedder.ts";
import { configFromEnv, type Services } from "./context.ts";
import { supabaseVerifier } from "./lib/auth.ts";

export async function createServices(): Promise<Services> {
  const db = await openDb({ url: process.env.DATABASE_URL || undefined, dataDir: process.env.PGLITE_DIR || undefined });
  await migrate(db);
  await seed(db);
  const llm = createGeminiLlm({
    db, keys: geminiKeysFromEnv(),
    models: { main: process.env.GEMINI_MODEL || undefined, reviewer: process.env.GEMINI_REVIEWER_MODEL || undefined },
  });
  const config = configFromEnv();
  const auth = config.supabase ? supabaseVerifier(config.supabase.url, config.supabase.anonKey) : null;
  return { db, llm, embed: createEmbedder(process.env, db), auth, fetch: globalThis.fetch, now: () => new Date(), config };
}
