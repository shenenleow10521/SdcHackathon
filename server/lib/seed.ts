// Loads the seed knowledge base (db/seed/*.json) into an empty database.
// knowledge.json holds the prototype's sample values. Optional enrichment files, if present, add real
// source references (ESCO/O*NET codes, studies, courses, employers, embeddings). See db/seed/README.md.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import type { Db } from "./db.ts";
import { projectRoot } from "./db.ts";
import { seedExtensions } from "./seed-extensions.ts";

const seedFile = (name: string) => path.join(projectRoot, "db", "seed", name);
const readJson = (name: string) => (existsSync(seedFile(name)) ? JSON.parse(readFileSync(seedFile(name), "utf8")) : null);

export const DEMO_PROFILE_ID = 1;

export async function isSeeded(db: Db) {
  const r = await db.query<{ n: string }>("select count(*)::int as n from occupations");
  return Number(r.rows[0].n) > 0;
}

export async function seed(db: Db, opts: { force?: boolean } = {}) {
  if (!opts.force && (await isSeeded(db))) return { seeded: false };
  const K = readJson("knowledge.json");
  const esco = readJson("esco_map.json") || { occupations: {}, skills: {} };

  await db.tx(async t => {
    await t.query("insert into kb_versions(id, note, actor) values (1, 'Seed knowledge base (sample values from the prototype)', 'system')");
    await t.query("select setval(pg_get_serial_sequence('kb_versions','id'), 1)");

    const occs = [...K.occupations, { id: "other", title: "Other job (not in our catalogue yet)", isDestination: false, stay: false, blurb: null, postings: null, conf: "Low", split: null, sdg: [], e: [0.5, 0.55, 0.6], d: [0, 0, 0] }];
    for (const o of occs) {
      const m = esco.occupations?.[o.id] || {};
      await t.query(
        `insert into occupations(id,title,is_destination,stay,blurb,postings,conf,split,sdg,source,source_uri,isco_code,onet_code)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [o.id, o.title, o.isDestination, o.stay, o.blurb, o.postings, o.conf, JSON.stringify(o.split), JSON.stringify(o.sdg),
         m.uri ? "esco" : "sample", m.uri || null, m.isco || null, m.onet || null]);
      await t.query("insert into outlook values ($1,$2,$3,$4,$5,$6,$7,'sample')", [o.id, ...o.e, ...o.d]);
    }
    for (const s of K.skills) {
      const m = esco.skills?.[s.id] || {};
      await t.query(
        `insert into skills(id,label,description,source,source_uri,emerging,sdg,angle) values ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [s.id, s.label, m.description || null, s.emerging ? "emerging" : m.uri ? "esco" : "sample", m.uri || null,
         s.emerging ? JSON.stringify(s.emerging) : null, s.sdg ? JSON.stringify(s.sdg) : null, s.angle]);
      await t.query("insert into outlook values ($1,$2,$3,$4,$5,$6,$7,'sample')", [s.id, ...s.e, ...s.d]);
      for (const task of s.tasks) await t.query("insert into tasks(skill_id,text,mode) values ($1,$2,$3)", [s.id, task.text, task.mode]);
      const aliases = new Set<string>([...(m.aliases || []), ...(m.preferredLabel && m.preferredLabel !== s.label ? [m.preferredLabel] : []), ...(s.emerging?.synonyms || [])]);
      for (const a of aliases) await t.query("insert into skill_aliases values ($1,$2) on conflict do nothing", [s.id, a]);
    }
    for (const e of K.edges) await t.query("insert into edges values ($1,$2,$3,$4,$5)", [e.from, e.to, e.kind, e.weeks, e.why]);
    for (const [job, reqs] of Object.entries<any[]>(K.requirements))
      for (const r of reqs) await t.query("insert into occupation_skills values ($1,$2,$3,$4,$5,$6,'sample')", [job, r.skill, r.weight, r.need, r.status, r.share]);
    let ord = 0;
    for (const s of K.sectors) await t.query("insert into sectors values ($1,$2,$3,$4,$5,$6)", [s.id, s.name, s.icon, s.note, s.jobs ? JSON.stringify(s.jobs) : null, ord++]);

    // Courses: sample ones from the prototype, replaced per skill by db/seed/courses.json when present.
    const realCourses: any[] = readJson("courses.json") || [];
    const replaced = new Set(realCourses.map(c => c.skill));
    for (const c of K.courses.filter((c: any) => !replaced.has(c.skill)))
      await t.query(`insert into courses(skill_id,title,format,format_text,hours,cost_rm,hrd_claimable,practice_task,prove_check,source)
                     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,'sample')`,
        [c.skill, c.title, c.format, c.formatText, c.hours, c.free ? 0 : null, c.hrdClaimable, c.practice, c.prove]);
    const sampleBySkill = Object.fromEntries(K.courses.map((c: any) => [c.skill, c]));
    for (const c of realCourses)
      await t.query(`insert into courses(skill_id,title,provider,url,format,format_text,hours,cost_rm,hrd_claimable,practice_task,prove_check,source)
                     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [c.skill, c.title, c.provider || null, c.url || null, c.format || null, c.formatText || null, c.hours ?? null, c.costRm ?? null,
         !!c.hrdClaimable, c.practice || sampleBySkill[c.skill]?.practice || null, c.prove || sampleBySkill[c.skill]?.prove || null, c.source || "sample"]);

    for (const s of readJson("studies.json") || [])
      await t.query("insert into exposure_studies(occupation_id,study,value,raw_value,note,source_url,source) values ($1,$2,$3,$4,$5,$6,$7)",
        [s.occupationId, s.study, s.value ?? null, s.rawValue ?? null, s.note ?? null, s.sourceUrl ?? null, s.source || "sample"]);

    for (const e of readJson("employers.json") || []) {
      const r = await t.query<{ id: number }>("insert into employers(name,sector,careers_url,source,verified) values ($1,$2,$3,$4,$5) returning id",
        [e.name, e.sector || null, e.careersUrl || null, e.source || "sample", !!e.verified]);
      for (const q of e.requirements || [])
        await t.query(`insert into employer_requirements(employer_id,occupation_id,skill_id,weight,level_needed,quote,source_url,source_date)
                       values ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [r.rows[0].id, q.occupationId, q.skillId, q.weight ?? 2, q.levelNeeded ?? 3, q.quote || null, q.sourceUrl || null, q.sourceDate || null]);
    }

    const emb = readJson("embeddings.json");
    if (emb?.vectors)
      for (const [id, v] of Object.entries(emb.vectors))
        await t.query("update skills set embedding=$2, embedding_model=$3 where id=$1", [id, JSON.stringify(v), emb.model]);

    // Demo persona (synthetic): profile id 1.
    const P = K.persona;
    await t.query(`insert into profiles(id,display_name,current_occupation_id,hours_per_week,budget_rm,target_date,is_demo)
                   values (1,$1,$2,$3,1500,(current_date + interval '6 months')::date,true)`, [P.displayName, P.occupation, P.hours]);
    await t.query("select setval(pg_get_serial_sequence('profiles','id'), 1)");
    for (const [skill, level] of Object.entries(P.level))
      await t.query("insert into profile_skills values (1,$1,$2,$3,$4)", [skill, level, P.conf[skill] || "self", P.conf[skill] === "cv" ? "From the sample CV" : null]);

    // Sample review queue (labelled sample): the signals and emerging skills the prototype shows.
    for (const r of K.reviewQueue) {
      if (r.kind === "signal") {
        const [, srcTitle, nSrc] = (r.source.match(/^(.*?) · .*? · (\d+)/) || []);
        await t.query(
          `insert into signals(node_id,kind,title,delta_e,delta_d,quote,source_title,source_date,n_sources,reviewer_supports,reviewer_confidence,
                               triage,triage_reasons,status,is_sample)
           values ($1,'capability',$2,$3,$4,$5,$6,$7,$8,$9,$10,'flagged',$11,'pending',true)`,
          [r.node, r.title, r.boostE || 0, r.boostD || 0, r.quote.replace(/^“|”$/g, ""), srcTitle || r.source, sampleDate(r.source), Number(nSrc || 1),
           !/unsure/.test(r.verdict), Number((r.verdict.match(/([\d.]+)$/) || [])[1] || 0), JSON.stringify(r.reasons)]);
      } else {
        const s = K.skills.find((x: any) => x.id === r.node);
        const em = s.emerging;
        await t.query(
          `insert into emerging_candidates(label,skill_id,synonyms,postings,employers,weeks,linked_skill,committee,status,is_sample)
           values ($1,$2,$3,$4,$5,$6,$7,$8,'pending',true)`,
          [s.label, s.id, JSON.stringify(em.synonyms), em.postings, em.employers, em.weeks,
           K.edges.find((e: any) => e.to === s.id)?.from || null,
           JSON.stringify({ proposer: "Sample: seen in job postings", skeptic: "Sample: not a product name; distinct from existing skills", duplicate: "Sample: no close match" })]);
      }
    }
    for (const [icon, , text] of K.autoLog.filter((a: any) => a[0] === "x"))
      await t.query(`insert into signals(node_id,kind,title,triage,triage_reasons,status,is_sample) values ('excel','capability',$1,'rejected',$2,'rejected',true)`,
        [text, JSON.stringify([icon === "x" ? "Rejected by rules" : ""])]);

    for (const ext of seedExtensions) await ext(t);
  });
  return { seeded: true };
}

function sampleDate(source: string) {
  const m = source.match(/(\d{1,2}) (Oct|Sep|Nov) (\d{4})/);
  if (!m) return null;
  const mon = { Sep: "09", Oct: "10", Nov: "11" }[m[2]];
  return `${m[3]}-${mon}-${m[1].padStart(2, "0")}`;
}
