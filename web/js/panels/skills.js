// My skills tab: a summary card (counts, the "Stay AI-ready" line), then one card per group: At risk, AI-assisted, Still yours.
// Each skill is one row: name, one sentence, one action. Tap the row for the full detail in the drawer.
// Two sources, one row: the hand-made catalogue (the sample persona: tasks with who does them, "evolves into", real
// courses, forecast by year) or, for everyone else, the server's outlook for their ESCO skills (features/stay.js header).
import { S, N, nameOf, humanSplit, confOf, actions, cap } from "../state.js";
import { t } from "../i18n.js";
import { esc, badge } from "../util.js";
import { stayTrack, stayJob } from "../features/stay.js";

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

// The app's four bands map to three groups: risk + taken = At risk, changing = AI-assisted, safe = Still yours.
const GROUPS = [{ g: "risk", bands: ["risk", "taken"] }, { g: "assist", bands: ["changing"] }, { g: "yours", bands: ["safe"] }];
const SHOW = 3;
const isCatalogue = () => !!stayJob() || !S.outlook?.skills?.length;

/** The O*NET task lists for an ESCO job (outlook mode only); the drawer shows it for "you". */
export function jobTasksHtml() {
  const o = isCatalogue() ? null : S.outlook?.job?.tasks;
  if (!o || (!o.ai.length && !o.yours.length)) return "";
  return `<div class="sec"><h3>${esc(t("skills.today"))}</h3>
    ${o.ai.length ? `<div class="jt jt-ai"><b>${esc(t("outlook.jobAi"))}</b><ul>${o.ai.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
    ${o.yours.length ? `<div class="jt jt-you"><b>${esc(t("outlook.jobYours"))}</b><ul>${o.yours.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>` : ""}
    <p class="src">${esc(t("outlook.jobSrc", { job: S.outlook.job.onet?.title || S.outlook.job.title }))}</p></div>`;
}

// ---------- catalogue mode: the hand-made skills (forecast by year, tasks, "evolves into", courses) ----------
function catalogueCards() {
  const E = S.E;
  return E.ownedSkills().map(k => {
    const n = N(k), im = E.impact(k).label;
    const band = E.taken(k) ? "taken" : im === "Declining" ? "risk" : im === "Changing" ? "changing" : "safe";
    const ev = S.graph.edges.find(e => e.from === k && e.kind === "evolve" && !E.owned(e.to));
    const target = ev ? ev.to : null, co = (S.graph.courses?.[target || k] || [])[0];
    const learn = target ? { name: nameOf(target), hours: co?.hours || null, course: co || null }
      : band !== "safe" && co && E.lvl(k) < 5 ? { name: nameOf(k), hours: co.hours || null, course: co, up: true } : null;
    return { id: k, name: nameOf(k), band, pct: Math.round(E.exposure(k) * 100), learn, click: true, mine: true };
  });
}

// ---------- outlook mode: your ESCO skills from the server ----------
function outlookCards() {
  return (S.outlook?.skills || []).map(s => {
    const id = N(s.id) ? s.id : "xs:" + s.id;
    if (!N(s.id)) S.xsNames[id] = s.title;
    return {
    id, name: cap(s.title), band: s.band, pct: Math.round(100 * s.exposure), click: true,
    learn: s.learn ? { name: s.learn.name, hours: s.learn.hours, course: s.learn.course } : null,
  }; });
}

// Colour only marks status: a small icon on each row and the summary bar. Headings and borders stay neutral.
const ICON = { risk: "triangle-alert", assist: "contrast", yours: "circle-check" };

/** One skill row: status icon, name, one grey line, chevron. Tap it for the skill view (ways to learn, the check). */
function row(c, g, i) {
  const learnLine = c.learn ? t(c.learn.up ? "myskills.up" : g === "risk" ? "myskills.shift" : "myskills.learn", { name: c.learn.name }) : "";
  const line = [c.pct != null ? t("myskills.pct", { n: c.pct }) : "", learnLine].filter(Boolean).join(" ");
  const verified = confOf(c.id) === "verified";
  return `<div class="ms-item"${i >= SHOW ? " hidden data-extra" : ""}>
    <div class="ms-row ms-g-${g}" data-skill="${esc(c.id)}" role="button" tabindex="0">
      <i class="ms-ic" data-lucide="${ICON[g]}" aria-hidden="true"></i>
      <div class="ms-txt"><div class="ms-name">${esc(c.name)}${verified ? " " + badge("b-good", t("conf.verified"), "badge-check") : ""}</div>${line ? `<p class="ms-line">${esc(line)}</p>` : ""}</div>
      <i class="ms-chev" data-lucide="chevron-right" aria-hidden="true"></i>
    </div>
  </div>`;
}

function group(g, cards) {
  const extra = cards.length - SHOW;
  return `<section class="ms-card ms-group">
    <div class="ms-gh"><h3>${esc(t("myskills.g." + g))} <span class="ms-count">${cards.length}</span></h3></div>
    ${cards.map((c, i) => row(c, g, i)).join("")}
    ${extra > 0 ? `<button class="ms-more" type="button" data-more aria-expanded="false" data-all="${esc(t("myskills.showAll", { n: cards.length }))}" data-less="${esc(t("myskills.showLess"))}">${esc(t("myskills.showAll", { n: cards.length }))}</button>` : ""}
  </section>`;
}

/** The summary: one sentence, one stacked bar, a small key. */
function summary(counts, n) {
  const r = counts.risk;
  const head = r ? t(r === 1 ? "myskills.head1" : "myskills.headN", { r, n }) : t("myskills.head0", { n });
  const bar = GROUPS.map(({ g }) => counts[g] ? `<i class="ms-g-${g}" style="flex-grow:${counts[g]}"></i>` : "").join("");
  const key = GROUPS.map(({ g }) => `<span class="ms-g-${g}"><i></i><b class="num">${counts[g]}</b> ${esc(t("myskills.k." + g))}</span>`).join("");
  return `<p class="ms-head">${esc(head)}</p>
    <div class="ms-bar" role="img" aria-label="${esc(GROUPS.map(({ g }) => counts[g] + " " + t("myskills.k." + g)).join(", "))}">${bar}</div>
    <div class="ms-key">${key}</div>`;
}

function stayPart() {
  const st = stayTrack();
  if (!st) return "";
  const k = st.items.length;
  const line = k ? t(k === 1 ? "myskills.stay1" : "myskills.stayN", { k, w: st.weeks }) : t("outlook.stayNone", { job: st.job });
  return `<div class="ms-stay"><div><div class="ms-name">${esc(t("stay.title", { job: st.job }))}</div><p class="ms-line">${esc(line)}</p></div>
    ${k ? `<button class="ms-btn" type="button" data-tab-goal>${esc(t("myskills.seeGoal"))}</button>` : ""}</div>`;
}

export function render() {
  const E = S.E, root = E.root;
  const cards = (isCatalogue() ? catalogueCards() : outlookCards()).sort((a, b) => b.pct - a.pct);
  const by = g => cards.filter(c => GROUPS.find(x => x.g === g).bands.includes(c.band));
  const scope = isCatalogue() ? `<p class="ms-meta ms-scope">${esc(t("myskills.scope", { year: S.year, scenario: t("scn." + S.scenario) }))}</p>` : "";
  return `<div class="stack ms-page">
    <section class="ms-card">
      <div class="ms-gh"><h2>${esc(t("myskills.title"))}</h2><span class="ms-meta">${esc(t("myskills.private"))}</span></div>
      ${cards.length ? summary(Object.fromEntries(GROUPS.map(({ g }) => [g, by(g).length])), cards.length) : ""}
      ${scope}
      <hr class="ms-hr">
      ${stayPart()}
      <div class="ms-links">${N(root) ? `<button class="link-btn" type="button" data-skill="${esc(root)}">${esc(t("myskills.jobTasks"))}</button>` : ""}<button class="link-btn" type="button" id="edit-skills">${esc(t("skills.edit"))}</button></div>
    </section>
    ${cards.length ? GROUPS.filter(({ g }) => by(g).length).map(({ g }) => group(g, by(g))).join("") : `<div class="empty">${esc(t("skills.none"))}</div>`}
  </div>`;
}

export function bind(el) {
  el.querySelectorAll("[data-skill]").forEach(b => {
    b.addEventListener("click", e => { if (!e.target.closest("a, .ms-btn")) actions.openDrawer(b.dataset.skill); });
    b.addEventListener("keydown", e => { if (e.target === b && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); actions.openDrawer(b.dataset.skill); } });
  });
  el.querySelectorAll("[data-more]").forEach(b => b.addEventListener("click", () => {
    const open = b.getAttribute("aria-expanded") !== "true";
    b.closest(".ms-group").querySelectorAll("[data-extra]").forEach(x => { x.hidden = !open; });
    b.setAttribute("aria-expanded", String(open));
    b.textContent = open ? b.dataset.less : b.dataset.all;
  }));
  el.querySelectorAll("[data-tab-goal]").forEach(b => b.addEventListener("click", () => actions.openGoalTab()));
  const ed = el.querySelector("#edit-skills"); if (ed) ed.addEventListener("click", () => actions.openOnboarding?.(2));
}
