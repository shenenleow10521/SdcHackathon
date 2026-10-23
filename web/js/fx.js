// Cinematic layer for the 3D map: glowing planets, bloom, deep-space backdrop (sky, twinkling stars, nebulae, glowing orbits).
// Ported from the HalaTuju.zip design (halatuju-app.html). Built only from the three.js classes that already live inside
// 3d-force-graph (taken from its post-processing composer), so the page never loads a second copy of three.js.
// Every effect is optional: if any step fails, the plain constellation keeps working exactly as before.
import { S, UI, kindOf } from "./state.js";
import { $, reduce } from "./util.js";

let Graph = null, ctx = null;
const FX = { on: false, K: null, scene: null, geo: null, U: { uTime: { value: 0 }, uEnc: { value: 1 } }, nodes: {}, objs: [], waves: [],
  beam: null, sky: null, bg: null, bloom: null, bloomRan: false, intro: null, introPending: false, focus: null, focusId: null, now: 0, lastWave: 0, aspect: 1.6,
  speed: reduce ? 0 : 1 };
export const isOn = () => FX.on;
export const focusSet = () => (FX.on ? FX.focus : null);
const isSkill = id => !!S.E && S.E.isSkill(id);
const takenOf = id => isSkill(id) && S.E.taken(id);
const ringOf = id => ({ you: 0, have: 1, learn: 2, job: 3 })[kindOf(id)] ?? 2;
const FXS = {
  enc: "uniform float uEnc;\nvec3 enc(vec3 c){ return mix(c, pow(max(c, vec3(0.0)), vec3(0.4545)), uEnc); }\n",
  coreV: `varying vec3 vN; varying vec3 vV;
void main(){ vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  coreF: `uniform vec3 uColor; uniform float uAlpha; uniform float uGlow; varying vec3 vN; varying vec3 vV;
void main(){ vec3 n = normalize(vN), v = normalize(vV); float ndv = clamp(dot(n, v), 0.0, 1.0);
  vec3 L = normalize(vec3(-0.45, 0.65, 0.6)); float dif = clamp(dot(n, L), 0.0, 1.0);
  float rim = pow(1.0 - ndv, 2.4); float spec = pow(clamp(dot(reflect(-L, n), v), 0.0, 1.0), 28.0);
  vec3 c = uColor * (0.22 + 0.78 * dif) + uColor * uGlow + mix(uColor, vec3(1.0), 0.3) * rim * (0.35 + uGlow * 1.6) + vec3(spec * 0.3);
  gl_FragColor = vec4(enc(c), uAlpha); }`,
  bbV: `attribute vec2 corner; uniform float uSize; varying vec2 vC;
void main(){ vC = corner; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); mv.xy += corner * uSize; gl_Position = projectionMatrix * mv; }`,
  haloF: `uniform vec3 uColor; uniform float uAlpha; uniform float uTime; uniform float uPulse; uniform float uFlare; varying vec2 vC;
void main(){ float d = length(vC); if (d > 1.0) discard;
  float g = exp(-d * d * 6.0) * 0.8 + exp(-d * d * 28.0) * 0.9;
  float p = 1.0 + uPulse * 0.35 * sin(uTime * 3.0);
  float ax = abs(vC.x), ay = abs(vC.y);
  float spikes = (exp(-ay * 70.0) * exp(-ax * 3.2) + exp(-ax * 70.0) * exp(-ay * 3.2)) * (0.8 + 0.2 * sin(uTime * 1.7));
  vec3 col = mix(uColor, vec3(1.0), clamp(spikes * uFlare, 0.0, 0.7));
  gl_FragColor = vec4(enc(col), (g * (1.0 - smoothstep(0.7, 1.0, d)) * p + spikes * uFlare) * uAlpha); }`,
  pulseF: `uniform vec3 uColor; uniform float uAlpha; uniform float uTime; varying vec2 vC;
void main(){ float d = length(vC); float a = 0.0;
  for (int i = 0; i < 2; i++) { float r = fract(uTime * 0.38 + float(i) * 0.5); a += (1.0 - smoothstep(0.0, 0.045, abs(d - r))) * (1.0 - r) * (1.0 - r); }
  gl_FragColor = vec4(enc(uColor), a * uAlpha); }`,
  flatV: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  ringF: `uniform vec3 uColor; uniform float uAlpha; uniform float uTime; varying vec2 vUv;
