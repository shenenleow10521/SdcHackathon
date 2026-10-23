// API smoke test of every non-CV feature against a running server.
//   npx tsx scripts/smoke-api.ts http://localhost:3000            read-only (safe on production)
//   npx tsx scripts/smoke-api.ts http://localhost:3001 --write    also approves/undoes knowledge changes, creates plans
//                                                                 and employers: use a fresh database
// Staff routes use ADMIN_TOKEN from the environment (x-admin-token). Exits 1 if any check fails.
import "dotenv/config";

const base = (process.argv[2] || "http://localhost:3000").replace(/\/+$/, "") + "/api";
const write = process.argv.includes("--write");
const token = process.env.ADMIN_TOKEN || "";
let failed = 0, passed = 0;

async function call(method: string, path: string, body?: unknown, expect = [200]) {
  const t = Date.now();
  const res = await fetch(base + path, {
    method, headers: { "Content-Type": "application/json", ...(token ? { "x-admin-token": token } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await res.json().catch(() => null);
  const ok = expect.includes(res.status);
  const line = `${method.padEnd(6)} ${path} → ${res.status} (${Date.now() - t} ms)`;
  if (!ok) { failed++; console.log(`✗ ${line}  ${JSON.stringify(data?.error ?? data).slice(0, 200)}`); }
  return { ok, status: res.status, data, line };
}
function check(r: { ok: boolean; line: string; data: any }, cond: (d: any) => unknown, what: string) {
  if (!r.ok) return false;
  let good = false;
  try { good = !!cond(r.data); } catch { good = false; }
  if (good) { passed++; console.log(`✓ ${r.line}  ${what}`); } else { failed++; console.log(`✗ ${r.line}  expected: ${what}`); }
  return good;
}
const get = (p: string, e?: number[]) => call("GET", p, undefined, e);
const post = (p: string, b: unknown = {}, e?: number[]) => call("POST", p, b, e);
const put = (p: string, b: unknown, e?: number[]) => call("PUT", p, b, e);

console.log(`Smoke test: ${base} (${write ? "read + write" : "read-only"})\n`);

// ---------- foundation ----------
const health = await get("/health");
check(health, d => d.ok && d.db.ok, `db ${health.data?.db?.kind}, llm ${health.data?.llm?.ok ? "ok" : "off"}, embed ${health.data?.embed?.provider}`);
check(await get("/config"), d => typeof d.auth.enabled === "boolean", "accounts config");
const g = await get("/graph");
check(g, d => Object.keys(d.nodes).length > 30 && d.edges.length > 10, `graph v${g.data?.kbVersion}`);
check(await get("/kb/versions"), d => d.versions.length >= 1, "kb versions");

// ---------- planning (sample persona) ----------
const map = await get("/map?profile=1");
check(map, d => d.jobs.length > 0, `map: ${map.data?.jobs?.length} jobs`);
const job = map.data?.jobs?.[0]?.job ?? "esg";
check(await get(`/plan?profile=1&job=${job}&year=2030&scenario=fast`), d => d.route && d.steps.length > 0 && d.cost, `plan for ${job}`);
check(await get("/rank?profile=1&sdg=13"), d => d.jobs.length > 0, "SDG ranking");
check(await get("/jobs/search?q=carbon"), d => Array.isArray(d.results), "job search");
check(await get(`/explain?profile=1&job=${job}`), d => typeof d.text === "string" && d.text.length > 20, "explanation");
check(await get(`/studies?job=${job}`), d => Array.isArray(d.studies), "studies side by side");
check(await get("/profile/1"), d => d.isDemo === true, "sample persona");
check(await get("/profile/1/history"), d => Array.isArray(d.snapshots), "profile history");
check(await get("/plans?profile=1"), d => Array.isArray(d.plans), "saved plans");
check(await get("/skills/recon/check?profile=1"), d => d.questions.length > 0, "skill check questions");

// ---------- knowledge ----------
check(await get("/sources"), d => d.trusted.length > 10, "trusted sources");
check(await get("/sources/log"), d => d != null, "fetch log");
const runs = await get("/scout/runs");
check(runs, d => d.runs.length >= 1, "Road Watch runs");
if (runs.data?.runs?.[0]) check(await get(`/scout/runs/${runs.data.runs[0].id}`), d => d.run || d.id, "one run");
check(await get("/signals"), d => Array.isArray(d.signals), "applied signals");
const review = await get("/review");
check(review, d => Array.isArray(d.pending), `review queue: ${review.data?.pending?.length} pending, ${review.data?.emerging?.length} emerging`);

// ---------- employers & HR ----------
const emps = await get("/employers");
check(emps, d => d.employers.length > 0, "employers");
const emp = emps.data?.employers?.[0];
if (emp) {
  check(await get(`/employers/${emp.id}`), d => Array.isArray(d.requirements), `employer ${emp.name}`);
  check(await get(`/employers/${emp.id}/match?profile=1${emp.jobs?.[0] ? `&job=${emp.jobs[0]}` : ""}`), d => typeof d.match === "number", "employer match");
}
// The HR view: the employer that has a team (the sample shared-services centre).
let hr: Awaited<ReturnType<typeof get>> | null = null;
for (const e of emps.data?.employers ?? []) {
  const r = await get(`/hr/${e.id}/redeployment`);
  if (!r.ok || r.data?.team?.length) { hr = r; break; }
}
if (hr) check(hr, d => d.team.length > 0 && d.totals, `HR view: ${hr.data?.team?.length} people`);
else { failed++; console.log("✗ HR view: no employer has a team"); }
check(await get("/advisor/queue"), d => Array.isArray(d.plans), "advisor queue");

// ---------- ESCO / exposure ----------
check(await get("/esco/stats"), d => d.available && d.counts.occupations > 3000, "ESCO stats");
const occ = await get("/esco/occupations?q=accountant&limit=5");
check(occ, d => d.results.length > 0, "ESCO occupation search");
const occId = occ.data?.results?.[0]?.id;
if (occId) {
  check(await get(`/esco/occupations/${occId}?profile=1`), d => typeof d.match === "number" && d.essential.length > 0, "ESCO job detail");
  check(await get(`/esco/occupations/${occId}/next`), d => d != null, "ESCO next jobs");
}
check(await get("/esco/skills?q=reconcil&limit=5"), d => d.results.length > 0, "ESCO skill search");
check(await get("/esco/profile/1/skills"), d => Array.isArray(d.skills), "confirmed ESCO skills");
check(await get("/esco/profile/1/best-jobs"), d => d != null, "best ESCO jobs");
check(await get("/exposure/model"), d => typeof d.trained === "boolean", "exposure model info");
const sc = await post("/exposure/score", { tasks: ["Reconcile vendor statements with the ledger"] }, [200, 503]);
if (sc.status === 503) { passed++; console.log(`✓ ${sc.line}  (no bge-m3 embeddings here: 503 as documented)`); }
else check(sc, d => d.scores[0].exposure >= 0, "exposure score");

// ---------- write path (fresh database only) ----------
if (write) {
  console.log("\n-- write path --");
  // Road Watch replay and the committee
  check(await post("/scout/run", { replay: true }, [200, 502]), d => d.runId, "Road Watch replay");
  // A fresh install has no recorded committee run to replay: that is a documented 502.
  check(await post("/committee/run", { replay: true }, [200, 502]),
    d => d.runId || d.candidates || /no recorded committee run/.test(d.error?.message), "emerging-skill committee (replay)");
  // Approve → reroute → undo
  const pend = (await get("/review")).data?.pending ?? [];
  const sig = pend.find((s: any) => s.nodeId === "recon") ?? pend[0];
  if (sig) {
    const ap = await post(`/review/signals/${sig.id}/approve`, { note: "smoke test" });
    check(ap, d => d.kbVersion > 1, `approve signal #${sig.id} → v${ap.data?.kbVersion}, rerouted ${ap.data?.rerouted?.length ?? 0}`);
    if (ap.data?.kbVersion) check(await post(`/kb/versions/${ap.data.kbVersion}/undo`), d => d.kbVersion > ap.data.kbVersion, "undo that version");
  }
  const sig2 = pend.find((s: any) => s.id !== sig?.id);
  if (sig2) check(await post(`/review/signals/${sig2.id}/reject`, { note: "smoke test" }), d => d.signal.status, `reject signal #${sig2.id}`);
  const em = (await get("/review")).data?.emerging ?? [];
  const pendingEm = em.filter((c: any) => c.status !== "confirmed" && c.status !== "rejected");
  if (pendingEm[0]) check(await post(`/review/emerging/${pendingEm[0].id}/confirm`), d => d.kbVersion, "confirm emerging skill");
  if (pendingEm[1]) check(await post(`/review/emerging/${pendingEm[1].id}/reject`), d => d.candidate, "reject emerging skill");
  // Plans and advisor
  const plan = await post("/plans", { profileId: 1, job, mode: "noregret" }, [201]);
  check(plan, d => d.plan.status === "draft", "save plan");
  const pid = plan.data?.plan?.id;
  if (pid) {
    check(await post(`/plans/${pid}/send`, { note: "smoke" }), d => d.plan.status === "sent", "send to advisor");
    check(await post(`/plans/${pid}/decision`, { decision: "changes", note: "Add a course" }), d => d.plan.status === "changes_requested", "advisor asks for changes");
    check(await post(`/plans/${pid}/send`, {}), d => d.plan.status === "sent", "send again");
    check(await post(`/plans/${pid}/decision`, { decision: "approve" }), d => d.plan.status === "approved", "advisor approves");
  }
  // Employer form
  const skill = Object.entries<any>(g.data?.nodes ?? {}).find(([, n]) => n.type === "skill")?.[0];
  const ne = await post("/employers", { name: "Smoke Test Sdn Bhd", sector: "Finance", requirements: [{ occupationId: job, skillId: skill, weight: 2, levelNeeded: 3 }] }, [201]);
  check(ne, d => d.employer.verified === false, "employer form saved, unverified");
  check(await post("/employers/extract", { url: "https://example.com/careers" }), d => d.rejected, "careers extract rejects an unapproved site");
  // A non-demo profile (sample HR team member): edit, skills, ESCO skills, a skill check
  const member = hr?.data?.team?.[0]?.profileId;
  if (member) {
    check(await put(`/profile/${member}`, { hours: 7 }), d => d.profile.hours === 7, "edit profile settings");
    check(await put(`/profile/${member}/skills`, { skills: [{ skillId: "excel", level: 3 }] }), d => d.profile.level.excel === 3, "set a skill level");
    const es = await get("/esco/skills?q=spreadsheet&limit=1");
    const esId = es.data?.results?.[0]?.id;
    if (esId) check(await put(`/esco/profile/${member}/skills`, { add: [esId] }), d => d.skills.includes(esId), "confirm an ESCO skill");
    const chk = await get(`/skills/excel/check?profile=${member}`);
    if (check(chk, d => d.checkId, "start a skill check"))
      check(await post("/skills/excel/check", { profileId: member, checkId: chk.data.checkId, answers: Object.fromEntries(chk.data.questions.map((q: any) => [q.id, 0])) }),
        d => typeof d.passed === "boolean", "submit the check");
  }
  check(await put("/profile/1", { hours: 9 }, [403]), () => true, "sample persona stays read-only (403)");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
