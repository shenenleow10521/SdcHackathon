// 3D career constellation: you at the centre, your skills on the inner ring, skills to learn in the middle, jobs outside.
// Ported from prototype/halatuju-app.html. Nodes glide between layouts; your route is lit, other route options are grey,
// skills AI has taken over become closed roads, and after a knowledge change the old route fades while the new one lights up.
import { S, UI, D, N, kindOf, matchOf, W, nameOf } from "./state.js";
import { MODES } from "/shared/engine.js";
import { $, css, esc, reduce, icons, sign } from "./util.js";
import { t } from "./i18n.js";
import * as FX from "./fx.js";
import { isGoal } from "./features/goal.js";

const RING = [0, 85, 165, 245], LIFT = [0, 10, 24, 44], D2R = Math.PI / 180;
const LAYOUT = { key: "", visible: new Set(), target: {} };
const OBJ = {};
let Graph = null, graphReady = false, labelEls = {}, incidentEl = null, hoverId = null;
const handlers = { nodeClick: () => {}, altRoute: () => {}, scanning: () => false };

export const isReady = () => !!Graph;
export const visibleNodes = () => LAYOUT.visible;
const at = (ring, deg) => ({ x: RING[ring] * Math.cos(deg * D2R), y: LIFT[ring], z: RING[ring] * Math.sin(deg * D2R) });

function ownedAngles() {
  const owned = S.E.ownedSkills();
  const out = {};
  const allHave = owned.every(k => Number.isFinite(N(k)?.angle));
  if (allHave && owned.length) owned.forEach(k => out[k] = N(k).angle);
  else owned.forEach((k, i) => out[k] = (30 + i * 360 / Math.max(1, owned.length)) % 360);
  return out;
}

function computeLayout() {
  const E = S.E, ring = UI.ring, n = ring.length, jobA = {};
  ring.forEach((j, i) => jobA[j] = (100 + i * 360 / Math.max(1, n)) % 360);
  const pull = new Map();
  const add = (k, a) => { if (!pull.has(k)) pull.set(k, []); pull.get(k).push(a); };
  ring.forEach(j => {
    const ids = new Set((S.graph.req[j] || []).map(r => r.skill).filter(k => E.isSkill(k) && !E.owned(k)));
    const p = D.plans[j];
    if (p?.route) p.route.nodes.forEach(k => { if (E.isSkill(k) && !E.owned(k)) ids.add(k); });
    if (p && j === UI.job) p.extras.forEach(x => { if (E.isSkill(x.id) && !E.owned(x.id)) ids.add(x.id); });
    ids.forEach(k => add(k, jobA[j]));
  });
  if (jobA[UI.job] !== undefined) {
    for (const m of MODES) { try { const r = E.shortestPath(UI.job, m); if (r) r.nodes.forEach(k => { if (E.isSkill(k) && !E.owned(k) && !pull.has(k)) add(k, jobA[UI.job]); }); } catch { /* no route */ } }
    if (S.ghost) S.ghost.nodes.forEach(k => { if (N(k) && E.isSkill(k) && !E.owned(k) && !pull.has(k)) add(k, jobA[UI.job]); });
  }
  const learn = [...pull].map(([k, angs]) => {
    const x = angs.reduce((s, a) => s + Math.cos(a * D2R), 0), y = angs.reduce((s, a) => s + Math.sin(a * D2R), 0);
    return [k, (Math.atan2(y, x) / D2R + 360) % 360];
  });
  learn.sort((a, b) => a[1] - b[1]);
  const gap = Math.min(30, 360 / Math.max(1, learn.length));
  for (let pass = 0; pass < 40; pass++) for (let i = 0; i < learn.length && learn.length > 1; i++) {
    const a = learn[i], b = learn[(i + 1) % learn.length], g = (b[1] - a[1] + 360) % 360;
    if (g < gap) { const p = (gap - g) / 2; a[1] = (a[1] - p + 360) % 360; b[1] = (b[1] + p) % 360; }
  }
  const target = { [E.root]: at(0, 0) };
  const ang = ownedAngles();
  Object.entries(ang).forEach(([k, a]) => target[k] = at(1, a));
  learn.forEach(([k, a]) => target[k] = at(2, a));
  ring.forEach(j => target[j] = at(3, jobA[j]));
  LAYOUT.target = target;
  LAYOUT.visible = new Set(Object.keys(target));
  return Object.keys(target).sort().join(",") + "|" + ring.join(",") + "|" + Object.values(ang).join(",");
}

