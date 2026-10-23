// LLM wrapper (Google Gemini). One call shape for every agent:
//   llm.complete({ system, user, schema })  ->  { data, model, cached }
// - Output is forced to JSON with the zod schema (converted to JSON Schema) and validated again here.
// - Every response is cached in llm_cache by a hash of model + prompt + schema (demo reliability, lower cost).
// - Rate limits / server errors rotate to the next API key, then to the fallback model.
// - Personal details are scrubbed from the user text before it leaves the server (defence in depth).
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db.ts";
import { scrubPii } from "./pii.ts";

export interface LlmRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** 'main' for most agents; 'reviewer' uses a different model, so a second model checks the first. */
  role?: "main" | "reviewer";
  temperature?: number;
  maxOutputTokens?: number;
  /** Read and write the response cache (default true). */
  cache?: boolean;
}
export interface LlmResult<T> { data: T; model: string; cached: boolean }
export interface Llm {
  complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>>;
  status(): { configured: boolean; models: { main: string; reviewer: string }; keys: number; lastError: string | null };
}

export class LlmUnavailableError extends Error {
  status = 503; code = "llm_unavailable";
  constructor(msg: string) { super(msg); }
}

export const DEFAULT_MODELS = { main: "gemini-3.5-flash-lite", reviewer: "gemini-3.1-flash-lite" };

/** Every Gemini key in the environment: GEMINI_API_KEY, GEMINI_API_KEY_2, ..., gemini_key, gemini_key_2, ... (deduplicated, in order). */
export function geminiKeysFromEnv(env = process.env): string[] {
  const order = (name: string) => Number((name.match(/_(\d+)$/) || [, "1"])[1]);
  return Object.keys(env)
    .filter(n => /^(GEMINI_API_KEY|gemini_key)(_\d+)?$/i.test(n))
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map(n => (env[n] || "").trim().replace(/^["']|["']$/g, ""))
    .filter((k, i, a) => k && a.indexOf(k) === i);
}

export function createGeminiLlm(opts: {
  db?: Db; keys: string[]; models?: Partial<typeof DEFAULT_MODELS>;
  fetch?: typeof fetch; timeoutMs?: number;
}): Llm {
  const models = {
    main: opts.models?.main || DEFAULT_MODELS.main,
    reviewer: opts.models?.reviewer || DEFAULT_MODELS.reviewer,
  };
  const doFetch = opts.fetch || fetch;
  const keys = opts.keys;
  let keyIdx = 0, lastError: string | null = null;

  async function cacheGet(key: string) {
    if (!opts.db) return null;
    const r = await opts.db.query<{ response: any; model: string }>("select response, model from llm_cache where key=$1", [key]);
    return r.rows[0] || null;
  }
  async function cachePut(key: string, model: string, response: unknown) {
    if (!opts.db) return;
    await opts.db.query("insert into llm_cache(key, model, response) values ($1,$2,$3) on conflict (key) do nothing", [key, model, JSON.stringify(response)]);
  }

  async function callModel(model: string, system: string, user: string, jsonSchema: unknown, temperature: number, maxOutputTokens: number) {
    let lastErr = "";
    for (let attempt = 0; attempt < Math.max(1, keys.length); attempt++) {
      const key = keys[keyIdx % keys.length];
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 45000);
      try {
        const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
          method: "POST", signal: ctrl.signal,
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
            generationConfig: { temperature, maxOutputTokens, responseMimeType: "application/json", responseJsonSchema: jsonSchema },
          }),
        });
        if (res.status === 429 || res.status >= 500 || res.status === 403) {
          lastErr = `${model} HTTP ${res.status}`; keyIdx++; continue; // try the next key
        }
        const body: any = await res.json();
        if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${body?.error?.message || "error"}`);
        const text = body?.candidates?.[0]?.content?.parts?.filter((p: any) => typeof p.text === "string").map((p: any) => p.text).join("") ?? "";
        if (!text) throw new Error(`${model} returned no text (${body?.candidates?.[0]?.finishReason || body?.promptFeedback?.blockReason || "empty"})`);
        return text;
      } catch (e: any) {
        lastErr = e?.name === "AbortError" ? `${model} timed out` : e?.message || String(e);
        if (!/HTTP 4\d\d/.test(lastErr)) { keyIdx++; continue; }
        throw new Error(lastErr);
      } finally { clearTimeout(timer); }
    }
    throw new Error(lastErr || `${model} unavailable`);
  }

  return {
    status: () => ({ configured: keys.length > 0, models, keys: keys.length, lastError }),
    async complete<T>(req: LlmRequest<T>): Promise<LlmResult<T>> {
      const role = req.role || "main";
      const primary = models[role], fallback = role === "main" ? models.reviewer : models.main;
      const user = scrubPii(req.user).text;
      const jsonSchema = toGeminiSchema(req.schema);
      const temperature = req.temperature ?? 0;
      const useCache = req.cache !== false;
      const key = createHash("sha256").update(JSON.stringify([role, req.system, user, jsonSchema, temperature])).digest("hex");
      if (useCache) {
        const hit = await cacheGet(key);
        if (hit) {
          const parsed = req.schema.safeParse(hit.response);
          if (parsed.success) return { data: parsed.data, model: hit.model, cached: true };
        }
      }
      if (!keys.length) throw new LlmUnavailableError("No Gemini API key configured");
      const errors: string[] = [];
      for (const model of [primary, fallback]) {
        for (let tries = 0; tries < 2; tries++) {
          let text: string;
          try {
            text = await callModel(model, req.system, tries === 0 ? user : user + "\n\nYour previous reply did not match the required JSON schema. Reply again with valid JSON only.", jsonSchema, temperature, req.maxOutputTokens ?? 4096);
          } catch (e: any) { errors.push(e.message); break; } // transport failure: go to the fallback model
          let json: unknown;
          try { json = JSON.parse(text); } catch { errors.push(`${model}: invalid JSON`); continue; }
          const parsed = req.schema.safeParse(json);
          if (!parsed.success) { errors.push(`${model}: schema mismatch (${parsed.error.issues[0]?.message})`); continue; }
          if (useCache) await cachePut(key, model, parsed.data);
          lastError = null;
          return { data: parsed.data, model, cached: false };
        }
      }
      lastError = errors.join("; ");
      throw new LlmUnavailableError(`AI model unavailable: ${lastError}`);
    },
  };
}

/** zod -> JSON Schema in the subset Gemini accepts. */
export function toGeminiSchema(schema: z.ZodType<any>): unknown {
  const js: any = z.toJSONSchema(schema, { target: "draft-7", unrepresentable: "any" });
  const strip = (n: any): any => {
    if (Array.isArray(n)) return n.map(strip);
    if (!n || typeof n !== "object") return n;
    const out: any = {};
    for (const [k, v] of Object.entries(n)) {
      if (k === "$schema" || k === "additionalProperties" || k === "$id") continue;
      out[k] = strip(v);
    }
    return out;
  };
  return strip(js);
}

/** A scripted LLM for tests: handler gets the request and returns the data object. */
export function createMockLlm(handler: (req: LlmRequest<any>) => unknown | Promise<unknown>): Llm & { calls: LlmRequest<any>[] } {
  const calls: LlmRequest<any>[] = [];
  return {
    calls,
    status: () => ({ configured: true, models: { main: "mock-main", reviewer: "mock-reviewer" }, keys: 1, lastError: null }),
    async complete(req) {
      calls.push(req);
      const out = await handler(req);
      if (out instanceof Error) throw out;
      return { data: req.schema.parse(out), model: req.role === "reviewer" ? "mock-reviewer" : "mock-main", cached: false };
    },
  };
}
