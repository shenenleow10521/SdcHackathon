// The services every route and agent receives. Tests build this with in-memory DB and mocks.
import type { Db } from "./lib/db.ts";
import type { Llm } from "./lib/llm.ts";
import type { Embedder } from "./lib/embed.ts";
import type { AuthVerifier } from "./lib/auth.ts";

export interface Config {
  demoMode: boolean;          // DEMO_MODE=true: replay the last recorded run if a live source or the AI fails (labelled "replayed")
  adminToken: string | null;  // ADMIN_TOKEN: if set, x-admin-token opens admin routes (scripts, tests)
  schedulerEnabled: boolean;  // SCOUT_SCHEDULE=off disables the scheduled market scout
  scoutIntervalHours: number;
  port: number;
  /** SUPABASE_URL + SUPABASE_ANON_KEY: switches accounts on. Both are public by design (sent to the browser). */
  supabase: { url: string; anonKey: string } | null;
  adminEmails: string[];      // ADMIN_EMAILS (comma-separated): admin role (also advisor)
  advisorEmails: string[];    // ADVISOR_EMAILS: advisor role (advisor queue, HR view)
}

export interface Services {
  db: Db;
  llm: Llm;
  embed: Embedder;
  /** Supabase token check; null or missing = accounts off (open demo). */
  auth?: AuthVerifier | null;
  /** Network fetch (injected so tests never touch the internet). */
  fetch: typeof fetch;
  now: () => Date;
  config: Config;
}

export function configFromEnv(env = process.env): Config {
  return {
    demoMode: /^(1|true|yes)$/i.test(env.DEMO_MODE || ""),
    adminToken: env.ADMIN_TOKEN || null,
    schedulerEnabled: !/^(0|off|false|no)$/i.test(env.SCOUT_SCHEDULE || "on") && env.NODE_ENV !== "test",
    scoutIntervalHours: Number(env.SCOUT_INTERVAL_HOURS || 24),
    port: Number(env.PORT || 3000),
    supabase: env.SUPABASE_URL && env.SUPABASE_ANON_KEY ? { url: env.SUPABASE_URL, anonKey: env.SUPABASE_ANON_KEY } : null,
    adminEmails: emailList(env.ADMIN_EMAILS),
    advisorEmails: emailList(env.ADVISOR_EMAILS),
  };
}

const emailList = (v?: string) => (v || "").split(",").map(s => s.trim().toLowerCase()).filter(Boolean);