function graphLinks() {
  const E = S.E, vis = LAYOUT.visible, root = E.root, out = [];
  for (const k of E.ownedSkills()) if (vis.has(k)) out.push({ source: root, target: k, key: root + ">" + k, from: root, to: k, kind: "own" });
  for (const e of S.graph.edges) if (vis.has(e.from) && vis.has(e.to)) out.push({ source: e.from, target: e.to, key: e.from + ">" + e.to, from: e.from, to: e.to, kind: e.kind });
  return out;
}

let layoutTween = null;
/** Recompute positions; animate nodes to their new places. Returns true if the layout changed. */
export function applyLayout(animate) {
  if (!S.E) return false;
  const key = computeLayout();
  if (key === LAYOUT.key) return false;
  LAYOUT.key = key;
  const from = {};
  Object.keys(LAYOUT.target).forEach(id => {
    const tg = LAYOUT.target[id];
    if (!OBJ[id]) OBJ[id] = { id, x: tg.x, y: tg.y, z: tg.z, fx: tg.x, fy: tg.y, fz: tg.z };
    from[id] = { x: OBJ[id].fx, y: OBJ[id].fy, z: OBJ[id].fz };
  });
  if (Graph) Graph.graphData({ nodes: Object.keys(LAYOUT.target).map(id => OBJ[id]), links: graphLinks() });
  buildLabels();
  // Snapshot the targets: a later layout replaces them while this tween may still be running.
  const to = Object.fromEntries(Object.keys(from).map(id => [id, { ...LAYOUT.target[id] }]));
  const step = p => {
    Object.keys(to).forEach(id => {
      const a = from[id], b = to[id], o = OBJ[id];
      o.fx = o.x = a.x + (b.x - a.x) * p; o.fy = o.y = a.y + (b.y - a.y) * p; o.fz = o.z = a.z + (b.z - a.z) * p;
    });
    if (Graph && graphReady) Graph.d3ReheatSimulation();
  };
  layoutTween?.kill(); layoutTween = null;
  if (animate && globalThis.gsap && !reduce) { const st = { p: 0 }; layoutTween = globalThis.gsap.to(st, { p: 1, duration: 0.9, ease: "power3.inOut", onUpdate: () => step(st.p) }); }
  else step(1);
  return true;
}

const posOf = id => OBJ[id] ? { x: OBJ[id].fx, y: OBJ[id].fy, z: OBJ[id].fz } : LAYOUT.target[id];
function pathKeys() { const s = new Set(); const p = D.plan; if (p?.route) p.route.legs.forEach(l => s.add(l.from + ">" + l.to)); return s; }
export const onPlan = id => { const p = D.plan; return !!p && ((p.route && p.route.nodes.includes(id)) || p.extras.some(x => x.id === id) || p.ups.some(u => u.id === id)); };

/** Links on the other route options to the selected job, mapped to their mode (like grey GPS alternatives). */
export function altKeys() {
  const s = new Map(), p = D.plan;
  if (!p?.route || !UI.job) return s;
  for (const m of MODES) {
    if (m === UI.mode) continue;
    let r = null; try { r = S.E.shortestPath(UI.job, m); } catch { r = null; }
    if (r && r.key !== p.route.key) r.legs.forEach(l => { const k = l.from + ">" + l.to; if (!s.has(k)) s.set(k, m); });
  }
  try { S.E.alternatives(UI.job, UI.mode, 2).forEach(r => r.legs.forEach(l => { const k = l.from + ">" + l.to; if (!s.has(k)) s.set(k, UI.mode); })); } catch { /* none */ }
  return s;
}

