// Discovers "bridges": pairs of ESCO skills from DIFFERENT fields whose underlying work is similar, so a person can
// carry what they do across fields. Within-field links come from co-occurrence (server/services/skill-network.ts);
// bridges are exactly the pairs co-occurrence cannot see, because no single ESCO job lists both ends.
//
// Method (details and parameters in server/services/bridges.ts, BRIDGE_PARAMS):
//   1. Work profile per skill over O*NET Detailed Work Activities (DWAs, ~2,000 cross-occupation activities):
//        skill -> ESCO occupations (essential 1.0, optional 0.5) -> crosswalked O*NET occupation -> its task statements
//        -> the DWAs O*NET links each task to.
//      Each task counts by how much it is about THIS skill (bge-m3 cosine of skill text and task text, above a floor),
//      so "check accounting records" picks up an accountant's checking tasks, not their client meetings.
//      DWAs are idf-weighted over occupations, so generic activities ("Maintain records") count less.
//   2. Bridge score = cosine of work profiles, for practical skills only (ESCO type "skill"), for pairs that ESCO's
//      jobs keep apart (no shared occupation, different ISCO major-group mix), with a bge-m3 skill-to-skill cosine
//      floor so pairs aren't nonsense.
//   3. Evidence from data only: the shared DWAs, the task statements behind them on each side, example occupations.
//   4. Every discovered bridge is "proposed" until a person approves it. The hand-made routes (knowledge.json) that map
//      to ESCO are carried as "approved", source "team".
//
// Sources and licences:
//   O*NET 30.2 Database (Task Statements, Tasks to DWAs, DWA Reference, IWA Reference, Content Model Reference), U.S. Department of Labor,
//   Employment and Training Administration (USDOL/ETA), https://www.onetcenter.org/database.html, CC BY 4.0.
//   "This page includes information from the O*NET 30.2 Database by the U.S. Department of Labor, Employment and
//   Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. O*NET® is a trademark of USDOL/ETA. We have
//   modified all or some of this information. USDOL/ETA has not approved, endorsed, or tested these modifications."
//   ESCO v1.2.1 (European Commission), CC BY 4.0, and the ESCO-O*NET crosswalk (db/seed/esco_onet.json.gz).
//
// Stages (run in order; each writes a file the next one reads):
//   npx tsx scripts/discover-bridges.ts prepare   raw O*NET text files (data/raw/onet_dwa, downloaded if missing)
//                                                  -> db/seed/onet_dwa.json.gz (compact: crosswalked occupations only)
//   npx tsx scripts/discover-bridges.ts embed     bge-m3 (RunPod) vectors for task statements and DWA titles
//                                                  -> data/onet_work_vectors.bin + .meta.json (build input, not shipped)
//   npx tsx scripts/discover-bridges.ts build     -> db/seed/esco_bridges.json.gz
import "dotenv/config";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import path from "node:path";
import { projectRoot } from "../server/lib/db.ts";

const stage = process.argv[2] || "build";
const RAW = path.join(projectRoot, "data", "raw", "onet_dwa");
const ONET_VERSION = "30.2";
const ONET_BASE = `https://www.onetcenter.org/dl_files/database/db_${ONET_VERSION.replace(".", "_")}_text`;
const ONET_FILES = ["Task Statements", "Tasks to DWAs", "DWA Reference", "IWA Reference", "Content Model Reference"];
const seedPath = (f: string) => path.join(projectRoot, "db", "seed", f);
const readGz = (f: string) => JSON.parse(gunzipSync(readFileSync(seedPath(f))).toString("utf8"));
const VEC_BIN = path.join(projectRoot, "data", "onet_work_vectors.bin");
const VEC_META = path.join(projectRoot, "data", "onet_work_vectors.meta.json");

