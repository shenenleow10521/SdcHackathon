// LLM wrapper. One call shape for every agent:
//   llm.complete({ system, user, schema })  ->  { data, model, cached }
// Two providers: the KrackedDevs proxy (OpenAI-compatible, GPT + DeepSeek) and Google Gemini.
// - Output is forced to JSON with the zod schema (converted to JSON Schema) and validated again here.
// - Every response is cached in llm_cache by a hash of model + prompt + schema (demo reliability, lower cost).
// - Rate limits / server errors rotate to the next API key, then to the fallback model.
// - Personal details are scrubbed from the user text before it leaves the server (defence in depth).
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Db } from "./db.ts";
import { scrubPii } from "./pii.ts";

export type VoterSeat = "evidence" | "skill" | "sceptic";
export interface LlmRequest<T> {
  system: string;
  user: string;
  schema: z.ZodType<T>;
  /** 'main' for most agents; 'reviewer' uses a different model, so a second model checks the first. */
  role?: "main" | "reviewer";
  /** A voter on the three-agent panel. If the provider has a model for this seat, that model answers. */
  voter?: VoterSeat;
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
/** KrackedDevs proxy defaults. The three voters use models from two vendors, so the panel is not one model voting three times. */
export const KRACKEDDEVS_MODELS = { main: "gpt-5.5", reviewer: "DeepSeek-V4-Pro" };
export const KRACKEDDEVS_VOTERS: Record<VoterSeat, string> = { evidence: "gpt-5.5", skill: "gpt-6-sol", sceptic: "DeepSeek-V4-Pro" };
export const KRACKEDDEVS_BASE_URL = "https://litellm.rapidscreen.io/v1";

/** Every Gemini key in the environment: GEMINI_API_KEY, GEMINI_API_KEY_2, ..., gemini_key, gemini_key_2, ... (deduplicated, in order). */
export function geminiKeysFromEnv(env = process.env): string[] {
  const order = (name: string) => Number((name.match(/_(\d+)$/) || [, "1"])[1]);
  return Object.keys(env)
    .filter(n => /^(GEMINI_API_KEY|gemini_key)(_\d+)?$/i.test(n))
    .sort((a, b) => order(a) - order(b) || a.localeCompare(b))
    .map(n => (env[n] || "").trim().replace(/^["']|["']$/g, ""))
    .filter((k, i, a) => k && a.indexOf(k) === i);
}

/** Sends one prompt to one model with one key and returns the raw JSON text. */
type Transport = (args: { model: string; key: string; system: string; user: string; jsonSchema: unknown; temperature: number; maxOutputTokens: number; signal: AbortSignal }) =>
  Promise<{ retry: boolean; error: string } | { text: string }>;

interface LlmOpts { db?: Db; keys: string[]; fetch?: typeof fetch; timeoutMs?: number }

export function createGeminiLlm(opts: LlmOpts & { models?: Partial<typeof DEFAULT_MODELS> }): Llm {
  const doFetch = opts.fetch || fetch;
  const transport: Transport = async ({ model, key, system, user, jsonSchema, temperature, maxOutputTokens, signal }) => {
    const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: "user", parts: [{ text: user }] }],
        generationConfig: { temperature, maxOutputTokens, responseMimeType: "application/json", responseJsonSchema: jsonSchema },
      }),
    });
    if (res.status === 429 || res.status >= 500 || res.status === 403) return { retry: true, error: `${model} HTTP ${res.status}` };
    const body: any = await res.json();
    if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${body?.error?.message || "error"}`);
    const text = body?.candidates?.[0]?.content?.parts?.filter((p: any) => typeof p.text === "string").map((p: any) => p.text).join("") ?? "";
    if (!text) throw new Error(`${model} returned no text (${body?.candidates?.[0]?.finishReason || body?.promptFeedback?.blockReason || "empty"})`);
    return { text };
  };
  return buildLlm(opts, { main: opts.models?.main || DEFAULT_MODELS.main, reviewer: opts.models?.reviewer || DEFAULT_MODELS.reviewer }, {}, transport, toGeminiSchema, "Gemini");
}

/** The KrackedDevs LiteLLM proxy (OpenAI chat-completions format). */
export function createKrackedLlm(opts: LlmOpts & { baseUrl?: string; models?: Partial<typeof KRACKEDDEVS_MODELS>; voters?: Partial<Record<VoterSeat, string>> }): Llm {
  const doFetch = opts.fetch || fetch;
  const baseUrl = (opts.baseUrl || KRACKEDDEVS_BASE_URL).replace(/\/+$/, "");
  const transport: Transport = async ({ model, key, system, user, jsonSchema, temperature, maxOutputTokens, signal }) => {
    // GPT models here are reasoning models: they reject temperature, and hidden reasoning counts against the token limit.
    const gpt = /^gpt-/i.test(model);
    const res = await doFetch(`${baseUrl}/chat/completions`, {
      method: "POST", signal,
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
        response_format: { type: "json_schema", json_schema: { name: "answer", strict: false, schema: jsonSchema } },
        ...(gpt ? { reasoning_effort: "low", max_completion_tokens: maxOutputTokens + 2048 } : { temperature, max_tokens: maxOutputTokens }),
      }),
    });
    if (res.status === 429 || res.status >= 500 || res.status === 403) return { retry: true, error: `${model} HTTP ${res.status}` };
    const body: any = await res.json();
    if (!res.ok) throw new Error(`${model} HTTP ${res.status}: ${String(body?.error?.message || "error").slice(0, 200)}`);
    const text = body?.choices?.[0]?.message?.content ?? "";
    if (!text) throw new Error(`${model} returned no text (${body?.choices?.[0]?.finish_reason || "empty"})`);
    return { text: String(text).replace(/^```(?:json)?\s*|\s*```$/g, "") };
  };
  const toSchema = (s: z.ZodType<any>) => { const js: any = z.toJSONSchema(s, { target: "draft-7", unrepresentable: "any" }); delete js.$schema; return js; };
  return buildLlm(opts, { main: opts.models?.main || KRACKEDDEVS_MODELS.main, reviewer: opts.models?.reviewer || KRACKEDDEVS_MODELS.reviewer },
    { ...KRACKEDDEVS_VOTERS, ...opts.voters }, transport, toSchema, "KrackedDevs");
}

function buildLlm(opts: LlmOpts, models: { main: string; reviewer: string }, voters: Partial<Record<VoterSeat, string>>,
  transport: Transport, toSchema: (s: z.ZodType<any>) => unknown, provider: string): Llm {
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
        const r = await transport({ model, key, system, user, jsonSchema, temperature, maxOutputTokens, signal: ctrl.signal });
        if ("retry" in r) { lastErr = r.error; keyIdx++; continue; } // try the next key
        return r.text;
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
      const base = models[role];
      const primary = (req.voter && voters[req.voter]) || base;
      const fallback = primary !== base ? base : role === "main" ? models.reviewer : models.main;
      const user = scrubPii(req.user).text;
      const jsonSchema = toSchema(req.schema);
      const temperature = req.temperature ?? 0;
      const useCache = req.cache !== false;
      // The model name is part of the key, so switching models never serves another model's old answer.
      const key = createHash("sha256").update(JSON.stringify([primary, role, req.system, user, jsonSchema, temperature])).digest("hex");
      if (useCache) {
        const hit = await cacheGet(key);
        if (hit) {
          const parsed = req.schema.safeParse(hit.response);
          if (parsed.success) return { data: parsed.data, model: hit.model, cached: true };
        }
      }
      if (!keys.length) throw new LlmUnavailableError(`No ${provider} API key configured`);
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