void main(){ float edge = smoothstep(0.0, 0.3, vUv.y) * (1.0 - smoothstep(0.55, 1.0, vUv.y));
  float bands = 0.6 + 0.4 * sin(vUv.y * 22.0);
  float sweep = 0.35 + 0.65 * pow(0.5 + 0.5 * sin((vUv.x - uTime * 0.07) * 6.2831853), 5.0);
  gl_FragColor = vec4(enc(uColor), edge * bands * sweep * uAlpha); }`,
  orbitF: `uniform vec3 uColor; uniform float uAlpha; varying vec2 vUv;
void main(){ float edge = 1.0 - abs(vUv.y * 2.0 - 1.0); gl_FragColor = vec4(enc(uColor), edge * uAlpha); }`,
  beamV: `attribute vec2 corner; uniform float uH; uniform float uW; varying vec2 vC;
void main(){ vC = corner; vec4 mv = modelViewMatrix * vec4(0.0, corner.y * uH, 0.0, 1.0); mv.x += corner.x * uW; gl_Position = projectionMatrix * mv; }`,
  beamF: `uniform vec3 uColor; uniform float uAlpha; uniform float uTime; varying vec2 vC;
void main(){ float x = vC.x, y = vC.y; float core = exp(-x * x * 22.0); float soft = exp(-x * x * 3.0) * 0.4;
  float fade = pow(1.0 - y, 1.7) * smoothstep(0.0, 0.04, y);
  float scan = 0.7 + 0.3 * sin(y * 46.0 - uTime * 5.0);
  gl_FragColor = vec4(enc(mix(uColor, vec3(1.0), core * 0.55)), (core + soft) * fade * scan * uAlpha); }`,
  waveF: `uniform vec3 uColor; uniform float uProg; varying vec2 vUv;
void main(){ vec2 q = vUv * 2.0 - 1.0; float d = length(q); if (d > 1.0) discard; float r = max(uProg, 0.001); float w = 0.03 + 0.10 * r;
  float ring = 1.0 - smoothstep(0.0, w, abs(d - r)); float fill = (1.0 - smoothstep(0.0, r, d)) * 0.12 * (1.0 - r);
  gl_FragColor = vec4(enc(uColor), (ring + fill) * (1.0 - r) * 1.5); }`,
  starV: `attribute vec2 corner; attribute float seed; attribute float size; uniform float uTime; varying vec2 vC; varying float vA; varying float vS;
void main(){ vC = corner; vS = seed; vec4 mv = modelViewMatrix * vec4(position, 1.0);
  float tw = 0.55 + 0.45 * sin(uTime * (0.7 + seed * 2.3) + seed * 51.0); vA = tw;
  mv.xy += corner * size * (0.8 + 0.2 * tw); gl_Position = projectionMatrix * mv; }`,
  starF: `varying vec2 vC; varying float vA; varying float vS;
void main(){ float d = length(vC); if (d > 1.0) discard; float a = pow(1.0 - d, 2.6) + exp(-d * d * 40.0) * 0.6;
  vec3 c = vec3(0.78, 0.85, 1.0); if (vS > 0.88) c = vec3(1.0, 0.86, 0.7); else if (vS < 0.18) c = vec3(0.62, 0.74, 1.0);
  gl_FragColor = vec4(enc(c), a * vA * 0.75); }`,
  nebF: `uniform vec3 uColor; uniform float uAlpha; uniform float uSeed; varying vec2 vC;
float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n2(vec2 p){ vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1.0, 0.0)), f.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), f.x), f.y); }
float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { s += a * n2(p); p = p * 2.03 + 1.7; a *= 0.5; } return s; }
void main(){ float d = length(vC); if (d > 1.0) discard; float f = fbm(vC * 2.4 + uSeed * 7.0);
  float g = exp(-d * d * 3.2) * smoothstep(0.3, 0.9, f);
  gl_FragColor = vec4(enc(uColor * (0.7 + 0.6 * f)), g * uAlpha); }`,
  bgV: `varying vec2 vS; void main(){ vS = position.xy * 0.5 + 0.5; gl_Position = vec4(position.xy, 0.9999, 1.0); }`,
  bgF: `uniform float uAspect; varying vec2 vS;
