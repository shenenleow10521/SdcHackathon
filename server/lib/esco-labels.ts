// Facts about catalogue jobs and their requirements, computed from the data files (never set by hand):
//  - ESCO status of each requirement: does ESCO v1.2.1 list the skill for the job's mapped ESCO occupation?
//      essential  ESCO lists it as essential for that occupation
//      optional   ESCO lists it as optional
//      other      the skill is in ESCO, but ESCO doesn't list it for that occupation (HalaTuju added it)
//      none       no ESCO equivalent (db/seed/esco_map.json uri null): a new AI-era skill or one too specific for ESCO
//    and the weight that follows from it (ESCO_REQ_WEIGHT): our own additions never outweigh ESCO's essential skills.
//  - MyCOL: is the job's ISCO-08 4-digit group on Malaysia's Critical Occupations List (same MASCO 2020 code)?
//  - DOSM: Malaysian wages for the job's MASCO major group (the first digit of the code).
// Sources: db/seed/esco_map.json (catalogue -> ESCO + ISCO), db/seed/esco_full.json.gz, mycol.json, dosm.json (via loadEsco).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "./db.ts";
import { loadEsco, DOSM_GROUP } from "../services/esco.ts";

export type EscoReq = "essential" | "optional" | "other" | "none";
export const ESCO_REQ_WEIGHT: Record<EscoReq, number> = { essential: 2, optional: 1, other: 1, none: 1 };

let map: { occupations: Record<string, any>; skills: Record<string, any> } | undefined;
function escoMap() {
  if (map) return map;
  const f = path.join(projectRoot, "db", "seed", "esco_map.json");
  const m = existsSync(f) ? JSON.parse(readFileSync(f, "utf8")) : {};
  return (map = { occupations: m.occupations || {}, skills: m.skills || {} });
}
const uuid = (uri: unknown) => (uri ? String(uri).split("/").pop()! : null);

/** ESCO status of one catalogue requirement, or null when the job has no ESCO mapping (or ESCO data is missing). */
export function escoReq(jobId: string, skillId: string): EscoReq | null {
  const m = escoMap(), occ = uuid(m.occupations[jobId]?.uri);
  const o = occ ? loadEsco()?.occupations[occ] : null;
  if (!o || !(skillId in m.skills)) return null;
  const s = uuid(m.skills[skillId]?.uri);
  if (!s) return "none";
  return o.essential.includes(s) ? "essential" : o.optional.includes(s) ? "optional" : "other";
}

/** Weight of a catalogue requirement: from its ESCO status, else the stored weight. */
export const escoWeight = (jobId: string, skillId: string, stored: number) => {
  const e = escoReq(jobId, skillId);
  return e ? ESCO_REQ_WEIGHT[e] : stored;
};

/** ISCO-08 4-digit code of a catalogue occupation (from its ESCO occupation). */
export const catalogueIsco = (jobId: string): string | null => escoMap().occupations[jobId]?.isco || null;

/** MyCOL entry when the ISCO 4-digit group is on the list (MASCO 2020 codes match ISCO-08 at this level). */
export function mycolFor(isco: string | null) {
  const d = loadEsco(), c = isco && d?.mycol?.byCode.get(isco);
  return c ? { code: c.masco, title: c.title, new: !!c.new, everyEdition: !!c.everyEdition, source: d!.mycol!.meta.source, url: d!.mycol!.meta.url } : null;
}

/** DOSM wages for the code's major group (covers the whole group, not this one job), or null. */
export function dosmFor(isco: string | null) {
  const g = isco ? DOSM_GROUP[isco[0]] : null;
  return (g && loadEsco()?.dosm?.[g]) || null;
}
