// Light checks for the web UI (no browser): translations are complete, the page only references files that exist,
// every module import resolves, and the API wrapper turns every failure into a typed error the UI can degrade on.
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
// @ts-ignore — plain ES modules shared with the browser
import { api, get, post, qs, setFetch, ApiError } from "../web/js/api.js";
// @ts-ignore
import { esc } from "../web/js/util.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const web = path.join(root, "web");
const en = JSON.parse(readFileSync(path.join(web, "i18n/en.json"), "utf8")) as Record<string, string>;
const ms = JSON.parse(readFileSync(path.join(web, "i18n/ms.json"), "utf8")) as Record<string, string>;

function jsFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(f => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? jsFiles(p) : p.endsWith(".js") ? [p] : [];
  });
}
const modules = jsFiles(path.join(web, "js"));
const source = modules.map(f => readFileSync(f, "utf8")).join("\n");
const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

describe("i18n", () => {
  it("every English key exists in Bahasa Melayu with the same placeholders", () => {
    const missing = Object.keys(en).filter(k => !(k in ms));
    expect(missing).toEqual([]);
    const bad = Object.keys(en).filter(k => k in ms && placeholders(en[k]).join() !== placeholders(ms[k]).join());
    expect(bad).toEqual([]);
    expect(Object.values(ms).every(v => typeof v === "string" && v.trim().length > 0)).toBe(true);
  });

  it("every static t('key') used in the code exists in en.json", () => {
    const used = new Set([...source.matchAll(/\bt(?:Or)?\("([A-Za-z0-9_.]+)"/g)].map(m => m[1]));
    const html = readFileSync(path.join(web, "index.html"), "utf8");
    for (const m of html.matchAll(/data-i18n(?:-aria|-title|-ph)?="([^"]+)"/g)) used.add(m[1]);
    const missing = [...used].filter(k => !k.endsWith(".") && !(k in en));
    expect(missing).toEqual([]);
  });

  it("dynamic key families are complete", () => {
    const fam: Record<string, string[]> = {
      "mode.": ["fastest", "noregret", "safest"], "mode.note.": ["fastest", "noregret", "safest"], "why.weeksMode.": ["fastest", "noregret", "safest"],
      "scn.": ["moderate", "fast"], "risk.": ["Low", "Medium", "High"], "jobs.risk.": ["Low", "Medium", "High"],
      "level.": ["1", "2", "3", "4", "5"], "conf.": ["cv", "self", "verified", "High", "Medium", "Low"],
      "impact.": ["Declining", "Changing", "Durable", "Rising human skill"], "impact.why.": ["Declining", "Changing", "Durable", "Rising human skill"],
      "step.": ["start", "reuse", "upskill", "evolve", "reskill", "arrive"], "admin.sub.": ["queue", "runs", "versions", "sources"],
      "scout.c.": ["fetched", "candidates", "rejected", "duplicates", "auto", "flagged"], "status.aria.": ["ok", "partial", "down"],
      "sheet.": ["advisor", "hr", "employer", "advisor.kicker", "hr.kicker", "employer.kicker"], "plan.status.": ["draft", "sent", "approved", "changes"],
      "split.": ["you", "youShort"],
      "stress.why.": ["open", "ready", "worth"], "stress.in.": ["speed", "estimate", "hours", "weeks", "deadline"],
      "stress.when.": ["speed.high", "speed.low", "hours.low", "hours.lowAny", "hours.high", "weeks.high", "weeks.low", "estimate.high", "estimate.low"],
      "guide.t.": ["job", "mode", "future", "scout", "signal"], "guide.d.": ["job", "mode", "future", "scout", "signal"],
    };
    const missing = Object.entries(fam).flatMap(([p, ks]) => ks.map(k => p + k)).filter(k => !(k in en));
    expect(missing).toEqual([]);
  });
});

describe("static files", () => {
  it("index.html references only files that exist (or pinned CDN versions)", () => {
    const html = readFileSync(path.join(web, "index.html"), "utf8");
    const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1]);
    const local = refs.filter(r => !/^(https?:)?\/\//.test(r) && !r.startsWith("mailto:"));
    expect(local.length).toBeGreaterThan(2);
    for (const r of local) expect(existsSync(path.join(web, r.replace(/^\//, ""))), r).toBe(true);
    const scripts = refs.filter(r => /^https:\/\/(unpkg\.com|cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//.test(r));
    expect(scripts.length).toBe(3);
    for (const s of scripts) expect(s, s).toMatch(/@\d+\.\d+\.\d+|\/\d+\.\d+\.\d+\//);
  });

  it("every module import resolves to a file", () => {
    for (const f of modules) {
      const text = readFileSync(f, "utf8");
      for (const m of text.matchAll(/(?:import|export)\s[^'"]*?from\s+"([^"]+)"/g)) {
        const spec = m[1];
        const target = spec.startsWith("/shared/") ? path.join(root, spec) : path.resolve(path.dirname(f), spec);
        expect(existsSync(target), `${path.relative(root, f)} → ${spec}`).toBe(true);
      }
    }
  });

  it("the frontend holds no secrets", () => {
    expect(source).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|rpa_[A-Za-z0-9]{20,}/);
  });

  it("the app's asset paths are absolute, so it works at /app and /app/", () => {
    const html = readFileSync(path.join(web, "index.html"), "utf8");
    const refs = [...html.matchAll(/(?:src|href)="([^"#]+)"/g)].map(m => m[1]).filter(r => !/^(https?:)?\/\//.test(r));
    for (const r of refs) expect(r, r).toMatch(/^\//);
  });

  it("landing.html: no external scripts, no secrets, CTAs go to /app, images exist", () => {
    const html = readFileSync(path.join(web, "landing.html"), "utf8");
    expect([...html.matchAll(/<script[^>]*\ssrc=/g)]).toEqual([]);
    expect(html).not.toMatch(/AIza[0-9A-Za-z_-]{20,}|sk-[A-Za-z0-9]{20,}|type="password"/);
    expect(html).not.toMatch(/halatuju-app\.html|fetch\(/);
    expect(html).toMatch(/href="\/app"/);
    for (const m of html.matchAll(/src="(\/assets\/[^"]+)"/g)) expect(existsSync(path.join(web, m[1])), m[1]).toBe(true);
    for (const m of html.matchAll(/<link[^>]+href="(https?:[^"]+)"/g)) expect(m[1]).toMatch(/^https:\/\/fonts\.(googleapis|gstatic)\.com/);
  });
});

describe("api.js", () => {
  afterEach(() => setFetch((...a: any[]) => (globalThis.fetch as any)(...a)));
  const reply = (status: number, body: unknown, raw = false) => async () =>
    new Response(raw ? (body as string) : JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("returns parsed JSON on success and builds query strings", async () => {
    let url = "";
    setFetch(async (u: string) => { url = u; return reply(200, { ok: true })(); });
    expect(await get("/health", { profile: 1, sdg: null, q: "data analyst" })).toEqual({ ok: true });
    expect(url).toBe("/api/health?profile=1&q=data+analyst");
    expect(qs(null)).toBe("");
  });

  it("sends JSON bodies", async () => {
    let init: any;
    setFetch(async (_u: string, i: any) => { init = i; return reply(201, { plan: { id: 1 } })(); });
    await post("/plans", { job: "esgRole" });
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(init.body)).toEqual({ job: "esgRole" });
  });

  it("maps the server's { error: { code, message } } shape", async () => {
    setFetch(reply(409, { error: { code: "invalid_state", message: "Plan is 'sent'" } }));
    const e = await api("/plans/1/send").catch((x: any) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect([e.status, e.code, e.message, e.notAvailable, e.offline]).toEqual([409, "invalid_state", "Plan is 'sent'", false, false]);
  });

  it("treats a missing route or 501 as 'not available yet'", async () => {
    setFetch(reply(404, { error: { code: "not_found", message: "No API route: GET /studies" } }));
    expect((await api("/studies").catch((x: any) => x)).notAvailable).toBe(true);
    setFetch(reply(404, { error: { code: "not_found", message: "Profile not found" } }));
    expect((await api("/profile/9").catch((x: any) => x)).notAvailable).toBe(false);
    setFetch(reply(501, "", true));
    expect((await api("/x").catch((x: any) => x)).notAvailable).toBe(true);
  });

  it("network failures, 5xx, non-JSON and timeouts become retryable errors", async () => {
    setFetch(async () => { throw new TypeError("Failed to fetch"); });
    const net = await api("/graph").catch((x: any) => x);
    expect([net.code, net.offline]).toEqual(["network", true]);

    setFetch(reply(503, { error: { code: "unavailable", message: "AI busy" } }));
    expect((await api("/explain").catch((x: any) => x)).offline).toBe(true);

    setFetch(reply(200, "<html>proxy error</html>", true));
    expect((await api("/graph").catch((x: any) => x)).code).toBe("bad_response");

    setFetch((_u: string, init: any) => new Promise((_res, rej) => init.signal.addEventListener("abort", () => rej(new Error("aborted")))));
    const to = await api("/graph", { timeout: 20 }).catch((x: any) => x);
    expect([to.code, to.offline]).toEqual(["timeout", true]);
  });
});

describe("escaping", () => {
  it("escapes HTML from API data", () => {
    expect(esc(`<img src=x onerror="alert(1)">'&`)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;&#39;&amp;");
    expect(esc(null)).toBe("");
  });
});
