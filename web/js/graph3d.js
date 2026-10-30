// 3D career constellation: you at the centre, your skills on the inner ring, skills to learn in the middle, jobs outside.
// Ported from prototype/halatuju-app.html. Nodes glide between layouts. By default only your route is drawn (numbered stops);
// other routes appear while you hover a route row (like a map's route preview), a skill's links while you hover it,
// "evolves into" links on the My skills tab. After a knowledge change the old route fades in red while the new one lights up.
import { S, UI, D, N, kindOf, matchOf, nameOf, isEsco, escoRow, selJob, mapJobs, jobStrength, currentJobTitle, jobWeeks } from "./state.js";
import { MODES } from "/shared/engine.js";
import { $, css, esc, reduce, icons, sign } from "./util.js";
import { t } from "./i18n.js";
import * as FX from "./fx.js";
import { isGoal, goal } from "./features/goal.js";
import { TIME_RINGS, weeksRadius, jobRadius, spreadRadii } from "./map-scale.js";

const RING = [0, 85, 165, 245], LIFT = [0, 10, 24, 44], D2R = Math.PI / 180;
// the time rings: [radius, i18n key of the label] (a job star's distance from you is its time to job-ready)
const TIME = TIME_RINGS.map(([w, key]) => [weeksRadius(w), key]);
const LAYOUT = { key: "", visible: new Set(), target: {}, cluster: new Map() };
const OBJ = {};
const LINKS = { preview: new Map() };
let Graph = null, graphReady = false, labelEls = {}, incidentEl = null, hoverId = null, previewMode = null, styledTab = null;
const handlers = { nodeClick: () => {}, altRoute: () => {}, scanning: () => false };

export const isReady = () => !!Graph;
export const visibleNodes = () => LAYOUT.visible;
const at = (ring, deg) => ({ x: RING[ring] * Math.cos(deg * D2R), y: LIFT[ring], z: RING[ring] * Math.sin(deg * D2R) });

/** Below this many catalogue skills, your ESCO skills (from your CV or the quiz) fill your ring as "xs:" nodes. */
const OWN_MIN = 4, OWN_ESCO_MAX = 10;
/** ESCO skills you have, drawn on your ring when your catalogue skills are few (a nurse, a call-centre agent). */
function escoOwnNodes() {
  if (S.E.ownedSkills().length >= OWN_MIN) return [];
  return (S.escoMine || []).filter(k => !k.fromCatalogue).slice(0, OWN_ESCO_MAX).map(k => "xs:" + k.id);
}
function ownedAngles() {
  const owned = S.E.ownedSkills(), extra = escoOwnNodes();
  const out = {};
  const allHave = owned.every(k => Number.isFinite(N(k)?.angle));
  if (allHave && owned.length && !extra.length) owned.forEach(k => out[k] = N(k).angle);
  else { const all = [...owned, ...extra]; all.forEach((k, i) => out[k] = (30 + i * 360 / Math.max(1, all.length)) % 360); }
  return out;
}

/** An ESCO skill id as a map node: the catalogue node if the catalogue has it, else "xs:<id>". */
const mapId = k => (N(k) ? k : "xs:" + k);
const escoPlan = () => (UI.escoJob && S.escoPlan?.id === UI.escoJob ? S.escoPlan : null);
/** The selected ESCO job's route: from you (or the owned skill it starts from) through its key skills to the job. */
function escoChain() {
  const xp = escoPlan(); if (!xp) return null;
  if (xp.route) return xp.route;
  if (!xp.keys.length) return null;
  const E = S.E, ids = xp.keys.map(mapId);
  const start = ids.find(k => E.isSkill(k) && E.owned(k)) || E.root;
  return [start, ...ids.filter(k => !(E.isSkill(k) && E.owned(k))), UI.escoJob];
}
/** Skills the selected job asks for: how many you have, out of how many (for the coverage ring around its star). */
export function coverageOf(j) {
  if (!j) return null;
  const E = S.E;
  if (isEsco(j)) {
    const r = escoRow(j);
    return r?.essential ? { have: r.have, n: r.essential } : null; // the same count as the job's row in the sidebar
  }
  const req = S.graph.req[j] || []; if (!req.length) return null;
  return { have: req.filter(r => E.owned(r.skill) && !E.taken(r.skill)).length, n: req.length };
}

/** A full orbit, best match first, dealt round the circle with a stride so the strongest stars (and their labels) spread
 *  out instead of bunching next to the selected job. Small orbits keep their order. */
function orbitOrder(ring) {
  const n = ring.length;
  if (n <= 14) return ring;
  const sorted = [...ring].sort((a, b) => matchOf(b) - matchOf(a));
  const gcd = (a, b) => (b ? gcd(b, a % b) : a);
  let k = Math.round(n * 0.382); while (gcd(k, n) !== 1) k++;
  const out = new Array(n);
  sorted.forEach((j, r) => { out[(r * k) % n] = j; });
  return out;
}

// ---------- route view: the Plan and My goal tabs show just your route, edge to edge (like directions in a map app) ----------
/** The route on the map: you, the skills it passes through, the job (null when no job is open). */
function routeChain() {
  if (UI.escoJob) return escoChain();
  const p = D.plan;
  return UI.picked && UI.job && p?.route ? p.route.nodes : null;
}
/** Route view is on in the Plan and My goal tabs while a route is open, unless "Show all jobs" was pressed. */
export const routeView = () => (UI.tab === "path" || UI.tab === "goal") && UI.view === "user" && !UI.routeAll && !!routeChain();

const ROUTE = { half: 320, zig: 34, cluster: 12, clusterStep: 3.2 };
function routeLayout() {
  const E = S.E, ch = routeChain(), n = ch.length, target = {}, xp = escoPlan();
  // the chain runs left to right across the map, the stops evenly spaced and slightly staggered so labels don't collide
  ch.forEach((k, i) => {
    const f = n > 1 ? i / (n - 1) : 0, inner = i > 0 && i < n - 1;
    target[k] = { x: -ROUTE.half + 2 * ROUTE.half * f, y: inner ? 14 : 0, z: inner ? (i % 2 ? -ROUTE.zig : ROUTE.zig) : 0 };
  });
  // the other skills still to build: small clusters beside the step they're learned with (or by the job)
  const extra = xp ? xp.missing.filter(m => !ch.includes(mapId(m.id))).map(m => ({ id: mapId(m.id), group: m.group ? mapId(m.group) : null }))
    : [...(D.plan?.extras || []).map(x => ({ id: x.id, group: null })), ...(D.plan?.ups || []).filter(u => !ch.includes(u.id)).map(u => ({ id: u.id, group: null }))];
  const count = new Map(), job = ch[n - 1];
  extra.forEach(m => {
    const key = m.group && target[m.group] ? m.group : job, c = target[key], i = count.get(key) || 0;
    count.set(key, i + 1);
    const real = !!N(m.id) && !isEsco(m.id); // a catalogue skill keeps its labelled ball, so give it more room
    const a = i * 2.39996 + (key === job ? Math.PI / 2 : 0), r = (key === job ? 26 : ROUTE.cluster) + (real ? 18 : ROUTE.clusterStep) * Math.sqrt(i);
    target[m.id] = { x: c.x + r * Math.cos(a), y: c.y - 3, z: c.z + r * Math.sin(a) + (real ? 40 : 0) };
  });
  LAYOUT.target = target; LAYOUT.cluster = count;
  LAYOUT.visible = new Set(Object.keys(target));
  return "route|" + Object.keys(target).sort().join(",") + "|" + ch.join(">");
}

