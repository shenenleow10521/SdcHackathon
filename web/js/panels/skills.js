// My skills tab: your job task by task, your human edge, and each skill's outlook and confidence.
import { S, UI, N, nameOf, humanSplit, kindOf, confOf, actions } from "../state.js";
import { t } from "../i18n.js";
import { esc, badge } from "../util.js";
import { visibleNodes } from "../graph3d.js";
import { whyBtn } from "../features/why.js";

export const confBadge = k => {
  const c = confOf(k);
  if (c === "verified") return badge("b-good", t("conf.verified"), "badge-check");
  if (c === "cv") return badge("b-info", t("conf.cv"), "file-text");
  if (c === "self") return badge("b-mute", t("conf.self"));
  return "";
};

export function splitBar(id, labels = "skills") {
  const s = humanSplit(id);
  if (!s) return `<p class="note">${esc(t("split.none"))}</p>`;
  const [a, b, c] = s;
  return `<div class="split"><div class="split-bar" role="img" aria-label="${esc(t("split.aria", { a, b, c }))}"><i style="flex-basis:${a}%;background:var(--split-ai)"></i><i style="flex-basis:${b}%;background:var(--split-assist)"></i><i style="flex-basis:${c}%;background:var(--split-you)"></i></div>
    <div class="split-key"><span><i style="background:var(--split-ai)"></i>${esc(t("split.ai"))} <b class="num">${a}%</b></span><span><i style="background:var(--split-assist)"></i>${esc(t("split.assist"))} <b class="num">${b}%</b></span><span><i style="background:var(--split-you)"></i>${esc(t(labels === "skills" ? "split.you" : "split.youShort"))} <b class="num">${c}%</b></span></div></div>`;
}

const confText = k => { const c = confOf(k); return c ? t("conf." + c) : ""; };

function skillRow(k) {
  const E = S.E;
  const evolves = S.graph.edges.some(e => e.from === k && e.kind === "evolve");
  const meta = [confText(k), evolves ? t("skills.evolves") : ""].filter(Boolean).join(" · ");
  return `<button class="skill" type="button" data-skill="${esc(k)}">
    <span class="sn">${esc(nameOf(k))}${meta ? `<small>${esc(meta)}</small>` : ""}</span>
    <span class="dots" role="img" aria-label="${esc(t("skills.levelAria", { n: E.lvl(k) }))}">${[1, 2, 3, 4, 5].map(i => `<i class="${i <= E.lvl(k) ? "on" : ""}"></i>`).join("")}</span></button>`;
}

export function render() {
  const E = S.E, root = E.root;
  const owned = E.ownedSkills();
  const learnVisible = [...visibleNodes()].filter(k => kindOf(k) === "learn");
  const rising = [...owned, ...learnVisible].filter(k => E.impact(k).label === "Rising human skill");
  const groupOf = k => E.taken(k) ? "taken" : { "Declining": "risk", "Changing": "changing" }[E.impact(k).label] || "safe";
  const groups = { taken: [], risk: [], changing: [], safe: [] };
  owned.forEach(k => groups[groupOf(k)].push(k));
  const c = Object.fromEntries(Object.entries(groups).map(([g, l]) => [g, l.length]));
  return `<div class="stack">
    <section>
      <div class="h2"><h2>${esc(t("skills.yours"))}</h2><button class="ghost sm" type="button" id="edit-skills"><i data-lucide="sliders-horizontal"></i>${esc(t("skills.edit"))}</button></div>
      <p class="skills-sum">${esc(t("skills.summary", { n: owned.length, safe: c.safe, chg: c.changing, risk: c.risk, taken: c.taken, year: S.year }))}</p>
      ${owned.length ? ["risk", "taken", "changing", "safe"].filter(g => groups[g].length).map(g => `<div class="sgroup g-${g}">
          <h3 class="sec-h"><span class="gdot" aria-hidden="true"></span>${esc(t("skills.g." + g))} <span class="cnt">${groups[g].length}</span></h3>
          <p class="note">${esc(t("skills.gd." + g))}</p>
          <div class="skills">${groups[g].map(skillRow).join("")}</div></div>`).join("")
        : `<div class="empty">${esc(t("skills.none"))}</div>`}
    </section>
    <section>
      <h3 class="sec-h">${esc(t("skills.edge"))}</h3>
      <p class="note">${esc(t("skills.edgeBody"))}</p>
      <div class="chips">${rising.length ? rising.map(k => `<button class="chip" type="button" data-skill="${esc(k)}"><i data-lucide="${E.owned(k) ? "check" : "plus"}"></i>${esc(nameOf(k))}</button>`).join("") : `<span class="note">${esc(t("skills.edgeNone"))}</span>`}</div>
    </section>
    <section>
      <h3 class="sec-h">${esc(t("skills.today"))}${whyBtn("exposure", root)}</h3>
      ${splitBar(root)}
      <p class="note">${esc(t("skills.tasksNote", { year: S.year, scenario: t("scn." + S.scenario) }))}</p>
    </section>
  </div>`;
}

export function bind(el) {
  el.querySelectorAll("[data-skill]").forEach(b => b.addEventListener("click", () => actions.openDrawer(b.dataset.skill)));
  const ed = el.querySelector("#edit-skills"); if (ed) ed.addEventListener("click", () => actions.openOnboarding?.(2));
}
