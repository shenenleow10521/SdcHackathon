// Test services: in-memory database (seeded), scripted LLM, bag-of-words embeddings, and no network.
import { openDb, migrate } from "../../server/lib/db.ts";
import { seed } from "../../server/lib/seed.ts";
import { createMockLlm, type Llm, type LlmRequest } from "../../server/lib/llm.ts";
import { createMockEmbedder, type Embedder } from "../../server/lib/embed.ts";
import type { Services, Config } from "../../server/context.ts";

/** In-memory PGlite, or real PostgreSQL when TEST_DATABASE_URL is set (each call gets its own throwaway schema test_*). */
async function testDb() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) return openDb({ memory: true });
  const schema = `test_${process.pid}_${Math.random().toString(36).slice(2, 10)}`;
  const admin = await openDb({ url });
  await admin.exec(`create schema ${schema}`);
  await admin.close();
  const u = new URL(url);
  u.searchParams.set("options", `-c search_path=${schema}`);
  return openDb({ url: u.toString() });
}

export async function testServices(over: Partial<Omit<Services, "config">> & { config?: Partial<Config>; llmHandler?: (req: LlmRequest<any>) => unknown } = {}): Promise<Services> {
  const db = over.db || (await testDb());
  if (!over.db) { await migrate(db); await seed(db); }
  const llm: Llm = over.llm || createMockLlm(over.llmHandler || (() => new Error("LLM not expected in this test")));
  const embed: Embedder = over.embed || createMockEmbedder();
  const noNet = (async (url: any) => { throw new Error(`Network access in tests: ${url}`); }) as unknown as typeof fetch;
  return {
    db, llm, embed, auth: over.auth ?? null, fetch: over.fetch || noNet, now: over.now || (() => new Date("2026-10-23T10:00:00Z")),
    config: { demoMode: false, adminToken: null, schedulerEnabled: false, scoutIntervalHours: 24, port: 0,
      clerkEnabled: false, clerkPublishableKey: "", clerkProxyUrl: "", guestSessionSecret: null, adminEmails: [], advisorEmails: [], ...(over.config || {}) },
  };
}