function computeLayout() {
  if (routeView()) return routeLayout();
  const E = S.E, ring = orbitOrder(mapJobs()), n = ring.length, jobA = {}, xp = escoPlan();
  ring.forEach((j, i) => jobA[j] = (100 + i * 360 / Math.max(1, n)) % 360);
  const pull = new Map();
  const add = (k, a) => { if (!pull.has(k)) pull.set(k, []); pull.get(k).push(a); };
  // Your top picks (and the selected job) pull their skills into the middle ring; the extra jobs from the threshold
  // slider don't, so a full orbit doesn't flood the map with skills.
  UI.ring.filter(j => UI.base.includes(j) || j === UI.job || j === UI.pinned).forEach(j => {
    const ids = new Set((S.graph.req[j] || []).map(r => r.skill).filter(k => E.isSkill(k) && !E.owned(k)));
    const p = D.plans[j];
    if (p?.route) p.route.nodes.forEach(k => { if (E.isSkill(k) && !E.owned(k)) ids.add(k); });
    if (p && j === UI.job) p.extras.forEach(x => { if (E.isSkill(x.id) && !E.owned(x.id)) ids.add(x.id); });
    ids.forEach(k => add(k, jobA[j]));
  });
  if (!xp && jobA[UI.job] !== undefined) {
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
    if (i === 0) learn.sort((a, b) => a[1] - b[1]); // keep neighbours in order, or skills pulled to the same angle end up stacked
    const a = learn[i], b = learn[(i + 1) % learn.length], g = (b[1] - a[1] + 360) % 360;
    if (g < gap) { const p = (gap - g) / 2; a[1] = (a[1] - p + 360) % 360; b[1] = (b[1] + p) % 360; }
  }
  const target = { [E.root]: at(0, 0) };
  // A job star's distance from you is its time to job-ready at your hours (map-scale.js: fixed anchors, so the time rings
  // mean the same on every map); a job with no estimate yet is placed by match inside the same band.
  const rad = spreadRadii(ring.map(j => ({ id: j, r: jobRadius(jobWeeks(j), matchOf(j)), a: jobA[j] })));
  ring.forEach(j => { const a = jobA[j] * D2R; target[j] = { x: rad[j] * Math.cos(a), y: LIFT[3], z: rad[j] * Math.sin(a) }; });
  const ang = ownedAngles();
  Object.entries(ang).forEach(([k, a]) => target[k] = at(1, a));
  learn.forEach(([k, a]) => target[k] = at(2, a));
  // The selected ESCO job's other missing skills are small dots clustered beside the numbered step they're learned with
  // (their group), so the route stays the main line and a big cluster shows a heavy step (placed below, once the job
  // star has its place: skills with no step cluster by the job).
  let rest = [];
  if (xp) {
    // its key skills step outward from your skills to the job in order, so the numbered route reads as one line
    const mid = (escoChain() || []).slice(1, -1).filter(k => !target[k]), a0 = jobA[UI.escoJob], rj = rad[UI.escoJob] ?? RING[3];
    // ESCO skills you already have that the route starts from sit on your ring, facing the job
    mid.filter(k => kindOf(k) === "have").forEach((k, i) => { target[k] = at(1, a0 + (i % 2 ? 1 : -1) * 10 * Math.ceil(i / 2)); });
    const stops = mid.filter(k => kindOf(k) !== "have");
    stops.forEach((k, i) => {
      const f = (i + 1) / (stops.length + 1), r = RING[1] + 30 + (rj - RING[1] - 65) * f, a = (a0 + (i % 2 ? 8 : -8)) * D2R;
      target[k] = { x: r * Math.cos(a), y: LIFT[1] + (LIFT[3] - LIFT[1]) * f, z: r * Math.sin(a) };
    });
    const keys = new Set(xp.keys);
    rest = xp.missing.filter(m => !keys.has(m.id) && !target[mapId(m.id)]);
  }
  // each cluster is a small sunflower spiral around its step (golden angle), starting just outside the step's own ball
  const inCluster = new Map();
  rest.forEach(m => {
    const centre = (m.group && target[mapId(m.group)]) || target[UI.escoJob];
    if (!centre) return;
    const key = m.group && target[mapId(m.group)] ? m.group : "job", i = inCluster.get(key) || 0;
    inCluster.set(key, i + 1);
    const a = i * 2.39996, r = (key === "job" ? 20 : 13) + 3.4 * Math.sqrt(i);
    target[mapId(m.id)] = { x: centre.x + r * Math.cos(a), y: centre.y - 3, z: centre.z + r * Math.sin(a) };
  });
  LAYOUT.target = target; LAYOUT.cluster = new Map();
  LAYOUT.visible = new Set(Object.keys(target));
  return Object.keys(target).sort().join(",") + "|" + ring.join(",") + "|" + ring.map(j => Math.round(rad[j])).join(",") + "|" + Object.values(ang).join(",") + "|" + (xp ? xp.id + xp.keys.join(",") + (xp.route || []).join(",") : "");
}

