// Real inputs for the bridge discovery (server/services/bridges.ts), shared by scripts/discover-bridges.ts and
// scripts/validate-bridges.ts. Needs db/seed/onet_dwa.json.gz (discover-bridges.ts prepare) and the bge-m3 task
// vectors in data/onet_work_vectors.bin (discover-bridges.ts embed; a build input, not shipped).
import { readFileSync, existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { projectRoot } from "../server/lib/db.ts";
import { loadEsco } from "../server/services/esco.ts";
import { loadEscoVectors } from "../server/services/esco-match.ts";
import type { BridgeInput } from "../server/services/bridges.ts";

const seed = (f: string) => path.join(projectRoot, "db", "seed", f);
const VEC_BIN = path.join(projectRoot, "data", "onet_work_vectors.bin");
const VEC_META = path.join(projectRoot, "data", "onet_work_vectors.meta.json");

export function loadBridgeInput() {
  const esco = loadEsco(), sv = loadEscoVectors();
  if (!esco || !sv) throw new Error("ESCO data or skill vectors missing");
  if (!existsSync(VEC_BIN)) throw new Error("run: npx tsx scripts/discover-bridges.ts embed");
  const od = JSON.parse(gunzipSync(readFileSync(seed("onet_dwa.json.gz"))).toString("utf8"));
  const meta = JSON.parse(readFileSync(VEC_META, "utf8"));
  if (meta.model !== sv.model) throw new Error(`task vectors (${meta.model}) and skill vectors (${sv.model}) differ`);
  const buf = readFileSync(VEC_BIN);
  const dims: number = meta.dims, n: number = meta.count;
  const tq = new Int8Array(buf.buffer, buf.byteOffset, n * dims);
  const tscale = new Float32Array(buf.buffer.slice(buf.byteOffset + n * dims, buf.byteOffset + n * dims + n * 4));
  const textRow = new Map<string, number>(meta.texts.map((t: string, i: number) => [t, i]));

  const tasks: BridgeInput["tasks"] = {}, onetTasks: BridgeInput["onetTasks"] = {}, taskRow = new Map<string, number>();
  const taskCode = new Map<string, string>();
  for (const [code, o] of Object.entries<any>(od.occ)) {
    onetTasks[code] = [];
    for (const [id, text, , dwas] of o.tasks) {
      const key = `${code}#${id}`;
      tasks[key] = { text, dwas };
      onetTasks[code].push(key);
      taskCode.set(key, code);
      const r = textRow.get(text);
      if (r !== undefined) taskRow.set(key, r);
    }
  }
  const dwaTitle: Record<string, string> = {};
  for (const [id, [title]] of Object.entries<any>(od.dwas)) dwaTitle[id] = title;
  const skillRow = new Map(sv.ids.map((id, i) => [id, i]));
  const links = esco.onetLinks;

  const skillTaskCos = (s: string, t: string) => {
    const i = skillRow.get(s), j = taskRow.get(t);
    if (i === undefined || j === undefined) return null;
    let dot = 0;
    for (let x = i * dims, y = j * dims, end = x + dims; x < end; x++, y++) dot += sv.q[x] * tq[y];
    return dot * sv.scales[i] * tscale[j];
  };
  const skillCos = (a: string, b: string) => {
    const i = skillRow.get(a), j = skillRow.get(b);
    if (i === undefined || j === undefined) return null;
    let dot = 0;
    for (let x = i * dims, y = j * dims, end = x + dims; x < end; x++, y++) dot += sv.q[x] * sv.q[y];
    return dot * sv.scales[i] * sv.scales[j];
  };
  const input: BridgeInput = {
    skills: esco.skills, occupations: esco.occupations,
    onetOf: (oid: string) => links[oid]?.onet, onetTasks, tasks, dwaTitle, iwaTitle: od.iwas, gwaTitle: od.gwas, skillTaskCos, skillCos,
  };
  return { input, esco, onetMeta: od._meta, taskCode, vectorsMeta: { model: meta.model, provider: meta.provider, generated: meta.generated } };
}

/** The hand-made catalogue skills (knowledge.json) as ESCO skill ids: esco_map.json, else a flagged keyword pick.
 *  Same mapping as scripts/validate-skill-network.ts, so the two reports agree. */
export const CATALOGUE_FALLBACK: Record<string, string> = {
  three: "39d92981-7b68-47de-bfc0-5374c067dba9", // control trade commercial documentation (invoices, orders, receipts)
  ghg: "c8b4b02c-d9ce-4e24-ab43-5dd52c6dff48",   // advise on carbon emissions reduction (ESCO has no GHG accounting)
};
export function catalogueToEsco() {
  const kn = JSON.parse(readFileSync(seed("knowledge.json"), "utf8"));
  const map = JSON.parse(readFileSync(seed("esco_map.json"), "utf8"));
  const cat = new Map<string, { id: string; how: string }>();
  for (const s of kn.skills) {
    const m = map.skills[s.id];
    if (m?.uri) cat.set(s.id, { id: String(m.uri).split("/").pop()!, how: `esco_map (${m.match})` });
    else if (CATALOGUE_FALLBACK[s.id]) cat.set(s.id, { id: CATALOGUE_FALLBACK[s.id], how: "keyword pick (map says none)" });
  }
  const skillIds = new Set<string>(kn.skills.map((s: any) => s.id));
  const edges = kn.edges.filter((e: any) => skillIds.has(e.to)) as { from: string; to: string; why: string; weeks: number }[];
  return { kn, cat, edges };
}