void main(){ vec2 q = (vS - vec2(0.42, 0.5)) * vec2(uAspect, 1.0); float d = length(q);
  vec3 c = mix(vec3(0.0085, 0.016, 0.040), vec3(0.0014, 0.0019, 0.0035), smoothstep(0.0, 0.95, d));
  c += vec3(0.010, 0.004, 0.022) * exp(-pow(length((vS - vec2(0.85, 0.15)) * vec2(uAspect, 1.0)), 2.0) * 3.0);
  gl_FragColor = vec4(enc(c), 1.0); }`,
  fsV: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`,
  brightF: `uniform sampler2D tDiffuse; uniform float uThreshold; varying vec2 vUv;
void main(){ vec3 c = texture2D(tDiffuse, vUv).rgb; float l = max(max(c.r, c.g), c.b); gl_FragColor = vec4(c * smoothstep(uThreshold, uThreshold + 0.5, l), 1.0); }`,
  blurF: `uniform sampler2D tDiffuse; uniform vec2 uDir; varying vec2 vUv;
void main(){ vec3 s = texture2D(tDiffuse, vUv).rgb * 0.2270270270;
  s += texture2D(tDiffuse, vUv + uDir * 1.3846153846).rgb * 0.3162162162; s += texture2D(tDiffuse, vUv - uDir * 1.3846153846).rgb * 0.3162162162;
  s += texture2D(tDiffuse, vUv + uDir * 3.2307692308).rgb * 0.0702702703; s += texture2D(tDiffuse, vUv - uDir * 3.2307692308).rgb * 0.0702702703;
  gl_FragColor = vec4(s, 1.0); }`,
  compF: `uniform sampler2D tDiffuse; uniform sampler2D tB1; uniform sampler2D tB2; uniform float uStrength; varying vec2 vUv;
void main(){ vec3 base = texture2D(tDiffuse, vUv).rgb; vec3 b = texture2D(tB1, vUv).rgb * 0.8 + texture2D(tB2, vUv).rgb * 1.3;
  vec3 c = base + b * uStrength; c = c / (1.0 + max(c - vec3(1.0), vec3(0.0)) * 0.6);
  vec2 q = vUv - vec2(0.5); c *= 1.0 - smoothstep(0.3, 0.95, length(q * vec2(1.15, 1.0))) * 0.38;
  c = pow(max(c, vec3(0.0)), vec3(0.4545));
  c += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0); }`
};
const hashOf = s => { let h = 2166136261; for (const ch of s) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return ((h >>> 0) % 1000) / 1000; };
function fxLin(c) {
  c = (c || "").trim(); let r = 1, g = 1, b = 1;
  const m = /rgba?\(([^)]+)\)/.exec(c);
  if (m) { const p = m[1].split(",").map(Number); r = p[0] / 255; g = p[1] / 255; b = p[2] / 255; }
  else if (c[0] === "#") { let h = c.slice(1); if (h.length === 3) h = h.split("").map(x => x + x).join(""); const n = parseInt(h, 16); r = (n >> 16 & 255) / 255; g = (n >> 8 & 255) / 255; b = (n & 255) / 255; }
  return [r, g, b].map(v => Math.pow(v, 2.2));
}
const fxMix = (a, b, t) => [0, 1, 2].map(i => a[i] + (b[i] - a[i]) * t);

