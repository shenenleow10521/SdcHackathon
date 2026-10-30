// Which ESCO skills are attitudes and transversal skills ("tolerate sitting for long periods", "work in teams",
// "show initiative"), not things you learn as a job's practical skill. They stay in the match, the gap list and the time,
// but are never numbered key stepping stones in a plan (server/services/esco-plan.ts).
//
// Two sources, because ESCO's own tagging is good but not complete:
//   1. ESCO's reuse level 1 ("transversal skills and competences"), minus languages, numbers and digital skills, which
//      are real learnable skills: db/seed/esco_transversal.json (86 skills, built by scripts/data/build_esco_transversal.py
//      from the raw ESCO API pages, because esco_full.json.gz keeps only title and type).
//   2. ESCO files some attitudes under a sector or cross-sector level ("tolerate sitting for long periods" is level 2,
//      "accept own accountability" level 3), so a short list of title openings catches those. Each opening was checked
//      against all 13,939 ESCO titles: the matches are all attitudes (see tests/esco-plan-keysteps.test.ts).
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { projectRoot } from "../lib/db.ts";
import { loadEsco } from "./esco.ts";

export const ATTITUDE_TITLES = new RegExp("^(" + [
  "tolerate ", "cope with ", "stay alert", "handle stressful", "manage stress",
  "accept (own accountability|feedback|criticism)", "listen actively", "work in a multicultural",
  "show (diplomacy|impartiality|intercultural|consideration|good manners|professional responsibility)",
  "demonstrate (commitment to|intercultural|leadership|motivation|professional|willingness)",
  "act (discreetly|reliably|with a high level of safety)", "be (friendly|at ease)",
].join("|") + ")", "i");

let level1: Set<string> | null = null;
const transversalIds = () => {
  if (level1) return level1;
  const f = path.join(projectRoot, "db", "seed", "esco_transversal.json");
  return (level1 = new Set<string>(existsSync(f) ? JSON.parse(readFileSync(f, "utf8")).ids : []));
};

/** True for an attitude or transversal ESCO skill (by id), false for a practical skill or knowledge item. */
export function isAttitude(skillId: string): boolean {
  if (transversalIds().has(skillId)) return true;
  const title = loadEsco()?.skills[skillId]?.title;
  return !!title && ATTITUDE_TITLES.test(title);
}

/** How many ESCO skills are flagged (for the docs and tests). */
export function attitudeCount() {
  const d = loadEsco();
  return d ? Object.keys(d.skills).filter(isAttitude).length : 0;
}