function graphLinks() {
  const E = S.E, vis = LAYOUT.visible, root = E.root, out = [];
  // You-to-skill links exist only so a route's first leg can be drawn; they never show on their own
  for (const k of E.ownedSkills()) if (vis.has(k)) out.push({ source: root, target: k, key: root + ">" + k, from: root, to: k, kind: "own" });
  for (const e of S.graph.edges) if (vis.has(e.from) && vis.has(e.to)) out.push({ source: e.from, target: e.to, key: e.from + ">" + e.to, from: e.from, to: e.to, kind: e.kind });
  const ch = escoChain();
  if (ch) for (let i = 1; i < ch.length; i++) if (vis.has(ch[i - 1]) && vis.has(ch[i])) out.push({ source: ch[i - 1], target: ch[i], key: ch[i - 1] + ">" + ch[i], from: ch[i - 1], to: ch[i], kind: "xroute" });
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
    // a job star that joins the map (threshold slider) drifts in from beyond the orbit; anything else appears in place
    if (!OBJ[id]) { const k = animate && kindOf(id) === "job" ? 1.45 : 1; OBJ[id] = { id, x: tg.x * k, y: tg.y, z: tg.z * k, fx: tg.x * k, fy: tg.y, fz: tg.z * k }; }
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
function pathKeys() {
  const s = new Set();
  if (UI.escoJob) { const ch = escoChain(); if (ch) for (let i = 1; i < ch.length; i++) s.add(ch[i - 1] + ">" + ch[i]); return s; }
  const p = D.plan; if (p?.route) p.route.legs.forEach(l => s.add(l.from + ">" + l.to)); return s;
}
export const onPlan = id => {
  if (UI.escoJob) { const ch = escoChain(); return !!ch && ch.includes(id) && id !== S.E.root; }
  const p = D.plan; return !!p && ((p.route && p.route.nodes.includes(id)) || p.extras.some(x => x.id === id) || p.ups.some(u => u.id === id));
};

/** Links of the route option being previewed (a route row in My goal is hovered or focused), mapped to its mode. */
function previewKeys() {
  const s = new Map(), p = D.plan;
  if (!previewMode || !p?.route || !UI.job || UI.escoJob) return s;
  let r = null; try { r = S.E.shortestPath(UI.job, previewMode); } catch { r = null; }
  if (r && r.key !== p.route.key) r.legs.forEach(l => s.set(l.from + ">" + l.to, previewMode));
  return s;
}
/** Preview another route option on the map (null to go back to just your route). */
export function previewRoute(m) {
  if ((m || null) === previewMode) return;
  previewMode = m || null; restyle();
}

function nColor(n) {
  const k = kindOf(n.id);
  if (k === "you") return css("--n-you");
  if (k === "job") return n.id === selJob() ? css("--n-job-star") : alpha(css("--n-job-star"), (0.45 + 0.55 * jobStrength(n.id)) * (jobLabelled(n.id) ? 1 : 0.6));
  if (!N(n.id)) return k === "have" ? css("--n-have") : onPlan(n.id) ? css("--n-learn") : alpha(css("--n-learn"), 0.85);
  if (S.E.taken(n.id)) return css("--n-taken");
  if (k === "have") return S.E.zone(n.id) === "At risk" ? css("--n-risk") : css("--n-have");
  return css("--n-learn");
}
function nVal(n) {
  const k = kindOf(n.id);
  if (k === "you") return 34;
  // star size is its match % (absolute, so a 40% job looks the same on every map); the selected job gets no extra size,
  // its coverage ring marks it. A floor keeps weak matches visible; a fuller orbit gets smaller stars
  if (k === "job") { const full = mapJobs().length > 14, m = Math.max(0, Math.min(1, matchOf(n.id) / 100)); return (full ? 0.6 : 1) * (2.5 + 36 * m * m); }
  if (!N(n.id)) return k === "have" ? 8 : onPlan(n.id) ? 11 : 1.5;
  if (S.E.taken(n.id)) return 2.5;
  if (k === "have") return 4 + S.E.lvl(n.id) * 1.6 + (onPlan(n.id) ? 4 : 0);
  return onPlan(n.id) ? 11 : 6;
}

/** A #rgb/#rrggbb colour with an alpha (other formats are returned as they are). */
function alpha(c, a) {
  if (!c || c[0] !== "#") return c;
  let h = c.slice(1); if (h.length === 3) h = h.split("").map(x => x + x).join("");
  const v = parseInt(h, 16);
  return `rgba(${v >> 16 & 255},${v >> 8 & 255},${v & 255},${a.toFixed(2)})`;
}
function ghostColor(alpha) { return `rgba(230, 103, 103, ${Math.max(0, alpha).toFixed(3)})`; }

// the job stars that carry a label this render (others are drawn dimmer, so the labelled ones read first)
let labelSet = null;
const jobLabelled = id => !labelSet || labelSet.has(id);
export function restyle() {
  if (!Graph || !S.E) return;
  labelSet = mapJobs().length > 14 ? labelledJobs() : null;
  const pk = pathKeys(), ak = previewKeys(), E = S.E, g = S.ghost, evolveOn = UI.tab === "skills";
  styledTab = UI.tab; LINKS.preview = ak;
  const dead = l => (!!N(l.from) && E.taken(l.from)) || (!!N(l.to) && E.taken(l.to));
  const fo = FX.focusSet(), faded = l => fo && !pk.has(l.key) && !(fo.has(l.from) && fo.has(l.to)), drawn = drawLegs(pk);
  // Only draw what answers the current question; hidden links are removed, so they can't catch the pointer either.
  const shown = l => (pk.has(l.key) && drawn(l.key)) || (g && g.keys.has(l.key)) || ak.has(l.key) || (!!hoverId && l.kind !== "own" && (l.from === hoverId || l.to === hoverId) && !dead(l)) || (evolveOn && l.kind === "evolve");
  Graph.nodeColor(nColor).nodeVal(nVal).linkVisibility(shown)
    .linkColor(l => faded(l) ? "rgba(170,186,212,0.05)" : pk.has(l.key) ? css("--l-path") : g && g.keys.has(l.key) ? ghostColor(g.alpha) : ak.has(l.key) ? css("--l-preview") : l.kind === "evolve" ? css("--l-evolve") : dead(l) ? css("--l-dead") : css("--l-alt"))
    .linkWidth(l => pk.has(l.key) ? 2.6 : g && g.keys.has(l.key) ? 2.4 * g.alpha : ak.has(l.key) ? 2.2 : l.kind === "evolve" ? 1.4 : dead(l) ? 0 : 0.9)
    .linkDirectionalParticles(l => !reduce && pk.has(l.key) ? 3 : !reduce && l.kind === "evolve" ? 1 : 0)
    .linkDirectionalParticleColor(l => l.kind === "evolve" ? css("--l-evolve") : css("--particle"));
  FX.styleAll();
  if (graphReady) Graph.d3ReheatSimulation();
  updateLabels();
  refreshProgress();
  frameOnPick();
}

// The route draws itself once, leg by leg from you to the job, when a job is picked or its route changes.
const DRAW = { key: "", t0: 0, order: new Map(), timers: [] }, LEG_MS = 150;
function drawLegs(pk) {
  const key = [...pk].join("|");
  if (key !== DRAW.key) {
    DRAW.key = key; DRAW.t0 = performance.now(); DRAW.timers.forEach(clearTimeout);
    DRAW.order = new Map([...pk].map((k, i) => [k, i])); // pathKeys() lists the legs in route order
    DRAW.timers = reduce ? [] : [...pk].map((_, i) => setTimeout(restyle, (i + 1) * LEG_MS));
  }
  const n = reduce ? Infinity : Math.floor((performance.now() - DRAW.t0) / LEG_MS) + 1;
  return k => DRAW.order.get(k) < n;
}

// When a job is picked (or its route arrives, or route view comes or goes), frame you, the route and the job together, so
// a destination two years out still fits the map on a phone. Only on those changes: the camera is yours otherwise.
let framedKey = "";
function frameOnPick() {
  const j = selJob(), ch = routeChain();
  const key = j && (UI.picked || UI.escoJob) ? j + "|" + routeView() + "|" + (ch ? ch.length : 0) : "";
  if (key === framedKey) return;
  framedKey = key;
  if (key) frameRoute(j, ch);
}
function frameRoute(j, ch) {
  // route view shows only the route and its clusters, so all of it is framed; on the full map, you, the route and the job
  const rv = routeView(), ids = rv ? Object.keys(LAYOUT.target) : [S.E.root, ...(ch || []), j].filter(id => LAYOUT.target[id]);
  const el = $("graph"), cam = Graph.camera(), gw = el.clientWidth, gh = el.clientHeight;
  if (ids.length < 2 || !gw || !gh) return;
  // keep the home view's angle; only the target and the distance change
  const v = home(), f = [v.pos.x - v.look.x, v.pos.y - v.look.y, v.pos.z - v.look.z], fl = Math.hypot(...f);
  f.forEach((x, i) => f[i] = x / fl);
  const rl = Math.hypot(f[2], f[0]) || 1, right = [f[2] / rl, 0, -f[0] / rl];
  const up = [f[1] * right[2] - f[2] * right[1], f[2] * right[0] - f[0] * right[2], f[0] * right[1] - f[1] * right[0]];
  const P = ids.map(id => LAYOUT.target[id]), mid = k => (Math.min(...P.map(p => p[k])) + Math.max(...P.map(p => p[k]))) / 2;
  const C = { x: mid("x"), y: mid("y"), z: mid("z") };
  // only the part of the map beside the side panel is visible; leave room for labels and the time bar
  blockersAt = -Infinity; mapBlockers(performance.now()); // measure now (performance.now() can be under 400 ms at page load)
  const vx0 = Math.max(0, visX[0]), vx1 = Math.min(gw, visX[1]), cx = (vx0 + vx1) / 2;
  // and between the wide controls at the top and bottom (legend, time bar, the phone's job card)
  const wide = blockers.filter(b => b.x < cx && b.x + b.w > cx && b.w > (vx1 - vx0) * 0.5);
  const vy0 = Math.max(0, ...wide.filter(b => b.y + b.h < gh / 2).map(b => b.y + b.h)), vy1 = Math.min(gh, ...wide.filter(b => b.y > gh / 2).map(b => b.y));
  const tanV = Math.tan((cam.fov || 75) * Math.PI / 360), tanH = tanV * gw / gh;
  // keep room at each side for the labels centred on the end points ("You", the job's card is about 230 px wide)
  const mx = Math.min(130, 0.14 * (vx1 - vx0));
  const fitH = tanH * Math.max(0.2, (vx1 - vx0 - 2 * mx) / gw), fitV = tanV * Math.max(0.3, (vy1 - vy0) / gh) * 0.85;
  let D = fl * (rv ? 0.6 : 0.85); // never much closer than home on the full map: the stars around the route give context
  for (const p of P) {
    const d = [p.x - C.x, p.y - C.y, p.z - C.z], dot = a => d[0] * a[0] + d[1] * a[1] + d[2] * a[2];
    D = Math.max(D, dot(f) + Math.abs(dot(right)) / fitH, dot(f) + Math.abs(dot(up)) / fitV);
  }
  // centre the route in the visible part: move the look-at point the other way
  const sh = (cx / gw * 2 - 1) * D * tanH, sv = (1 - (vy0 + vy1) / gh) * D * tanV;
  const look = { x: C.x - right[0] * sh - up[0] * sv, y: C.y - up[1] * sv, z: C.z - right[2] * sh - up[2] * sv };
  Graph.cameraPosition({ x: look.x + f[0] * D, y: look.y + f[1] * D, z: look.z + f[2] * D }, look, reduce ? 0 : 1100);
}

// ---------- "you are here": how far along the route you are (progress from the My goal tab) ----------
const HERE = { el: null, ch: null, key: "", at: 0, u: 0, tween: null, w: 0, h: 0 };
/**
 * refreshProgress(): re-read goal() and move the "you are here" marker on the map's route.
 * - The marker sits on the route at the furthest step (route index) whose skill id is in goal().done; with none done,
 *   no goal, or a goal for another job than the one on the map, it sits at "You" (index 0). Ids match with or without
 *   the "xs:" prefix of ESCO skill nodes.
 * - When that step changes, the marker glides along the route line to it; a new route places it without animation.
 * - Cheap and safe to call any time (also before the map is ready, or with no route open: the marker is then hidden).
 *   Called by the map itself on every restyle; call it after changing goal().done if you don't refresh the map.
 * Returns the route index the marker sits at, or -1 when no route is on the map.
 */
export function refreshProgress() {
  const ch = routeChain();
  if (!S.E || !ch || ch.length < 2) { HERE.ch = null; HERE.key = ""; return -1; }
  const g = goal(), done = g && g.job === selJob() ? new Set(g.done || []) : null;
  let at = 0;
  if (done) for (let i = 1; i < ch.length - 1; i++) if (done.has(ch[i]) || done.has(ch[i].replace(/^xs:/, ""))) at = i;
  const key = ch.join(">");
  if (key !== HERE.key) { HERE.tween?.kill(); HERE.tween = null; HERE.key = key; HERE.ch = ch; HERE.at = HERE.u = at; return at; }
  if (at !== HERE.at) {
    const from = HERE.u; HERE.at = at; HERE.tween?.kill(); HERE.tween = null;
    if (globalThis.gsap && !reduce) HERE.tween = globalThis.gsap.to(HERE, { u: at, duration: 0.6 + 0.3 * Math.abs(at - from), ease: "power2.inOut" });
    else HERE.u = at;
  }
  return at;
}
/** Place the marker for this frame and reserve its box, so labels step around it. */
function placeHere(placed) {
  const el = HERE.el, ch = HERE.ch; if (!el) return;
  const i = ch ? Math.min(ch.length - 1, Math.floor(HERE.u)) : 0, k = ch ? ch[Math.min(ch.length - 1, i + 1)] : null;
  const a = ch && LAYOUT.visible.has(ch[i]) ? posOf(ch[i]) : null, b = k && LAYOUT.visible.has(k) ? posOf(k) : null;
  if (!a || !b) { el.hidden = true; return; }
  const f = HERE.u - i, s = Graph.graph2ScreenCoords(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f, a.z + (b.z - a.z) * f);
  el.hidden = false;
  if (!HERE.w) { HERE.w = el.offsetWidth; HERE.h = el.offsetHeight; }
  el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
  placed.push({ x: s.x - HERE.w / 2 - 4, y: s.y - HERE.h - 2, w: HERE.w + 8, h: HERE.h + 4 });
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
      .onNodeHover(n => {
        el.style.cursor = n ? "pointer" : ""; const was = hoverId; hoverId = n ? n.id : null; if (!n) $("tip").hidden = true;
        FX.focus(hoverId); if (hoverId !== was && !FX.isOn()) restyle(); else updateLabels();
      })
      .onNodeClick(n => handlers.nodeClick(n.id))
      .onLinkHover(l => { el.style.cursor = l && LINKS.preview.has(l.key) ? "pointer" : ""; })
      .onLinkClick(l => { const m = LINKS.preview.get(l.key); if (m) handlers.altRoute(m, l); });
  } catch (err) {
    console.warn("3D unavailable", err);
    el.innerHTML = `<div class="nograph">${esc(t("map.no3d"))}</div>`; Graph = null; return;
  }
  Graph.d3Force("charge", null); Graph.d3Force("center", null); Graph.d3Force("link").strength(0);
  resetView(false);
  const c = Graph.controls(); c.autoRotate = UI.rotating; c.autoRotateSpeed = 0.5; c.enableDamping = true;
  c.addEventListener("start", () => { if (UI.rotating) setRotate(false); });
  restyle(); requestAnimationFrame(frame);
  setTimeout(() => FX.init({ Graph, RING, LIFT, TIME: TIME.map(([r]) => r), posOf, visible: () => LAYOUT.visible, routeView, nColor, nVal, onPlan, labelled: jobLabelled, restyle, setRotate, home, scanning: () => handlers.scanning() }), 150);
}