// three.js classes, borrowed from the library's own composer
function fxKit() {
  const comp = Graph.postProcessingComposer && Graph.postProcessingComposer();
  const cp = comp && comp.copyPass, quad = cp && (cp.fsQuad || cp._fsQuad), qm = quad && (quad._mesh || quad.mesh);
  if (!qm || !cp.material || !comp.renderTarget1) return null;
  let BG = qm.geometry.constructor; const up = Object.getPrototypeOf(BG);
  if (up && up.prototype && typeof up.prototype.setAttribute === "function") BG = up;
  return { comp, SM: cp.material.constructor, Mesh: qm.constructor, BG, Attr: qm.geometry.attributes.position.constructor,
    Quad: quad.constructor, Obj3D: Object.getPrototypeOf(Graph.scene().constructor), fsGeo: qm.geometry };
}
function fxGeo(attrs, index) {
  const g = new FX.K.BG();
  Object.entries(attrs).forEach(([k, [arr, n]]) => g.setAttribute(k, new FX.K.Attr(arr, n)));
  if (index) g.setIndex(index);
  return g;
}
function fxMat(vs, fs, uniforms, opts) {
  return new FX.K.SM(Object.assign({ uniforms: Object.assign({ uTime: FX.U.uTime, uEnc: FX.U.uEnc }, uniforms || {}),
    vertexShader: vs, fragmentShader: FXS.enc + fs, transparent: true, depthWrite: false, blending: 2 }, opts || {}));
}
function fxMesh(geo, mat, cull) { const m = new FX.K.Mesh(geo, mat); if (!cull) m.frustumCulled = false; return m; }
const fxNoRay = () => {};
function fxSphere(n) {
  const p = [], idx = [];
  for (let y = 0; y <= n; y++) { const th = y / n * Math.PI; for (let x = 0; x <= n; x++) { const ph = x / n * Math.PI * 2; p.push(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th)); } }
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const a = y * (n + 1) + x + 1, b = y * (n + 1) + x, c = (y + 1) * (n + 1) + x, d = (y + 1) * (n + 1) + x + 1;
    if (y !== 0) idx.push(a, b, d); if (y !== n - 1) idx.push(b, c, d);
  }
  const g = fxGeo({ position: [p, 3], normal: [p.slice(), 3] }, idx); g.computeBoundingSphere(); return g;
}
function fxQuads(n, each) {
  const a = { position: [[], 3], corner: [[], 2] }, idx = [];
  for (let i = 0; i < n; i++) {
    const v = each ? each(i) : {}, b = i * 4;
    for (let k = 0; k < 4; k++) { a.position[0].push(...(v.pos || [0, 0, 0])); Object.entries(v.attrs || {}).forEach(([key, val]) => { const arr = Array.isArray(val) ? val : [val]; (a[key] = a[key] || [[], arr.length])[0].push(...arr); }); }
    a.corner[0].push(-1, -1, 1, -1, 1, 1, -1, 1); idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return fxGeo(a, idx);
}
function fxAnnulus(r0, r1, seg) {
  const pos = [], uv = [], idx = [];
  for (let i = 0; i <= seg; i++) { const a = i / seg * Math.PI * 2, c = Math.cos(a), s = Math.sin(a); pos.push(c * r0, 0, s * r0, c * r1, 0, s * r1); uv.push(i / seg, 0, i / seg, 1); }
  for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  return fxGeo({ position: [pos, 3], uv: [uv, 2] }, idx);
}

// one glowing planet per node: a lit core, a soft halo, and for jobs and "you" a ring and a pulse

// one glowing planet per node: a lit core, a soft halo, and for jobs and "you" a ring and a pulse
function fxNode(n) {
  const K = FX.K, id = n.id, t = kindOf(id), g = new K.Obj3D();
  const core = new K.Mesh(FX.geo.sphere, fxMat(FXS.coreV, FXS.coreF, { uColor: { value: [1, 1, 1] }, uAlpha: { value: 1 }, uGlow: { value: 0.2 } }, { blending: 1, depthWrite: true }));
  const halo = fxMesh(FX.geo.quad, fxMat(FXS.bbV, FXS.haloF, { uColor: { value: [1, 1, 1] }, uAlpha: { value: 0 }, uSize: { value: 1 }, uPulse: { value: 0 }, uFlare: { value: 0 } }));
  halo.renderOrder = 3; halo.raycast = fxNoRay;
  g.add(core); g.add(halo);
  const st = { id, g, core, halo, ring: null, pulse: null };
  if (t === "job" || t === "you") {
    const h = hashOf(id);
    const ring = fxMesh(FX.geo.annulus, fxMat(FXS.flatV, FXS.ringF, { uColor: { value: [1, 1, 1] }, uAlpha: { value: 0 } }, { side: 2 }), true);
    ring.rotation.x = 0.25 + h * 0.4; ring.rotation.z = (h - 0.5) * 0.7; ring.raycast = fxNoRay; ring.renderOrder = 2;
    const pulse = fxMesh(FX.geo.quad, fxMat(FXS.bbV, FXS.pulseF, { uColor: { value: [1, 1, 1] }, uAlpha: { value: 0 }, uSize: { value: 1 } }));
    pulse.raycast = fxNoRay; pulse.renderOrder = 3;
    g.add(ring); g.add(pulse); st.ring = ring; st.pulse = pulse;
  }
  st.tgt = fxTarget(id); st.cur = Object.assign({}, st.tgt, { c: st.tgt.c.slice() });
  FX.nodes[id] = st; fxApply(st, 1);
  return g;
}
function fxTarget(id) {
  const t = kindOf(id), tk = takenOf(id), sel = id === UI.job, on = ctx.onPlan(id), n = { id };
  const c = fxLin(ctx.nColor(n)), r = Math.max(2.2, Math.cbrt(ctx.nVal(n)) * 4);
  // only "you", the chosen job and the route glow; everything else is a flat, slightly dimmed sphere so its colour reads
  let hs = 0, ha = 0, glow = 0.04, ra = 0, pa = 0, fl = 0, ca = 0.65;
  if (t === "you") { hs = r * 3.2; ha = 0.5; glow = 0.34; ra = 0.4; pa = 0.3; fl = 0.35; ca = 1; }
  else if (t === "job" && sel) { hs = r * 4; ha = 0.75; glow = 0.42; ra = 0.7; pa = 0.5; fl = 0.25; ca = 1; }
  else if (tk) { glow = 0; ca = 0.5; }
  else if (on && t !== "job") { hs = r * 3; ha = 0.7; glow = 0.32; ca = 1; }
  const dim = FX.focus && !FX.focus.has(id) ? 0.18 : 1;
  return { c, r, hs, ha: ha * dim, glow, ra: ra * dim, pa: pa * dim, fl: fl * dim, ca: ca * (dim < 1 ? 0.35 : 1), pulse: 0 };
}
function fxIntroScale(id) {
  if (!FX.intro) return 1;
  const k = (FX.now - FX.intro.t0 - [0.1, 0.5, 0.95, 1.3][ringOf(id)] - hashOf(id) * 0.35) / 0.8;
  if (k <= 0) return 0; if (k >= 1) return 1;
  const x = k - 1; return 1 + 2.70158 * x * x * x + 1.70158 * x * x; // ease-out-back
}
function fxApply(st, k) {
  const a = st.cur, b = st.tgt;
  for (let i = 0; i < 3; i++) a.c[i] += (b.c[i] - a.c[i]) * k;
  for (const p of ["r", "hs", "ha", "glow", "ra", "pa", "ca", "pulse", "fl"]) a[p] += (b[p] - a[p]) * k;
  const s = fxIntroScale(st.id), cu = st.core.material.uniforms, hu = st.halo.material.uniforms;
  st.core.scale.setScalar(Math.max(0.001, a.r * s));
  cu.uColor.value = a.c; cu.uAlpha.value = a.ca * Math.min(1, s * 1.5); cu.uGlow.value = a.glow;
  hu.uColor.value = a.c; hu.uSize.value = a.hs * s; hu.uAlpha.value = a.ha; hu.uPulse.value = a.pulse; hu.uFlare.value = a.fl;
  st.halo.visible = a.ha > 0.01 && s > 0.01;
  if (st.ring) {
    st.ring.scale.setScalar(a.r * s); st.ring.material.uniforms.uColor.value = fxMix(a.c, [1, 1, 1], 0.35); st.ring.material.uniforms.uAlpha.value = a.ra;
    st.ring.visible = a.ra > 0.01 && s > 0.01;
    const pu = st.pulse.material.uniforms; pu.uColor.value = a.c; pu.uSize.value = a.r * 6.5 * s; pu.uAlpha.value = a.pa; st.pulse.visible = a.pa > 0.01;
  }
}
/** Re-target every planet after the map's state changed (called from restyle). */
export function styleAll() { if (FX.on) Object.values(FX.nodes).forEach(st => { st.tgt = fxTarget(st.id); }); }

// the deep-space backdrop: gradient sky, twinkling stars, nebulae, glowing orbits
function fxBackdrop() {
  const K = FX.K, small = $("graph").clientWidth < 700, { RING, LIFT } = ctx;
  FX.bg = fxMesh(K.fsGeo, fxMat(FXS.bgV, FXS.bgF, { uAspect: { value: FX.aspect } }, { transparent: false, blending: 1, depthTest: false, depthWrite: false }));
  FX.bg.renderOrder = -1000; FX.bg.raycast = fxNoRay;
  const sky = new K.Obj3D();
  const stars = fxMesh(fxQuads(small ? 1400 : 2600, () => {
    const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, rad = 2600 + Math.random() * 1800, s = Math.sqrt(1 - u * u);
    return { pos: [rad * s * Math.cos(th), rad * u, rad * s * Math.sin(th)], attrs: { seed: Math.random(), size: 2.6 + Math.pow(Math.random(), 7) * 11 } };
  }), fxMat(FXS.starV, FXS.starF));
  sky.add(stars);
  [["#2b4aa8", -1500, 2600, 0.6, 1700, 0.17], ["#6a3fb0", -1300, 2600, 2.1, 1500, 0.15], ["#1f7f8a", -1700, 2700, 3.6, 1600, 0.15], ["#a8452a", -1200, 2500, 5.0, 1300, 0.08], ["#3c55c4", 900, 2900, 1.4, 1800, 0.13]].forEach(([hex, y, rad, ang, size, al], i) => {
    const m = fxMesh(FX.geo.quad, fxMat(FXS.bbV, FXS.nebF, { uColor: { value: fxLin(hex) }, uAlpha: { value: al }, uSize: { value: size }, uSeed: { value: i * 1.37 } }));
    m.position.set(Math.cos(ang) * rad, y, Math.sin(ang) * rad); m.renderOrder = -10; sky.add(m);
  });
  FX.sky = sky; [FX.bg, sky].forEach(o => { FX.scene.add(o); FX.objs.push(o); });
  for (let r = 1; r <= 3; r++) {
    // static, thin, faint guides
    const m = fxMesh(fxAnnulus(RING[r] - 0.5, RING[r] + 0.5, 256), fxMat(FXS.flatV, FXS.orbitF, { uColor: { value: fxLin("#7f93b8") }, uAlpha: { value: 0.2 } }, { side: 2 }));
    m.position.y = LIFT[r]; m.renderOrder = 1; FX.scene.add(m); FX.objs.push(m);
  }
  FX.beam = fxMesh(fxQuads(1), fxMat(FXS.beamV, FXS.beamF, { uColor: { value: fxLin("#ff8a4c") }, uAlpha: { value: 0 }, uH: { value: 150 }, uW: { value: 9 } }));
  // the beam's quad goes from the node upwards
  const cy = FX.beam.geometry.getAttribute("corner"); for (let i = 0; i < 4; i++) cy.setY(i, i < 2 ? 0 : 1); cy.needsUpdate = true;
  FX.beam.renderOrder = 5; FX.beam.raycast = fxNoRay; FX.scene.add(FX.beam); FX.objs.push(FX.beam);
}
function fxBloom() {
  const K = FX.K, comp = K.comp;
  const mk = (fs, u) => new K.SM({ uniforms: u, vertexShader: FXS.fsV, fragmentShader: fs, depthTest: false, depthWrite: false });
  const rt = () => comp.renderTarget1.clone(), A = rt(), B = rt(), C = rt(), D = rt();
  const mBright = mk(FXS.brightF, { tDiffuse: { value: null }, uThreshold: { value: 0.95 } }); // only the glowing few pass
  const mBlur = mk(FXS.blurF, { tDiffuse: { value: null }, uDir: { value: [0, 0] } });
  const mComp = mk(FXS.compF, { tDiffuse: { value: null }, tB1: { value: null }, tB2: { value: null }, uStrength: { value: 0.4 } });
  const quad = new K.Quad(mBright);
  let w = 1, h = 1;
  const pass = {
    enabled: true, needsSwap: true, clear: false, renderToScreen: false,
    setSize(W, H) { w = Math.max(1, W >> 1); h = Math.max(1, H >> 1); A.setSize(w, h); B.setSize(w, h); C.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1)); D.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1)); },
    render(renderer, writeBuffer, readBuffer) {
      const blur = (src, dst, dx, dy) => { mBlur.uniforms.tDiffuse.value = src.texture; mBlur.uniforms.uDir.value = [dx, dy]; quad.material = mBlur; renderer.setRenderTarget(dst); quad.render(renderer); };
      mBright.uniforms.tDiffuse.value = readBuffer.texture; quad.material = mBright; renderer.setRenderTarget(A); quad.render(renderer);
      blur(A, B, 1 / w, 0); blur(B, A, 0, 1 / h); blur(A, B, 2 / w, 0); blur(B, A, 0, 2 / h);
      const w2 = Math.max(1, w >> 1), h2 = Math.max(1, h >> 1);
      blur(A, C, 1 / w2, 0); blur(C, D, 0, 1 / h2); blur(D, C, 2.5 / w2, 0); blur(C, D, 0, 2.5 / h2);
      mComp.uniforms.tDiffuse.value = readBuffer.texture; mComp.uniforms.tB1.value = A.texture; mComp.uniforms.tB2.value = D.texture;
      quad.material = mComp; renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer); quad.render(renderer);
      if (!FX.bloomRan) { FX.bloomRan = true; FX.U.uEnc.value = 0; } // the composite now does the sRGB encoding
    },
    dispose() { [A, B, C, D].forEach(r => r.dispose()); [mBright, mBlur, mComp].forEach(m => m.dispose()); }
  };
  comp.addPass(pass);
  return pass;
}