function nColor(n) {
  const k = kindOf(n.id);
  if (k === "you") return css("--n-you");
  if (k === "job") return css("--n-job");
  if (S.E.taken(n.id)) return css("--n-taken");
  if (k === "have") return S.E.zone(n.id) === "At risk" ? css("--n-risk") : css("--n-have");
  return css("--n-learn");
}
function nVal(n) {
  const k = kindOf(n.id);
  if (k === "you") return 34;
  if (k === "job") return 10 + matchOf(n.id) * 0.4 + (n.id === UI.job ? 12 : 0);
  if (S.E.taken(n.id)) return 2.5;
  if (k === "have") return 4 + S.E.lvl(n.id) * 1.6 + (onPlan(n.id) ? 4 : 0);
  return onPlan(n.id) ? 11 : 6;
}

function ghostColor(alpha) { return `rgba(230, 103, 103, ${Math.max(0, alpha).toFixed(3)})`; }

export function restyle() {
  if (!Graph || !S.E) return;
  const pk = pathKeys(), ak = altKeys(), E = S.E, g = S.ghost;
  const dead = l => E.taken(l.from) || E.taken(l.to);
  const fo = FX.focusSet(), faded = l => fo && !pk.has(l.key) && !(fo.has(l.from) && fo.has(l.to));
  Graph.nodeColor(nColor).nodeVal(nVal)
    .linkColor(l => faded(l) ? "rgba(170,186,212,0.05)" : pk.has(l.key) ? css("--l-path") : g && g.keys.has(l.key) ? ghostColor(g.alpha) : ak.has(l.key) ? css("--l-alt") : l.kind === "evolve" ? css("--l-evolve") : dead(l) ? css("--l-dead") : css("--l-base"))
    .linkWidth(l => pk.has(l.key) ? 2.6 : g && g.keys.has(l.key) ? 2.4 * g.alpha : ak.has(l.key) ? 1.6 : l.kind === "evolve" ? 1.4 : dead(l) ? 0 : 0.6)
    .linkDirectionalParticles(l => !reduce && pk.has(l.key) ? 3 : !reduce && l.kind === "evolve" ? 1 : 0)
    .linkDirectionalParticleColor(l => l.kind === "evolve" ? css("--l-evolve") : css("--particle"));
  FX.styleAll();
  if (graphReady) Graph.d3ReheatSimulation();
  updateLabels();
}

/** After a knowledge change: fade the old route out in red while the new route is lit. */
export function fadeOldRoute(oldRoute, onDone) {
  if (!oldRoute || !Graph) { onDone?.(); return; }
  S.ghost = { keys: new Set(oldRoute.legs.map(l => l.from + ">" + l.to)), nodes: new Set(oldRoute.nodes), alpha: 1 };
  applyLayout(true); restyle();
  const end = () => { S.ghost = null; applyLayout(true); restyle(); onDone?.(); };
  if (reduce || !globalThis.gsap) { setTimeout(end, 900); return; }
  const g = S.ghost;
  globalThis.gsap.to(g, { alpha: 0, duration: 2.4, delay: 0.6, ease: "power2.in", onUpdate: () => { if (S.ghost === g) restyle(); }, onComplete: () => { if (S.ghost === g) end(); } });
}