/** Cinematic effects (no-ops when WebGL effects are off). */
export const wave = (id, hex, dur, size) => FX.wave(id, hex, dur, size);
export const intro = () => FX.intro();

export function resize() { const el = $("graph"); if (!el) return; FX.setAspect(el.clientWidth / Math.max(1, el.clientHeight)); if (Graph) Graph.width(el.clientWidth).height(el.clientHeight); }

/** The default view: a fairly top-down angle, so the route runs across the rings instead of over the busy centre. */
function home() {
  const d = $("graph").clientWidth < 700 ? 1.85 : 1.5;
  return { pos: { x: 0, y: 520 * d, z: 300 * d }, look: { x: 0, y: 10, z: 0 } };
}
export function resetView(animate) {
  if (!Graph) return;
  const v = home();
  Graph.cameraPosition(v.pos, v.look, animate && !reduce ? 900 : 0);
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
  stopsMini = false;
  const box = $("labels");
  box.innerHTML = ""; labelEls = {};
  LAYOUT.visible.forEach(id => { const d = document.createElement("div"); d.className = "lb hide"; box.appendChild(d); labelEls[id] = d; });
  incidentEl = document.createElement("div"); incidentEl.className = "incident"; incidentEl.hidden = true;
  box.appendChild(incidentEl);
  HERE.el = document.createElement("div"); HERE.el.className = "here"; HERE.el.hidden = true; HERE.w = 0;
  HERE.el.innerHTML = `<span class="tag">${esc(t("map.youAreHere"))}</span><i class="stem"></i><i class="dot"></i>`;
  box.appendChild(HERE.el);
  updateLabels();
}

