// npm run db:setup — create tables and load the seed. Pass --reset to wipe a local PGlite database first.
import "dotenv/config";
import { rmSync } from "node:fs";
import path from "node:path";
import { openDb, migrate, projectRoot } from "../server/lib/db.ts";
import { seed } from "../server/lib/seed.ts";

if (process.argv.includes("--reset") && !process.env.DATABASE_URL) rmSync(process.env.PGLITE_DIR || path.join(projectRoot, "data", "pglite"), { recursive: true, force: true });
const db = await openDb({ url: process.env.DATABASE_URL || undefined, dataDir: process.env.PGLITE_DIR || undefined });
const applied = await migrate(db);
const r = await seed(db);
console.log(`migrations applied: ${applied.length ? applied.join(", ") : "none"}; seed: ${r.seeded ? "loaded" : "already present"} (${db.kind})`);
await db.close();
