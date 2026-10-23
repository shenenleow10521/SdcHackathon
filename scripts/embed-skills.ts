// Precomputes skill vectors with the configured embedding provider and writes db/seed/embeddings.json
// ({ model, dims, provider, createdAt, vectors: { skillId: number[] } }). The seed loads them into skills.embedding,
// so the first CV upload doesn't have to embed every skill. Matching only uses them if the running app's
// embedding model has the same name (otherwise it recomputes them), so vectors from different models never mix.
// Usage: npx tsx scripts/embed-skills.ts   (needs RUNPOD_*, LOCAL_EMBED_URL or a Gemini key in .env)
import "dotenv/config";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { openDb, migrate, projectRoot } from "../server/lib/db.ts";
import { seed } from "../server/lib/seed.ts";
import { createEmbedder } from "../server/lib/embedder.ts";
import { loadSkillCatalog, skillText } from "../server/services/matching.ts";

const embed = createEmbedder(process.env);
if (embed.provider === "none") {
  console.error("No embedding provider configured (set RUNPOD_API_KEY + RUNPOD_EMBED_ENDPOINT_ID, LOCAL_EMBED_URL, or GEMINI_API_KEY).");
  process.exit(1);
}

// A throwaway in-memory database gives us the seeded skills with their aliases and tasks: the same text the app embeds.
const db = await openDb({ memory: true });
await migrate(db);
await seed(db);
const skills = await loadSkillCatalog(db);
await db.close();

console.log(`Embedding ${skills.length} skills with ${embed.provider} (${embed.model})...`);
const vecs = await embed.embed(skills.map(skillText));
const out = {
  model: embed.model,
  dims: vecs[0].length,
  provider: embed.provider,
  createdAt: new Date().toISOString(),
  note: "Skill vectors for semantic CV matching. Text = label + aliases + description + tasks (server/services/matching.ts skillText). Regenerate with: npx tsx scripts/embed-skills.ts",
  vectors: Object.fromEntries(skills.map((s, i) => [s.id, vecs[i].map(x => Math.round(x * 1e6) / 1e6)])),
};
const file = path.join(projectRoot, "db", "seed", "embeddings.json");
writeFileSync(file, JSON.stringify(out) + "\n");
console.log(`Wrote ${file}: ${skills.length} vectors, ${out.dims} dims, model ${out.model}`);