async function rawTable(name: string): Promise<string[][]> {
  const f = path.join(RAW, name.replace(/ /g, "_") + ".txt");
  if (!existsSync(f)) {
    mkdirSync(RAW, { recursive: true });
    const res = await fetch(`${ONET_BASE}/${encodeURIComponent(name)}.txt`);
    if (!res.ok) throw new Error(`O*NET ${name}: HTTP ${res.status}`);
    writeFileSync(f, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(f, "utf8").split(/\r?\n/).slice(1).filter(Boolean).map(l => l.split("\t"));
}

async function prepare() {
  const crosswalk = readGz("esco_onet.json.gz");
  const codes = new Set<string>(Object.values<any>(crosswalk.occupations).map(o => o.onet));
  const [tasks, t2d, dwaRef, iwaRef, cmRef] = await Promise.all(ONET_FILES.map(rawTable));
  const dwas: Record<string, [string, string]> = {}; // DWA id -> [title, IWA id]
  for (const [, iwa, id, title] of dwaRef) dwas[id] = [title, iwa];
  const iwas: Record<string, string> = {};
  for (const [, id, title] of iwaRef) iwas[id] = title;
  // Generalized Work Activities (41): the content-model elements DWAs and IWAs sit under, e.g. 4.A.2.a.3.
  const gwas: Record<string, string> = {};
  const gwaIds = new Set(Object.keys(iwas).map(i => i.split(".").slice(0, 5).join(".")));
  for (const [id, title] of cmRef) if (gwaIds.has(id)) gwas[id] = title;
  const dwaByTask = new Map<string, string[]>();
  for (const [code, task, dwa] of t2d) {
    if (!codes.has(code) || !dwas[dwa]) continue;
    const k = `${code}|${task}`;
    dwaByTask.set(k, [...(dwaByTask.get(k) || []), dwa]);
  }
  const occ: Record<string, { tasks: [number, string, number, string[]][] }> = {};
  let nTasks = 0, nLinked = 0;
  for (const [code, task, text, type] of tasks) {
    if (!codes.has(code)) continue;
    const d = dwaByTask.get(`${code}|${task}`) || [];
    (occ[code] ||= { tasks: [] }).tasks.push([Number(task), text, type === "Core" ? 1 : 0, d]);
    nTasks++; if (d.length) nLinked++;
  }
  const out = {
    _meta: {
      generatedBy: "scripts/discover-bridges.ts prepare", generated: new Date().toISOString().slice(0, 10),
      source: `O*NET ${ONET_VERSION} Database: ${ONET_FILES.join(", ")}. ${ONET_BASE}/`,
      licence: `This file includes information from the O*NET ${ONET_VERSION} Database by the U.S. Department of Labor, Employment and Training Administration (USDOL/ETA). Used under the CC BY 4.0 license. O*NET® is a trademark of USDOL/ETA. We have modified all or some of this information. USDOL/ETA has not approved, endorsed, or tested these modifications.`,
      modifications: "Only O*NET occupations that the ESCO-O*NET crosswalk links to an ESCO occupation; task statements with their DWA links; DWA and IWA titles. Columns: tasks = [taskId, text, core (1 = Core), [DWA ids]]; dwas = {id: [title, IWA id]}; iwas = {id: title}; gwas = {Generalized Work Activity element id: title}.",
      counts: { occupations: Object.keys(occ).length, tasks: nTasks, tasksWithDwa: nLinked, dwas: Object.keys(dwas).length, iwas: Object.keys(iwas).length, gwas: Object.keys(gwas).length },
    },
    dwas, iwas, gwas, occ,
  };
  writeFileSync(seedPath("onet_dwa.json.gz"), gzipSync(JSON.stringify(out)));
  console.log("wrote db/seed/onet_dwa.json.gz", out._meta.counts);
}

// ---- embed ---------------------------------------------------------------------------------------------------
async function embed() {
  const { createEmbedder } = await import("../server/lib/embedder.ts");
  const od = readGz("onet_dwa.json.gz");
  const texts = [...new Set<string>([
    ...Object.values<any>(od.occ).flatMap((o: any) => o.tasks.map((t: any) => t[1] as string)),
    ...Object.values<any>(od.dwas).map((d: any) => d[0] as string),
  ])].sort();
  const embedder = createEmbedder({ ...process.env, EMBED_PROVIDER: process.env.EMBED_PROVIDER || "runpod" }, undefined, { timeoutMs: 240000 });
  if (embedder.provider === "none") throw new Error("No embedding provider configured");
  // Checkpoint: text -> vector, so an interrupted run resumes. (An older format keyed by chunk start index is converted.)
  const CKPT = path.join(projectRoot, "data", `onet_work_embed_checkpoint.json`);
  const raw: Record<string, number[] | number[][]> = existsSync(CKPT) ? JSON.parse(readFileSync(CKPT, "utf8")) : {};
  const done = new Map<string, number[]>();
  for (const [k, v] of Object.entries(raw)) {
    if (/^\d+$/.test(k) && Array.isArray(v[0])) (v as number[][]).forEach((vec, j) => done.set(texts[Number(k) + j], vec));
    else done.set(k, v as number[]);
  }
  const save = () => writeFileSync(CKPT, JSON.stringify(Object.fromEntries(done)));
  // RunPod's gateway is slow per connection for large responses (1,024 floats per text as JSON), and GPU time is
  // well under a second per batch, so small batches go out over several connections at once.
  const CHUNK = 24, PARALLEL = Number(process.env.EMBED_PARALLEL || 8);
  const todo = texts.filter(t => !done.has(t));
  const chunks: string[][] = [];
  for (let i = 0; i < todo.length; i += CHUNK) chunks.push(todo.slice(i, i + CHUNK));
  console.log(`${done.size} cached, ${todo.length} to embed in ${chunks.length} requests, ${PARALLEL} at a time`);
  const t0 = Date.now();
  let next = 0, finished = 0;
  const worker = async () => {
    while (next < chunks.length) {
      const c = chunks[next++];
      let vecs: number[][] | undefined;
      for (let attempt = 1; !vecs; attempt++) {
        try { vecs = await embedder.embed(c); if (vecs.length !== c.length) throw new Error(`got ${vecs.length} vectors for ${c.length} texts`); }
        catch (e: any) {
          vecs = undefined;
          if (attempt >= 8) throw e;
          console.log(`request failed: ${e.message}; retry ${attempt}`);
          await new Promise(r => setTimeout(r, 10000 * Math.min(attempt, 4)));
        }
      }
      c.forEach((t, j) => done.set(t, vecs![j].map(x => Math.round(x * 1e4) / 1e4)));
      if (++finished % 40 === 0) { save(); console.log(`${done.size} / ${texts.length} (${Math.round((Date.now() - t0) / 1000)} s)`); }
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  save();
  const n = texts.length, dims = done.get(texts[0])!.length;
  const q = new Int8Array(n * dims), scales = new Float32Array(n);
  texts.forEach((t, i) => {
    const v = done.get(t)!;
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
    const max = Math.max(...v.map(x => Math.abs(x / norm))) || 1;
    scales[i] = max / 127;
    for (let k = 0; k < dims; k++) q[i * dims + k] = Math.round(v[k] / norm / max * 127);
  });
  writeFileSync(VEC_BIN, Buffer.concat([Buffer.from(q.buffer), Buffer.from(scales.buffer)]));
  writeFileSync(VEC_META, JSON.stringify({ model: embedder.model, provider: embedder.provider, dims, count: n, texts, generated: new Date().toISOString() }));
  console.log(`wrote ${VEC_BIN} (${n} texts, ${dims} dims, ${Math.round((Date.now() - t0) / 1000)} s)`);
}

// ---- build ---------------------------------------------------------------------------------------------------
async function build() {
  const { loadBridgeInput, catalogueToEsco } = await import("./bridge-input.ts");
  const B = await import("../server/services/bridges.ts");
  const t0 = Date.now();
  const { input, esco, onetMeta, vectorsMeta } = loadBridgeInput();
  const ctx = B.buildContext(input);
  console.log(`profiles: ${ctx.profiles.size} practical skills (${Math.round((Date.now() - t0) / 1000)} s)`);
  const found = B.discover(ctx);
  console.log(`discovered from ${found.size} skills (${Math.round((Date.now() - t0) / 1000)} s)`);

  // String tables.
  const tab = <T>() => { const ix = new Map<T, number>(), list: T[] = []; return { list, id: (x: T) => { if (!ix.has(x)) { ix.set(x, list.length); list.push(x); } return ix.get(x)!; } }; };
  const skills = tab<string>(), acts = tab<string>(), tasks = tab<string>(), occs = tab<string>();
  const rows: any[] = [];
  for (const list of found.values()) for (const c of list) {
    const ev = B.evidence(c.from, c.to, ctx);
    rows.push([skills.id(c.from), skills.id(c.to), Math.round(c.score * 1000), 0, 0,
      ev.keys.map(k => acts.id(k)), ev.tasksFrom.map(t => tasks.id(t)), ev.tasksTo.map(t => tasks.id(t)),
      ev.occFrom.map(o => occs.id(o)), ev.occTo.map(o => occs.id(o))]);
  }
  const nDiscovered = rows.length;
  // The team's hand-made skill -> skill routes, mapped to ESCO: approved. Evidence filled where the data has some.
  const { cat, edges } = catalogueToEsco();
  let nTeam = 0;
  const teamSkipped: string[] = [];
  for (const e of edges) {
    const a = cat.get(e.from)?.id, b = cat.get(e.to)?.id;
    if (!a || !b || a === b) { teamSkipped.push(`${e.from}->${e.to}`); continue; }
    const pa = ctx.profiles.get(a), pb = ctx.profiles.get(b);
    // Data evidence only where the data shows real shared work (score >= minScore / 3 and a shared DWA or IWA);
    // otherwise the route keeps just the team's own sentence, so the app never dresses up a thin match as evidence.
    const work = B.checkPair(a, b, ctx).score;
    const supported = !!pa && !!pb && work >= ctx.params.minScore / 3 && B.sharesSpecific(pa, pb);
    const ev = supported ? B.evidence(a, b, ctx) : { keys: [] as string[], tasksFrom: [] as string[], tasksTo: [] as string[], occFrom: [] as string[], occTo: [] as string[] };
    rows.push([skills.id(a), skills.id(b), Math.round(work * 1000), 1, 1,
      ev.keys.map(k => acts.id(k)), ev.tasksFrom.map(t => tasks.id(t)), ev.tasksTo.map(t => tasks.id(t)),
      ev.occFrom.map(o => occs.id(o)), ev.occTo.map(o => occs.id(o)), e.why]);
    nTeam++;
  }
  const fields = skills.list.map(s => B.mainField(s, ctx));
  const fieldPairs = new Set(rows.slice(0, nDiscovered).map(r => [fields[r[0]], fields[r[1]]].sort().join("-")));
  const fieldsTouched = new Set(rows.slice(0, nDiscovered).flatMap(r => [fields[r[0]], fields[r[1]]]).filter(Boolean));
  const crossMain = rows.slice(0, nDiscovered).filter(r => fields[r[0]] !== fields[r[1]]).length;
  const fam = (i: number) => B.fieldFamily(fields[i]);
  const familyPairs = new Set(rows.slice(0, nDiscovered).map(r => [fam(r[0]), fam(r[1])].sort().join(" | ")));
  const families = new Set(rows.slice(0, nDiscovered).flatMap(r => [fam(r[0]), fam(r[1])]));
  const file = {
    _meta: {
      generatedBy: "scripts/discover-bridges.ts build", generated: new Date().toISOString(),
      method: "Work profile per ESCO skill = what the work involves, as idf-weighted O*NET work activities at three levels of O*NET's hierarchy (Detailed, Intermediate and Generalized Work Activities, joined with levelWeights: a hierarchical soft cosine) of the O*NET task statements (via the ESCO-O*NET crosswalk) of the ESCO occupations needing the skill, each task weighted by bge-m3 skill-task cosine. Score = profile cosine x sqrt(confidence of both profiles). A bridge joins practical skills that no ESCO occupation lists together, with different job contexts (second-order co-occurrence cosine <= maxContext), mainly needed in different fields (ISCO-08 sub-major group of most use, mapped to 12 level-free field families), evidenced by different O*NET occupations (code overlap <= maxCodeOverlap), sharing at least one DWA or IWA, with bge-m3 skill cosine >= minCos and score >= minScore; top perSkill per source skill. Evidence = the shared activities and the O*NET task statements and ESCO occupations behind them. Discovered bridges are 'proposed' until a person approves them; team routes carry score = the same measure (0 when the data sees no shared work) and data evidence only when score >= minScore/3 with a shared DWA or IWA. See server/services/bridges.ts.",
      params: ctx.params,
      sources: {
        onet: onetMeta.source, onetLicence: onetMeta.licence,
        esco: "ESCO v1.2.1 (European Commission), CC BY 4.0. This service uses the ESCO classification of the European Commission.",
        crosswalk: "ESCO-O*NET Crosswalk v1 (ESCO Secretariat with U.S. DOL/ETA, Sep 2022), via db/seed/esco_onet.json.gz",
        embeddings: `${vectorsMeta.model} (${vectorsMeta.provider}); skill vectors db/seed/esco_skill_vectors.bin, task/DWA vectors ${vectorsMeta.generated}`,
        team: "db/seed/knowledge.json skill -> skill routes, mapped to ESCO via db/seed/esco_map.json (two keyword picks: three, ghg)",
      },
      format: "bridges: [from, to, score x 1000, status (0 proposed, 1 approved), source (0 discovered, 1 team), [activity], [taskFrom], [taskTo], [occFrom], [occTo], why?] with indexes into skills/activities/tasks/occs; activities are O*NET DWA, IWA or GWA titles; fields = ISCO-08 sub-major group where each skill is most needed. Decoded by server/services/bridges.ts.",
      counts: {
        practicalSkillsWithProfile: ctx.profiles.size, sourceSkillsWithBridges: found.size, discovered: nDiscovered,
        distinctPairs: new Set(rows.slice(0, nDiscovered).map(r => [r[0], r[1]].sort().join("-"))).size,
        crossMainField: crossMain, iscoSubMajorGroupsTouched: fieldsTouched.size, iscoFieldPairs: fieldPairs.size,
        fieldFamiliesTouched: families.size, fieldFamilyPairs: familyPairs.size,
        team: nTeam, teamSkipped,
      },
    },
    skills: skills.list, titles: skills.list.map(s => esco.skills[s].title), fields,
    activities: acts.list.map(k => B.activityTitle(k, input)), tasks: tasks.list.map(t => input.tasks[t].text),
    occs: occs.list.map(o => [o, esco.occupations[o].title]),
    bridges: rows,
  };
  const gz = gzipSync(JSON.stringify(file));
  writeFileSync(seedPath("esco_bridges.json.gz"), gz);
  console.log(`wrote db/seed/esco_bridges.json.gz (${(gz.length / 1e6).toFixed(2)} MB)`, file._meta.counts, `${Math.round((Date.now() - t0) / 1000)} s`);
}

if (stage === "prepare") await prepare();
else if (stage === "embed") await embed();
else if (stage === "build") await build();
else throw new Error(`unknown stage ${stage}`);