/** Job stars that get a label: the best few by match, plus the selected job and your goal (others show on hover). */
const JOB_LABELS = 12, JOB_LABELS_FULL = 8;
function labelledJobs() {
  const all = mapJobs(), top = [...all].sort((a, b) => matchOf(b) - matchOf(a)).slice(0, all.length > 14 ? JOB_LABELS_FULL : JOB_LABELS);
  return new Set([...top, selJob(), UI.job, ...mapJobs().filter(isGoal)].filter(Boolean));
}

export function updateLabels() {
  if (!S.E) return;
  const E = S.E, sel = selJob(), jobsOn = labelledJobs();
  let step = 0; const stepOf = {};
  const p = D.plan, ch = escoChain();
  if (UI.escoJob) (ch || []).forEach(k => { if (kindOf(k) === "learn") stepOf[k] = ++step; });
  else if (p?.route) p.route.nodes.forEach(k => { if (kindOf(k) === "learn") stepOf[k] = ++step; });
  Object.entries(labelEls).forEach(([id, el]) => {
    const n = N(id); if (!n && !isEsco(id) && !S.xsNames[id]) return;
    const kind = kindOf(id), real = !!n && E.isSkill(id), tk = real && E.taken(id), imp = real ? E.impact(id).label : "";
    let html = "", cls = "lb";
    if (kind === "you") { const cur = currentJobTitle(); cls += " you"; html = `${esc(t("map.you"))}${cur ? `<small>${esc(cur)}</small>` : ""}`; }
    else if (kind === "job") {
      cls += " job" + (id === sel ? " sel" : sel && !isGoal(id) && id !== hoverId ? " dim" : "") + (isGoal(id) ? " goal" : "");
      const w = jobWeeks(id), cov = id === sel ? coverageOf(id) : null;
      const wk = w != null ? esc(t("common.weeksN", { w })) : isEsco(id) ? "" : "–";
      html = `${isGoal(id) ? `<span class="tg goal">${esc(t("goal.mapTag"))}</span> ` : ""}${esc(nameOf(id))}<small><span>${esc(t("map.jobMatch", { match: matchOf(id) }))}</span>${wk ? `<span>${wk}</span>` : ""}</small>${cov ? `<small class="jcov">${esc(t("map.covered", { have: cov.have, n: cov.n }))}</small>` : ""}`;
    } else if (kind === "learn") {
      if (stepOf[id]) cls += " stop"; el._step = stepOf[id] || 0;
      // in route view a numbered step also counts the other missing skills clustered round it ("+6")
      const more = stepOf[id] && routeView() ? LAYOUT.cluster.get(id) || 0 : 0;
      html = `${stepOf[id] ? `<span class="n">${stepOf[id]}</span>` : ""}<span class="tx">${esc(nameOf(id))}${n?.emerging ? ` <span class="tg new">${esc(t("map.new"))}</span>` : ""}${S.xsMeta?.[id]?.aiEra ? ` <span class="tg aiera">${esc(t("map.aiEra"))}</span>` : ""}</span>${more ? `<span class="more">+${more}</span>` : ""}`;
    }
    else html = `${esc(nameOf(id))}${tk ? ` <span class="tg taken">${esc(t("map.tookOver"))}</span>` : imp === "Declining" ? ` <span class="tg risk">${esc(t("map.atRisk"))}</span>` : imp === "Rising human skill" ? ` <span class="tg human">${esc(t("map.humanEdge"))}</span>` : ""}`;
    const show = UI.labelsAll || kind === "you" || (kind === "job" && jobsOn.has(id)) || onPlan(id) || (UI.tab === "skills" && kind === "have" && (imp === "Declining" || imp === "Rising human skill")) || id === hoverId || id === S.signalNode;
    el.className = cls + (show ? "" : " hide");
    if (el.innerHTML !== html) el.innerHTML = html;
  });
  if (HERE.el) { const tg = HERE.el.firstChild, tx = t("map.youAreHere"); if (tg.textContent !== tx) { tg.textContent = tx; HERE.w = 0; } }
  // measure once per content change; placeLabels() uses the sizes to avoid overlaps
  Object.values(labelEls).forEach(el => { el.classList.remove("mini"); if (!el.classList.contains("hide")) { el._w = el.offsetWidth; el._h = el.offsetHeight; } });
  if (incidentEl) {
    const on = !!(S.signalNode && LAYOUT.visible.has(S.signalNode));
    incidentEl.hidden = !on;
    if (on) { incidentEl.innerHTML = `<i data-lucide="triangle-alert"></i>${esc(t("map.incident", { name: nameOf(S.signalNode) }))}`; icons(); }
  }
}