export function init(h) {
  Object.assign(handlers, h);
  const el = $("graph");
  if (!globalThis.ForceGraph3D) { el.innerHTML = `<div class="nograph">${esc(t("map.noLib"))}</div>`; return; }
  const small = el.clientWidth < 520;
  try {
    Graph = globalThis.ForceGraph3D({ controlType: "orbit" })(el)
      .width(el.clientWidth).height(el.clientHeight).backgroundColor("rgba(0,0,0,0)").showNavInfo(false)
      .graphData({ nodes: Object.keys(LAYOUT.target).map(id => OBJ[id]), links: graphLinks() })
      .nodeId("id").nodeRelSize(4).nodeOpacity(0.96).nodeResolution(small ? 12 : 28).nodeLabel(() => "")
      .linkOpacity(0.9).linkCurvature(0.12).linkDirectionalParticleWidth(2.4).linkDirectionalParticleSpeed(0.007)
      .enableNodeDrag(false).warmupTicks(0).cooldownTicks(8).onEngineTick(() => { graphReady = true; })
      .onNodeHover(n => { el.style.cursor = n ? "pointer" : ""; hoverId = n ? n.id : null; if (!n) $("tip").hidden = true; updateLabels(); FX.focus(hoverId); })
      .onNodeClick(n => handlers.nodeClick(n.id))
      .onLinkHover(l => { el.style.cursor = l && altKeys().has(l.key) ? "pointer" : ""; })
      .onLinkClick(l => { const m = altKeys().get(l.key); if (m) handlers.altRoute(m, l); });
  } catch (err) {
    console.warn("3D unavailable", err);
    el.innerHTML = `<div class="nograph">${esc(t("map.no3d"))}</div>`; Graph = null; return;
  }
  Graph.d3Force("charge", null); Graph.d3Force("center", null); Graph.d3Force("link").strength(0);
  resetView(false);
  const c = Graph.controls(); c.autoRotate = UI.rotating; c.autoRotateSpeed = 0.5; c.enableDamping = true;
  c.addEventListener("start", () => { if (UI.rotating) setRotate(false); });
  restyle(); requestAnimationFrame(frame);
  setTimeout(() => FX.init({ Graph, RING, LIFT, posOf, visible: () => LAYOUT.visible, nColor, nVal, onPlan, restyle, setRotate, scanning: () => handlers.scanning() }), 150);
}

/** Cinematic effects (no-ops when WebGL effects are off). */
export const wave = (id, hex, dur, size) => FX.wave(id, hex, dur, size);
export const intro = () => FX.intro();

export function resize() { const el = $("graph"); if (!el) return; FX.setAspect(el.clientWidth / Math.max(1, el.clientHeight)); if (Graph) Graph.width(el.clientWidth).height(el.clientHeight); }

export function resetView(animate) {
  if (!Graph) return;
  const d = $("graph").clientWidth < 700 ? 1.85 : 1.5;
  Graph.cameraPosition({ x: 0, y: 440 * d, z: 420 * d }, { x: 0, y: 10, z: 0 }, animate && !reduce ? 900 : 0);
}
export function focusNode(id) {
  if (!Graph) return;
  const p = LAYOUT.target[id]; if (!p) return;
  const len = Math.hypot(p.x, p.z);
  if (len < 1) return resetView(true);
  Graph.cameraPosition({ x: p.x * 1.9, y: 420, z: p.z * 1.9 + 160 }, { x: p.x * 0.55, y: p.y, z: p.z * 0.55 }, reduce ? 0 : 900);
  if (UI.rotating) setRotate(false);
}
export function setRotate(on) {
  UI.rotating = on;
  if (Graph) Graph.controls().autoRotate = on;
  const b = $("rotate");
  b.setAttribute("aria-pressed", String(on));
  b.setAttribute("aria-label", t(on ? "map.stopRotate" : "map.startRotate"));
}

function buildLabels() {
  const box = $("labels");
  box.innerHTML = ""; labelEls = {};
  LAYOUT.visible.forEach(id => { const d = document.createElement("div"); d.className = "lb hide"; box.appendChild(d); labelEls[id] = d; });
  incidentEl = document.createElement("div"); incidentEl.className = "incident"; incidentEl.hidden = true;
  box.appendChild(incidentEl);
  updateLabels();
}

