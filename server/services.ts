// Builds the real services from the environment.
import "dotenv/config";
import { openDb, migrate } from "./lib/db.ts";
import { seed } from "./lib/seed.ts";
import { createGeminiLlm, geminiKeysFromEnv } from "./lib/llm.ts";
import { createEmbedder } from "./lib/embedder.ts";
import { configFromEnv, type Services } from "./context.ts";

export async function createServices(): Promise<Services> {
  const db = await openDb({ url: process.env.DATABASE_URL || undefined, dataDir: process.env.PGLITE_DIR || undefined });
  await migrate(db);
  await seed(db);
  const llm = createGeminiLlm({
    db, keys: geminiKeysFromEnv(),
    models: { main: process.env.GEMINI_MODEL || undefined, reviewer: process.env.GEMINI_REVIEWER_MODEL || undefined },
  });
  const config = configFromEnv();
  return { db, llm, embed: createEmbedder(process.env, db), auth: null, fetch: globalThis.fetch, now: () => new Date(), config };
}