// Labels: place the most important first (numbered route stops, hovered, you, selected job, path, other jobs, rest) and hide
// any that would collide. Route stops and the top few are always placed; everything else yields to them.
// The map's controls (legend, time bar, view buttons, agents card, prompts) as boxes in label coordinates: labels step
// around them, so nothing important ends up under a control. Measured at most every 400 ms (and after a resize).
let blockers = [], blockersAt = -Infinity, visX = [0, Infinity];
let stopsMini = false; // this layout's route stops show numbers only (set when a phone has no room for their names)
function mapBlockers(now) {
  if (now - blockersAt < 400) return blockers;
  blockersAt = now;
  const box = $("labels")?.getBoundingClientRect(); if (!box) return blockers = [];
  // the scene runs under the side panel on desktop; only the stage's own width is visible
  const st = $("stage")?.getBoundingClientRect();
  visX = st ? [Math.max(0, st.left - box.left), st.right - box.left] : [0, box.width];
  blockers = [".legend", ".timeline", ".viewctl", "#agents", "#prompt", "#guide", "#map-card"].map(sel => document.querySelector(sel))
    .filter(el => el && !el.hidden && el.offsetParent !== null)
    .map(el => el.getBoundingClientRect()).filter(r => r.width && r.height && r.bottom > box.top && r.top < box.bottom && r.right > box.left && r.left < box.right)
    .map(r => ({ x: r.left - box.left - 6, y: r.top - box.top - 6, w: r.width + 12, h: r.height + 12 }));
  return blockers;
}
addEventListener("resize", () => { blockersAt = -Infinity; stopsMini = false; });

function placeLabels() {
  const items = [];
  for (const id in labelEls) {
    const el = labelEls[id]; if (el.classList.contains("hide")) continue;
    const p = posOf(id); if (!p) continue;
    const s = Graph.graph2ScreenCoords(p.x, p.y, p.z), k = kindOf(id);
    const sel = id === selJob();
    // the selected job claims its spot first (it must stay clear of the time bar); then route stops in route order;
    // other job labels in order of match
    const stop = el.classList.contains("stop");
    const pr = sel ? -0.5 : stop ? (el._step || 0) / 100 : id === hoverId ? 1 : k === "you" ? 1 : id === S.signalNode ? 2 : onPlan(id) ? 3 : k === "job" ? 4 + 0.9 * (1 - jobStrength(id)) : 5;
    items.push({ el, s, stop, off: k === "job" ? (sel ? 34 : 16) : k === "you" ? 22 : 12, pr, w: el._w || 120, h: el._h || 22 });
  }
  items.sort((a, b) => a.pr - b.pr);
  const gh = $("graph").clientHeight;
  const placed = placedLabels = [...mapBlockers(performance.now())];
  const gl = visX[0], gw = Math.min($("graph").clientWidth, visX[1]);
  const hit = r => placed.some(q => r.x < q.x + q.w && r.x + r.w > q.x && r.y < q.y + q.h && r.y + r.h > q.y);
  const inside = r => r.y >= 6 && r.y + r.h <= gh - 6 && r.x >= gl + 2 && r.x + r.w <= gw - 2;
  // the "new AI signal" badge sits above its node; other labels step around it
  if (incidentEl && !incidentEl.hidden && S.signalNode) {
    const ip = posOf(S.signalNode);
    if (ip) { const s = Graph.graph2ScreenCoords(ip.x, ip.y, ip.z), w = incidentEl.offsetWidth, h = incidentEl.offsetHeight; placed.push({ x: s.x - w / 2 - 4, y: s.y - 14 - h - 2, w: w + 8, h: h + 4 }); }
  }
  placeHere(placed);
  // A long route (an ESCO job: up to five stops in a short stretch of screen) labels its stops beside the path, on the
  // side each stop leans to, stepping on along the route when a spot is taken, so 1, 2, 3 read in order down the line.
  const stops = items.filter(it => it.stop);
  const sideMode = stops.length >= 3;
  let dirY = 1, ax = 0, ay = 0, bx = 0, by = 0;
  if (sideMode) {
    const r = posOf(S.E.root), j = posOf(selJob() || "");
    if (r && j) {
      const a = Graph.graph2ScreenCoords(r.x, r.y, r.z), b = Graph.graph2ScreenCoords(j.x, j.y, j.z);
      ax = a.x; ay = a.y; bx = b.x; by = b.y; dirY = b.y >= a.y ? 1 : -1;
    }
  }
  const sideOf = (it, i) => {
    const cross = (bx - ax) * (it.s.y - ay) - (by - ay) * (it.s.x - ax), len = Math.hypot(bx - ax, by - ay) || 1;
    return Math.abs(cross / len) < 4 ? (i % 2 ? 1 : -1) : (cross / len > 0 ? -1 : 1) * Math.sign(by - ay || 1);
  };
  const tryAt = (it, x, y) => {
    const r = { x: x - 4, y: y - 2, w: it.w + 8, h: it.h + 4 };
    if (hit(r) || !inside(r)) return false;
    placed.push(r); it.el.classList.remove("clash");
    it.el.style.transform = `translate(${x + it.w / 2}px, ${y}px) translate(-50%, 0)`;
    return true;
  };
  let si = 0;
  const sel = selJob();
  for (const it of items) {
    const clampX = cx => Math.max(gl + it.w / 2 + 6, Math.min(gw - it.w / 2 - 6, cx));
    const xOn = side => Math.max(gl + 6, Math.min(gw - it.w - 6, side > 0 ? it.s.x + 14 : it.s.x - 14 - it.w));
    if (sideMode && it.stop) {
      const pref = sideOf(it, si++), step = it.h + 5;
      const tries = [[pref, 0], [pref, 1], [-pref, 0], [-pref, 1], [pref, 2], [-pref, 2], [pref, 3], [-pref, 3], [pref, -1], [-pref, -1]];
      if (!stopsMini && tries.some(([side, k]) => tryAt(it, xOn(side), it.s.y - it.h / 2 + dirY * k * step))) { it.el.classList.remove("mini"); continue; }
      // no room for the names (a phone): every stop keeps just its numbered marker; the list under the map names them
      if (!stopsMini && gw - gl < 600) stopsMini = true;
      it.el.classList.add("mini"); it.w = it.h;
      if ([[pref, 0], [-pref, 0], [pref, 1], [-pref, 1], [pref, 2], [-pref, 2], [pref, -1], [-pref, -1]].some(([side, k]) => tryAt(it, it.s.x + (side > 0 ? 8 : -8 - it.w), it.s.y - it.h / 2 + dirY * k * (it.h + 3)))) continue;
      it.el.style.transform = `translate(${it.s.x + 8 + it.w / 2}px, ${it.s.y - it.h / 2}px) translate(-50%, 0)`; it.el.classList.remove("clash");
      continue;
    }
    // the selected job: under its star, else beside it (on a phone the time bar takes the space under it), else above,
    // so it covers the route's last stops only as a last resort
    if (sideMode && it.el === labelEls[sel] && [it.s.y + it.off, it.s.y + 26, it.s.y + 20].some(cy => tryAt(it, clampX(it.s.x) - it.w / 2, cy))) continue;
    if (sideMode && it.el === labelEls[sel] && [1, -1].some(side => tryAt(it, side > 0 ? it.s.x + 26 : it.s.x - 26 - it.w, it.s.y - it.h / 2))) continue;
    // keep long labels (ESCO skill names) on screen on a phone: shift them sideways inside the map's width
    const cx = clampX(it.s.x), x = cx - it.w / 2;
    // below, above, then (for the labels that must show: route stops, you, the selected job) one and two rows further out
    const st = it.h + 6, cands = [it.s.y + it.off, it.s.y - it.off - it.h];
    if (it.pr <= 2) cands.push(it.s.y + it.off + st, it.s.y - it.off - it.h - st, it.s.y + it.off + 2 * st, it.s.y - it.off - it.h - 2 * st);
    if (cands.some(cy => tryAt(it, x, cy))) continue;
    // must-show labels: nothing free, so sit as near the node as the free area allows (never under a control)
    if (it.pr <= 2) {
      const tl = blockers.find(b => b.y > gh / 2 && b.x < cx && b.x + b.w > cx);
      const maxY = (tl ? tl.y : gh - 6) - it.h - 2;
      const y = Math.max(6, Math.min(maxY, it.s.y - it.off - it.h));
      placed.push({ x: x - 4, y: y - 2, w: it.w + 8, h: it.h + 4 }); it.el.classList.remove("clash");
      it.el.style.transform = `translate(${cx}px, ${y}px) translate(-50%, 0)`;
      continue;
    }
    it.el.classList.add("clash");
  }
}