export function updateLabels() {
  if (!S.E) return;
  const E = S.E;
  let step = 0; const stepOf = {};
  const p = D.plan;
  if (p?.route) p.route.nodes.forEach(k => { if (kindOf(k) === "learn") stepOf[k] = ++step; });
  Object.entries(labelEls).forEach(([id, el]) => {
    const n = N(id); if (!n) return;
    const kind = kindOf(id), tk = E.isSkill(id) && E.taken(id), imp = E.isSkill(id) ? E.impact(id).label : "";
    let html = "", cls = "lb";
    if (kind === "you") { cls += " you"; html = esc(t("map.you", { job: n.name })); }
    else if (kind === "job") {
      cls += " job" + (id === UI.job ? " sel" : "");
      const pj = D.plans[id];
      html = `${isGoal(id) ? `<span class="tg goal">${esc(t("goal.mapTag"))}</span> ` : ""}${esc(n.name)}<small><span>${esc(t("map.jobMatch", { match: matchOf(id) }))}</span><span>${pj?.route ? `${esc(String(W(pj.ready)))} ${esc(t("common.wk"))}` : "–"}</span></small>`;
    } else if (kind === "learn") html = `${stepOf[id] ? `<span class="n">${stepOf[id]}</span>` : ""}${esc(n.name)}${n.emerging ? ` <span class="tg new">${esc(t("map.new"))}</span>` : ""}`;
    else html = `${esc(n.name)}${tk ? ` <span class="tg taken">${esc(t("map.tookOver"))}</span>` : imp === "Declining" ? ` <span class="tg risk">${esc(t("map.atRisk"))}</span>` : imp === "Rising human skill" ? ` <span class="tg human">${esc(t("map.humanEdge"))}</span>` : ""}`;
    const show = UI.labelsAll || kind === "you" || kind === "job" || onPlan(id) || (UI.tab === "skills" && kind === "have" && (imp === "Declining" || imp === "Rising human skill")) || id === hoverId || id === S.signalNode;
    el.className = cls + (show ? "" : " hide");
    if (el.innerHTML !== html) el.innerHTML = html;
  });
  // measure once per content change; placeLabels() uses the sizes to avoid overlaps
  Object.values(labelEls).forEach(el => { if (!el.classList.contains("hide")) { el._w = el.offsetWidth; el._h = el.offsetHeight; } });
  if (incidentEl) {
    const on = !!(S.signalNode && LAYOUT.visible.has(S.signalNode));
    incidentEl.hidden = !on;
    if (on) { incidentEl.innerHTML = `<i data-lucide="triangle-alert"></i>${esc(t("map.incident", { name: nameOf(S.signalNode) }))}`; icons(); }
  }
}

// Labels: place the most important first (hovered, you, selected job, path, other jobs, rest) and hide any that would collide.
function placeLabels() {
  const items = [];
  for (const id in labelEls) {
    const el = labelEls[id]; if (el.classList.contains("hide")) continue;
    const p = posOf(id); if (!p) continue;
    const s = Graph.graph2ScreenCoords(p.x, p.y, p.z), k = kindOf(id);
    const pr = id === hoverId ? 0 : k === "you" ? 1 : id === UI.job ? 2 : id === S.signalNode ? 2 : onPlan(id) ? 3 : k === "job" ? 4 : 5;
    items.push({ el, s, off: k === "job" ? 20 : k === "you" ? 22 : 12, pr, w: el._w || 120, h: el._h || 22 });
  }
  items.sort((a, b) => a.pr - b.pr);
  const placed = [], hit = r => placed.some(q => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);
  for (const it of items) {
    let y = null;
    for (const cy of [it.s.y + it.off, it.s.y - it.off - it.h]) { const r = { x: it.s.x - it.w / 2 - 4, y: cy - 2, w: it.w + 8, h: it.h + 4 }; if (!hit(r)) { y = cy; placed.push(r); break; } }
    if (y === null && it.pr <= 2) { y = it.s.y + it.off; placed.push({ x: it.s.x - it.w / 2, y, w: it.w, h: it.h }); }
    if (y === null) { it.el.classList.add("clash"); continue; }
    it.el.classList.remove("clash");
    it.el.style.transform = `translate(${it.s.x}px, ${y}px) translate(-50%, 0)`;
  }
}

