// Database adapter: real PostgreSQL when DATABASE_URL is set (Replit), otherwise embedded PGlite
// (a WASM build of Postgres) on disk for local dev, or in memory for tests. Same SQL either way.
import { readFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export interface Db {
  kind: "pg" | "pglite";
  query<T = any>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  /** Run several statements (no parameters). */
  exec(sql: string): Promise<void>;
  /** Run fn inside a transaction; rolls back if it throws. */
  tx<T>(fn: (q: Db) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export async function openDb(opts: { url?: string; dataDir?: string; memory?: boolean } = {}): Promise<Db> {
  if (opts.url) return openPg(opts.url);
  return openPglite(opts.memory ? undefined : opts.dataDir ?? path.join(ROOT, "data", "pglite"));
}

async function openPglite(dataDir?: string): Promise<Db> {
  const { PGlite } = await import("@electric-sql/pglite");
  if (dataDir) mkdirSync(dataDir, { recursive: true });
  const pg = dataDir ? new PGlite(dataDir) : new PGlite();
  await pg.waitReady;
  const wrap = (q: any): Db => ({
    kind: "pglite",
    query: async (sql, params) => ({ rows: (await q.query(sql, params as any[])).rows }),
    exec: async sql => { await q.exec(sql); },
    tx: fn => (q === pg ? pg.transaction(t => fn(wrap(t))) : fn(wrap(q))),
    close: async () => { if (q === pg) await pg.close(); },
  });
  return wrap(pg);
}

async function openPg(url: string): Promise<Db> {
  const { default: pg } = await import("pg");
  // Return `date` columns as 'YYYY-MM-DD' strings, like PGlite does by default for our usage.
  pg.types.setTypeParser(1082, (v: string) => v);
  const pool = new pg.Pool({ connectionString: url, max: 5, ssl: /sslmode=require|neon|replit|supabase/.test(url) ? { rejectUnauthorized: false } : undefined });
  await pool.query("select 1");
  const fromClient = (c: any): Db => ({
    kind: "pg",
    query: async (sql, params) => ({ rows: (await c.query(sql, params)).rows }),
    exec: async sql => { await c.query(sql); },
    tx: fn => fn(fromClient(c)), // already inside a transaction
    close: async () => {},
  });
  return {
    kind: "pg",
    query: async (sql, params) => ({ rows: (await pool.query(sql, params as any[])).rows }),
    exec: async sql => { await pool.query(sql); },
    tx: async fn => {
      const c = await pool.connect();
      try { await c.query("BEGIN"); const r = await fn(fromClient(c)); await c.query("COMMIT"); return r; }
      catch (e) { await c.query("ROLLBACK"); throw e; }
      finally { c.release(); }
    },
    close: () => pool.end(),
  };
}

/** Apply db/schema.sql, then every db/migrations/*.sql not yet applied (in name order). */
export async function migrate(db: Db): Promise<string[]> {
  await db.exec(readFileSync(path.join(ROOT, "db", "schema.sql"), "utf8"));
  const dir = path.join(ROOT, "db", "migrations");
  const applied: string[] = [];
  if (!existsSync(dir)) return applied;
  const done = new Set((await db.query<{ name: string }>("select name from schema_migrations")).rows.map(r => r.name));
  for (const f of readdirSync(dir).filter(f => f.endsWith(".sql")).sort()) {
    if (done.has(f)) continue;
    await db.tx(async t => {
      await t.exec(readFileSync(path.join(dir, f), "utf8"));
      await t.query("insert into schema_migrations(name) values ($1)", [f]);
    });
    applied.push(f);
  }
  return applied;
}

export const projectRoot = ROOT;