// label boxes from the last placeLabels(), so ring names can step aside for them
let placedLabels = [];
let lastFrame = performance.now();
function frame(now) {
  now = now || performance.now();
  const dt = Math.min(0.05, Math.max(0, (now - lastFrame) / 1000)); lastFrame = now;
  if (Graph) {
    try {
      if (UI.tab !== styledTab) restyle(); // "evolves into" links follow the open tab, however it was switched
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
  if (routeView()) { $("rings").innerHTML = coverageRing(); return; }
  // ring names help only before a route is on the map; after that they clash with the dots and get cut off
  // (on a phone the map is too small for both: ring names go as soon as a route is drawn)
  const phoneRoute = $("graph").clientWidth < 600 && !!(D.plan?.route || UI.escoJob);
  const names = (UI.job && UI.picked) || UI.escoJob || goal() || phoneRoute ? ["", "", "", ""] : ringNames || ["", "", "", ""];
  let out = "";
  // your skills and the skills to learn (the job stars' orbit is drawn as time rings, below)
  for (let r = 1; r <= 2; r++) {
    let d = "", best = null;
    for (let i = 0; i <= 72; i++) {
      const a = i / 72 * Math.PI * 2, s = Graph.graph2ScreenCoords(RING[r] * Math.cos(a), LIFT[r], RING[r] * Math.sin(a));
      d += (i ? "L" : "M") + s.x.toFixed(1) + "," + s.y.toFixed(1);
      if (!best || s.y > best.y) best = s;
    }
    if (!FX.isOn()) out += `<path d="${d}" fill="none" stroke="var(--ring)" stroke-width="1.1" stroke-dasharray="3 6"/>`;
    // a ring name sits under its ring; skip it when a node label covers that spot
    const nw = names[r] ? names[r].length * 6.6 + 8 : 0, nr = { x: best.x - nw / 2, y: best.y + 12, w: nw, h: 18 };
    if (names[r] && !placedLabels.some(q => nr.x < q.x + q.w && nr.x + nr.w > q.x && nr.y < q.y + q.h && nr.y + nr.h > q.y)) out += `<text class="ring-label" x="${best.x.toFixed(1)}" y="${(best.y + 26).toFixed(1)}" text-anchor="middle">${esc(names[r])}</text>`;
  }
  out += timeRings();
  out += coverageRing();
  $("rings").innerHTML = out;
}

/** The time rings: faint circles at 3 months, 6 months, 1 year and 2 years+ to job-ready. Their names line up along one
 *  radius, like a ruler, at the lowest angle on the visible map where the most of them are clear of node labels (with
 *  the 3D layer on, the circles themselves are drawn in fx.js). */
const TIME_STEPS = 64, RULER = { i: -1, at: 0 };
function timeRings() {
  const gh = $("graph").clientHeight, x0 = visX[0] + 30, x1 = Math.min($("graph").clientWidth, visX[1]) - 30, fx = FX.isOn();
  const now = performance.now(), scan = now - RULER.at > 250; // look for a new spot a few times a second, not every frame
  if (scan) RULER.at = now;
  const ang = i => i / TIME_STEPS * Math.PI * 2, pt = (r, i) => Graph.graph2ScreenCoords(TIME[r][0] * Math.cos(ang(i)), LIFT[3], TIME[r][0] * Math.sin(ang(i)));
  const pts = !fx || scan ? TIME.map((_, r) => Array.from({ length: TIME_STEPS }, (_, i) => pt(r, i))) : null;
  const names = TIME.map(([, key]) => t(key)), boxOf = (s, r) => { const w = names[r].length * 6.4 + 10; return { x: s.x - w / 2, y: s.y - 9, w, h: 18 }; };
  // keep clear of node labels and of the job stars themselves
  const stars = mapJobs().filter(j => LAYOUT.visible.has(j)).map(j => { const p = posOf(j), s = Graph.graph2ScreenCoords(p.x, p.y, p.z); return { x: s.x - 12, y: s.y - 12, w: 24, h: 24 }; });
  const clear = (q, L) => !L.some(o => q.x < o.x + o.w && q.x + q.w > o.x && q.y < o.y + o.h && q.y + q.h > o.y);
  const free = q => q.x >= x0 && q.x + q.w <= x1 && q.y >= 6 && q.y + q.h <= gh - 6 && clear(q, placedLabels) && clear(q, stars);
  // the names that fit at angle i (inner rings first; a name that would touch the previous one is skipped)
  const fitAt = (i, P) => { const ok = []; for (let r = 0; r < TIME.length; r++) { const s = P ? P[r][i] : pt(r, i), q = boxOf(s, r); if (free(q) && clear(q, ok.map(o => o.q))) ok.push({ r, s, q }); } return ok; };
  if (scan) {
    let bestScore = -1; RULER.i = -1;
    for (let i = 0; i < TIME_STEPS; i++) { const n = fitAt(i, pts).length, score = n * 1e5 + pts[0][i].y; if (n && score > bestScore) { bestScore = score; RULER.i = i; } }
  }
  let out = "";
  if (!fx) pts.forEach(row => { out += `<path d="${row.map((s, i) => (i ? "L" : "M") + s.x.toFixed(1) + "," + s.y.toFixed(1)).join("")}Z" fill="none" stroke="var(--ring)" stroke-width="1"/>`; });
  if (RULER.i >= 0) fitAt(RULER.i, pts).forEach(({ r, s }) => { out += `<text class="ring-label time" x="${s.x.toFixed(1)}" y="${(s.y + 4).toFixed(1)}" text-anchor="middle">${esc(names[r])}</text>`; });
  return out;
}

/** A ring around the selected job's star: the arc in "your skills" blue is the share of its skills you have. */
function coverageRing() {
  const j = selJob(), cov = coverageOf(j), p = j && LAYOUT.visible.has(j) ? posOf(j) : null;
  if (!cov || !p) return "";
  const s = Graph.graph2ScreenCoords(p.x, p.y, p.z), r = $("graph").clientWidth < 700 ? 22 : 27, c = 2 * Math.PI * r, f = cov.have / cov.n;
  return `<g class="cov-ring" transform="translate(${s.x.toFixed(1)},${s.y.toFixed(1)}) rotate(-90)"><circle r="${r}" class="cov-bg"/><circle r="${r}" class="cov-fg" stroke-dasharray="${(c * f).toFixed(1)} ${c.toFixed(1)}"/></g>`;
}

/** Show a node's tooltip (a tap on one of the small skill dots, which has no details panel). */
export function showTipFor(id) { if (LAYOUT.visible.has(id)) showTip(id); }

function showTip(id) {
  const n = N(id), tip = $("tip"), p = posOf(id); if (!p) return;
  if (!n) return showExtTip(id, p);
  const E = S.E, s = Graph.graph2ScreenCoords(p.x, p.y, p.z), k = kindOf(id);
  const kind = k === "you" ? t("tip.current") : k === "job" ? t("tip.job") : k === "have" ? t("tip.yourSkill", { n: E.lvl(id) }) : t("tip.learn");
  const status = k === "job" ? matchOf(id) + "%" : E.isSkill(id) ? (E.taken(id) ? t("map.tookOver") : t("impact." + E.impact(id).label)) : "–";
  tip.innerHTML = `<b>${esc(n.name)}</b><span class="k">${esc(kind)}</span>
    <div class="row"><span>${esc(t("common.exposure"))}</span><span>${Math.round(E.exposure(id) * 100)}%</span></div>
    <div class="row"><span>${esc(t("common.demand"))}</span><span>${sign(E.demand(id))}</span></div>
    <div class="row"><span>${esc(k === "job" ? t("tip.match") : t("tip.status"))}</span><span>${esc(status)}</span></div>${k === "job" ? `<p class="tip-def">${esc(t("match.def"))}</p>` : ""}`;
  placeTip(tip, s);
}
function placeTip(tip, s) {
  tip.hidden = false;
  const off = $("graph").getBoundingClientRect().left - $("stage").getBoundingClientRect().left;
  const W2 = $("stage").clientWidth, tw = tip.offsetWidth, sx = s.x + off;
  tip.style.left = (sx + 20 + tw > W2 ? Math.max(8, sx - 20 - tw) : sx + 20) + "px"; tip.style.top = Math.max(8, s.y - 40) + "px";
}
/** Tooltip for an ESCO job or an ESCO skill (not in the catalogue, so no exposure or demand rows). */
/** A numbered step lists the skills clustered around it; a small dot names the step it's learned with. */
function clusterTip(id) {
  const xp = escoPlan(); if (!xp) return "";
  const plain = id.startsWith("xs:") ? id.slice(3) : id, m = xp.missing.find(x => x.id === plain);
  if (xp.keys.includes(plain)) {
    const g = xp.missing.filter(x => x.group === plain && !xp.keys.includes(x.id));
    return g.length ? `<p class="tip-def">${esc(t("tip.withStep", { n: g.length }))}</p><ul class="tip-list">${g.slice(0, 6).map(x => `<li>${esc(x.name)}</li>`).join("")}${g.length > 6 ? `<li>${esc(t("tip.andMore", { n: g.length - 6 }))}</li>` : ""}</ul>` : "";
  }
  return m?.group ? `<p class="tip-def">${esc(t("tip.learnWith", { name: nameOf(mapId(m.group)) }))}</p>` : "";
}
function showExtTip(id, p) {
  const tip = $("tip"), s = Graph.graph2ScreenCoords(p.x, p.y, p.z), r = escoRow(id);
  if (!r && !S.xsNames[id]) return;
  tip.innerHTML = r ? `<b>${esc(nameOf(id))}</b><span class="k">${esc(t("tip.escoJob"))}</span>
    <div class="row"><span>${esc(t("tip.match"))}</span><span>${esc(String(r.match))}%</span></div>
    <div class="row"><span>${esc(t("tip.escoSkills"))}</span><span>${esc(r.close != null ? t("esco.haveClose", { have: r.have, close: r.close, n: r.essential }) : t("esco.skillsOf", { have: r.have, n: r.essential }))}</span></div>
    ${r.iloExposure != null ? `<div class="row"><span>${esc(t("common.exposure"))}</span><span>${Math.round(r.iloExposure * 100)}%</span></div>` : ""}<p class="tip-def">${esc(t("match.def"))}</p>`
    : `<b>${esc(nameOf(id))}</b><span class="k">${esc(t(S.xsMeta[id]?.aiEra ? "aiEra.badge" : S.xsOwned.has(id) ? "legend.have" : "tip.learn"))}</span>${clusterTip(id)}`;
  placeTip(tip, s);
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
