// Test services: in-memory database (seeded), scripted LLM, bag-of-words embeddings, and no network.
import { openDb, migrate } from "../../server/lib/db.ts";
import { seed } from "../../server/lib/seed.ts";
import { createMockLlm, type Llm, type LlmRequest } from "../../server/lib/llm.ts";
import { createMockEmbedder, type Embedder } from "../../server/lib/embed.ts";
import type { Services, Config } from "../../server/context.ts";

export async function testServices(over: Partial<Omit<Services, "config">> & { config?: Partial<Config>; llmHandler?: (req: LlmRequest<any>) => unknown } = {}): Promise<Services> {
  const db = over.db || (await openDb({ memory: true }));
  if (!over.db) { await migrate(db); await seed(db); }
  const llm: Llm = over.llm || createMockLlm(over.llmHandler || (() => new Error("LLM not expected in this test")));
  const embed: Embedder = over.embed || createMockEmbedder();
  const noNet = (async (url: any) => { throw new Error(`Network access in tests: ${url}`); }) as unknown as typeof fetch;
  return {
    db, llm, embed, auth: over.auth ?? null, fetch: over.fetch || noNet, now: over.now || (() => new Date("2026-10-23T10:00:00Z")),
    config: { demoMode: false, adminToken: null, schedulerEnabled: false, scoutIntervalHours: 24, port: 0,
      supabase: null, adminEmails: [], advisorEmails: [], ...(over.config || {}) },
  };
}