let lastFrame = performance.now();
function frame(now) {
  now = now || performance.now();
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
  if (Graph) {
    try {
      FX.tick(dt);
      placeLabels();
      if (S.signalNode && incidentEl && !incidentEl.hidden) {
        const p = posOf(S.signalNode);
        if (p) { const s = Graph.graph2ScreenCoords(p.x, p.y, p.z); incidentEl.style.left = s.x + "px"; incidentEl.style.top = (s.y - 14) + "px"; }
      }
      drawRings();
      if (hoverId && LAYOUT.visible.has(hoverId)) showTip(hoverId);
    } catch (e) { /* a frame must never break the loop */ }
  }
  requestAnimationFrame(frame);
}

let ringNames = "";
export function setRingNames(names) { ringNames = names; }
function drawRings() {
  const names = ringNames || ["", "", "", ""];
  let out = "";
  for (let r = 1; r <= 3; r++) {
    let d = "", best = null;
    for (let i = 0; i <= 72; i++) {
      const a = i / 72 * Math.PI * 2, s = Graph.graph2ScreenCoords(RING[r] * Math.cos(a), LIFT[r], RING[r] * Math.sin(a));
      d += (i ? "L" : "M") + s.x.toFixed(1) + "," + s.y.toFixed(1);
      if (!best || s.y > best.y) best = s;
    }
    if (!FX.isOn()) out += `<path d="${d}" fill="none" stroke="var(--ring)" stroke-width="1.1" ${r < 3 ? 'stroke-dasharray="3 6"' : ""}/>`;
    out += `<text class="ring-label" x="${best.x.toFixed(1)}" y="${(best.y + 26).toFixed(1)}" text-anchor="middle">${esc(names[r])}</text>`;
  }
  $("rings").innerHTML = out;
}

function showTip(id) {
  const n = N(id), tip = $("tip"), p = posOf(id); if (!n || !p) return;
  const E = S.E, s = Graph.graph2ScreenCoords(p.x, p.y, p.z), k = kindOf(id);
  const kind = k === "you" ? t("tip.current") : k === "job" ? t("tip.job") : k === "have" ? t("tip.yourSkill", { n: E.lvl(id) }) : t("tip.learn");
  const status = k === "job" ? matchOf(id) + "%" : E.isSkill(id) ? (E.taken(id) ? t("map.tookOver") : t("impact." + E.impact(id).label)) : "–";
  tip.innerHTML = `<b>${esc(n.name)}</b><span class="k">${esc(kind)}</span>
    <div class="row"><span>${esc(t("common.exposure"))}</span><span>${Math.round(E.exposure(id) * 100)}%</span></div>
    <div class="row"><span>${esc(t("common.demand"))}</span><span>${sign(E.demand(id))}</span></div>
    <div class="row"><span>${esc(k === "job" ? t("tip.match") : t("tip.status"))}</span><span>${esc(status)}</span></div>`;
  tip.hidden = false;
  const off = $("graph").getBoundingClientRect().left - $("stage").getBoundingClientRect().left;
  const W2 = $("stage").clientWidth, tw = tip.offsetWidth, sx = s.x + off;
  tip.style.left = (sx + 20 + tw > W2 ? Math.max(8, sx - 20 - tw) : sx + 20) + "px"; tip.style.top = Math.max(8, s.y - 40) + "px";
}

export function drawStars() {
  const c = $("stars"); if (!c || FX.isOn()) return;
  const r = c.getBoundingClientRect(), dpr = globalThis.devicePixelRatio || 1;
  c.width = r.width * dpr; c.height = r.height * dpr;
  const g = c.getContext("2d"); if (!g) return;
  g.scale(dpr, dpr);
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(200,215,240,${0.08 + rnd() * 0.35})`; g.beginPath(); g.arc(rnd() * r.width, rnd() * r.height, rnd() * 1.1 + 0.2, 0, Math.PI * 2); g.fill(); }
}
