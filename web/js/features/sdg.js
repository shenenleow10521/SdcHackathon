// SDG mapping in the UI: every job and skill's UN goals (hand-written for catalogue ones, the shared/sdg.js rule for
// ESCO ones), shown as goal rows in the drawers, small goal squares on job cards, and "How this path supports the UN
// goals" near the top of the Plan tab.
import { N, nameOf, escoRow, isEsco, cap, S } from "../state.js";
import { SDG_INFO, normSdg, sdgForJob, sdgForSkill, SKILL_BASE } from "/shared/sdg.js";
import { t } from "../i18n.js";
import { esc } from "../util.js";

const info = g => SDG_INFO[g] || { name: "SDG " + g, color: "#687284" };

/** A job or skill's goals as [[goal, reason], ...], and whether they come from the rule (not hand-written). */
export function sdgOf(id) {
  const n = N(id), own = normSdg(n?.sdg);
  if (own.length) return { list: own, rule: false };
  if (isEsco(id)) { const r = escoRow(id); return { list: sdgForJob(r?.title || nameOf(id), r?.isco), rule: true }; }
  if (n?.type === "job") return { list: sdgForJob(n.name), rule: true };
  return { list: sdgForSkill(n?.name || S.xsNames?.[id] || nameOf(id)), rule: true };
}

/** The UN's official goal icon (web/assets/sdg, used as published, scaled only); the name is in the icon. */
const icon = g => `<img class="sdg-ic" src="/assets/sdg/goal-${String(g).padStart(2, "0")}.png" alt="${esc(`SDG ${g}: ${info(g).name}`)}" width="44" height="44" loading="lazy" decoding="async">`;
/** A small numbered square in the goal's official colour, for places too small for the icon (job cards). */
const square = (g, cls = "") => `<b class="sdg-sq${cls}" style="background:${esc(info(g).color)}">${esc(g)}</b>`;

/** Goal rows for a drawer or sheet: the goal's icon, name and reason. */
export function sdgRows(list) {
  return normSdg(list).map(([g, r]) => `<div class="sdg">${icon(g)}<span><strong>${esc(info(g).name)}.</strong> ${esc(r)}</span></div>`).join("");
}

/** A drawer section with a job or skill's goals, near the top. */
export function sdgSection(id, titleKey) {
  const { list, rule } = sdgOf(id);
  if (!list.length) return "";
  return `<div class="sec sdg-sec"><h3><i data-lucide="globe"></i>${esc(t(titleKey))}</h3><div class="sdg-rows">${sdgRows(list)}</div>
    ${rule ? `<p class="src">${esc(t("sdg.ruleNote"))}</p>` : ""}</div>`;
}

/** Small goal squares for a job card (at most 3). */
export function sdgDots(id) {
  const { list } = sdgOf(id);
  if (!list.length) return "";
  const label = list.map(([g]) => `SDG ${g}: ${info(g).name}`).join(", ");
  return `<span class="sdg-dots" role="img" aria-label="${esc(label)}" title="${esc(label)}">${list.slice(0, 3).map(([g]) => square(g, " sm")).join("")}</span>`;
}

/** How a path supports the goals: the job's goals, then the goals the skills you'll build serve (SDG 4 is every skill). */
export function pathSdgHtml(job, skills) {
  const goals = new Map();
  const at = g => { if (!goals.has(g)) goals.set(g, { job: null, skills: [] }); return goals.get(g); };
  const jobTags = sdgOf(job);
  jobTags.list.forEach(([g, r]) => { at(g).job = r; });
  let rule = jobTags.rule, all = 0;
  const seen = new Set();
  for (const s of skills) {
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id); all++;
    const tags = s.esco ? { list: sdgForSkill(s.name), rule: true } : sdgOf(s.id);
    rule ||= tags.rule;
    tags.list.forEach(([g, r]) => { if (r !== SKILL_BASE[1]) at(g).skills.push(s.name || nameOf(s.id)); });
  }
  // learning any job skill counts toward target 4.4 (skills for decent jobs)
  if (all) at(SKILL_BASE[0]).all = true;
  if (!goals.size) return "";
  const order = [...goals.entries()].sort((a, b) => (b[1].job != null) - (a[1].job != null) || b[1].skills.length - a[1].skills.length || a[0] - b[0]);
  const names = list => list.length > 3 ? t("sdg.pathSkillsMore", { list: list.slice(0, 3).join(", "), n: list.length - 3 }) : list.join(", ");
  const rows = order.map(([g, v]) => {
    const lines = [
      v.job != null ? `<span>${esc(t("sdg.pathJob", { reason: v.job }))}</span>` : "",
      v.skills.length ? `<span>${esc(t("sdg.pathSkills", { list: names(v.skills) }))}</span>` : "",
      v.all ? `<span>${esc(t("sdg.pathAll", { n: all }))}</span>` : "",
    ].filter(Boolean).join("");
    return `<li>${icon(g)}<div><strong>${esc(t("sdg.goal", { n: g, name: info(g).name }))}</strong>${lines}</div></li>`;
  }).join("");
  return `<section class="sdg-path" aria-labelledby="sdg-path-h">
    <h3 class="sec-h" id="sdg-path-h"><i data-lucide="globe"></i>${esc(t("sdg.pathH"))}</h3>
    <ul class="sdg-list">${rows}</ul>
    <p class="src">${esc(t(rule ? "sdg.pathSrcRule" : "sdg.pathSrc"))}</p>
  </section>`;
}

/** An ESCO skill as a path skill: its id and name. */
export const escoSkill = (id, name) => ({ id, name: cap(name) || nameOf(id), esco: !N(id) });