/** Turn the layer on. c = { Graph, RING, LIFT, posOf, visible(), nColor, nVal, onPlan, restyle, setRotate, scanning() } */
export function init(c) {
  ctx = c; Graph = c.Graph;
  if (FX.on || !Graph) return;
  try {
    const K = fxKit(); if (!K) return;
    FX.K = K; FX.scene = Graph.scene();
    const cam = Graph.camera(); if (cam.far < 30000) { cam.far = 30000; cam.updateProjectionMatrix(); }
    const rr = Graph.renderer(), pr = Math.min(window.devicePixelRatio || 1, 1.75);
    if (rr.getPixelRatio && rr.getPixelRatio() > pr) { rr.setPixelRatio(pr); if (K.comp.setPixelRatio) K.comp.setPixelRatio(pr); }
    FX.aspect = $("graph").clientWidth / Math.max(1, $("graph").clientHeight);
    FX.geo = { sphere: fxSphere(28), quad: fxQuads(1), annulus: fxAnnulus(1.55, 2.45, 96), flat: fxGeo({ position: [[-1, 0, -1, 1, 0, -1, 1, 0, 1, -1, 0, 1], 3], uv: [[0, 0, 1, 0, 1, 1, 0, 1], 2] }, [0, 2, 1, 0, 3, 2]) };
    fxBackdrop();
    FX.on = true;
    Graph.nodeThreeObject(n => fxNode(n)).linkDirectionalParticleWidth(3.2);
    try { FX.bloom = fxBloom(); } catch (e) { FX.bloom = null; }
    $("stars").style.display = "none"; $("stage").classList.add("fx");
    ctx.restyle();
    if (FX.introPending) intro();
    setTimeout(fxHealth, 1500); setTimeout(fxHealth, 5000);
  } catch (e) { fxDisable(e); }
}
// If the GPU refused a shader, or the library never ran our bloom pass, fall back quietly.
function fxHealth() {
  if (!FX.on) return;
  try {
    const progs = (Graph.renderer().info && Graph.renderer().info.programs) || [];
    if (progs.some(p => p.diagnostics && p.diagnostics.runnable === false)) return fxDisable("shader error");
    if (FX.bloom && !FX.bloomRan) { const ps = FX.K.comp.passes, i = ps.indexOf(FX.bloom); if (i >= 0) ps.splice(i, 1); FX.bloom = null; FX.U.uEnc.value = 1; }
  } catch (e) { /* keep going */ }
}
function fxDisable(why) {
  try {
    console.warn("HalaTuju: cinematic layer turned off.", why || "");
    FX.objs.concat(FX.waves.map(w => w.m)).forEach(o => FX.scene && FX.scene.remove(o)); FX.objs = []; FX.waves = [];
    if (FX.bloom && FX.K) { const ps = FX.K.comp.passes, i = ps.indexOf(FX.bloom); if (i >= 0) ps.splice(i, 1); }
    const was = FX.on; FX.on = false; FX.bloom = null; FX.nodes = {}; FX.U.uEnc.value = 1;
    if (was && Graph) { Graph.nodeThreeObject(null); $("stars").style.display = ""; $("stage").classList.remove("fx"); ctx.restyle(); }
  } catch (e) { /* nothing else to undo */ }
}
/** Camera swoop with the planets popping in ring by ring (after onboarding). */
export function intro() {
  if (!FX.on) { FX.introPending = true; return; }
  FX.introPending = false;
  if (reduce || !Graph) return;
  FX.intro = { t0: performance.now() / 1000 };
  const d = $("graph").clientWidth < 700 ? 1.85 : 1.5, was = UI.rotating;
  if (was) ctx.setRotate(false);
  Graph.cameraPosition({ x: 300, y: 1500 * d, z: 1900 * d }, { x: 0, y: 10, z: 0 }, 0);
  setTimeout(() => { Graph.cameraPosition({ x: 0, y: 440 * d, z: 420 * d }, { x: 0, y: 10, z: 0 }, 2600); setTimeout(() => { if (was && !UI.rotating) ctx.setRotate(true); }, 2700); }, 60);
  setTimeout(() => wave(S.E?.root, "#f4f6fa", 2.2, 760), 250);
}
/** A shock-wave ring spreading out from a node. */
export function wave(id, hex, dur, size) {
  if (!FX.on || reduce || !id || !ctx.visible().has(id)) return;
  const p = ctx.posOf(id); if (!p) return;
  const m = fxMesh(FX.geo.flat, fxMat(FXS.flatV, FXS.waveF, { uColor: { value: fxLin(hex) }, uProg: { value: 0 } }, { side: 2 }));
  m.position.set(p.x, p.y + 1, p.z); m.scale.setScalar(size / 2); m.renderOrder = 4; m.raycast = fxNoRay;
  FX.scene.add(m); FX.waves.push({ m, t0: performance.now() / 1000, dur });
}
/** Hovering a node dims everything that isn't connected to it. */
export function focus(id) {
  if (!FX.on) return;
  const key = id && ctx.visible().has(id) ? id : null;
  if (key === FX.focusId) return;
  FX.focusId = key;
  const g = S.graph;
  FX.focus = key ? new Set([key, S.E.root, ...g.edges.filter(e => e.from === key || e.to === key).flatMap(e => [e.from, e.to]), ...(g.req[key] || []).map(r => r.skill)]) : null;
  ctx.restyle();
}
export function setAspect(a) { FX.aspect = a; }
export function tick(dt) {
  if (!FX.on) return;
  FX.now = performance.now() / 1000; FX.U.uTime.value += dt * FX.speed;
  if (FX.intro && FX.now - FX.intro.t0 > 3.4) FX.intro = null;
  const k = 1 - Math.pow(0.002, dt);
  for (const id in FX.nodes) fxApply(FX.nodes[id], k);
  const b = FX.beam, p = UI.job && ctx.visible().has(UI.job) ? ctx.posOf(UI.job) : null, bu = b.material.uniforms;
  if (p) b.position.set(p.x, p.y, p.z);
  bu.uAlpha.value += ((p ? 0.45 : 0) * (UI.job ? fxIntroScale(UI.job) : 1) - bu.uAlpha.value) * k; b.visible = bu.uAlpha.value > 0.01;
  FX.waves = FX.waves.filter(w => {
    const q = Math.min(1, (FX.now - w.t0) / w.dur); w.m.material.uniforms.uProg.value = 1 - Math.pow(1 - q, 2.2);
    if (q >= 1) { FX.scene.remove(w.m); w.m.material.dispose(); return false; }
    return true;
  });
  if (ctx.scanning() && FX.now - FX.lastWave > 0.7) { FX.lastWave = FX.now; wave(S.E?.root, "#4a93ea", 1.3, 420); }
  if (FX.sky) FX.sky.rotation.y += dt * 0.006 * FX.speed;
  if (FX.bg) FX.bg.material.uniforms.uAspect.value = FX.aspect;
}
