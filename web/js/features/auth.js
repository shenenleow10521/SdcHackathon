// Accounts (Supabase Auth): email + password, or the demo without an account.
// Only active when the server says accounts are on (GET /api/config); otherwise the app is an open demo as before.
// The Supabase client is loaded on demand from jsdelivr at a pinned version. The server checks the token on every
// request; this module only keeps it fresh (api.js sends it) and draws the sign-in and "Delete my data" screens.
import { get, del, setAuthToken, hasAdminToken } from "../api.js";
import { t } from "../i18n.js";
import { $, esc, icons, store } from "../util.js";

const SUPABASE_JS = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/+esm";

// staffOpen: without accounts, whether the server's staff routes are open (no ADMIN_TOKEN); app.js checks it at boot.
export const AUTH = { enabled: false, client: null, user: null, roles: [], profileId: null, staffOpen: false };
const V = { mode: "signin", note: null, msg: null, busy: false, view: "auth" };
let onChange = () => {}, onDemo = () => {}, lastFocus = null;

/** handlers.onChange(): the signed-in user changed. handlers.onDemo(): the visitor chose the demo. */
export async function initAuth(handlers) {
  onChange = handlers.onChange || onChange;
  onDemo = handlers.onDemo || onDemo;
  let cfg;
  try { cfg = await get("/config"); } catch { return AUTH; }
  if (!cfg?.auth?.enabled) return AUTH;
  try {
    const { createClient } = await import(SUPABASE_JS);
    AUTH.client = createClient(cfg.auth.url, cfg.auth.anonKey, { auth: { flowType: "pkce", detectSessionInUrl: true, persistSession: true, autoRefreshToken: true } });
  } catch (e) { console.warn("Accounts unavailable", e); return AUTH; }
  AUTH.enabled = true;
  const { data } = await AUTH.client.auth.getSession();
  // An email confirmation link returns with ?code=…; the client has used it, so tidy the address bar.
  if (new URLSearchParams(location.search).has("code")) history.replaceState(null, "", location.pathname + location.hash);
  await applySession(data.session);
  AUTH.client.auth.onAuthStateChange((_event, session) => {
    setAuthToken(session?.access_token || null);
    // Don't call Supabase from inside this callback; react on the next tick.
    if ((session?.user?.id || null) !== (AUTH.user?.id || null)) setTimeout(() => applySession(session).then(() => onChange()), 0);
  });
  return AUTH;
}

async function applySession(session) {
  setAuthToken(session?.access_token || null);
  AUTH.user = null; AUTH.roles = []; AUTH.profileId = null;
  if (!session) return;
  try {
    const me = await get("/me");
    AUTH.user = me.user; AUTH.roles = me.roles || []; AUTH.profileId = me.profileId ?? null;
  } catch (e) {
    console.warn("Couldn't load the signed-in user", e);
    if (e.status === 401) { setAuthToken(null); await AUTH.client.auth.signOut().catch(() => {}); }
  }
}

export const signedIn = () => !!AUTH.user;
/** UI only (the server checks every staff route): may this visitor see staff views? */
export const hasRole = r => AUTH.enabled ? AUTH.roles.includes(r) : AUTH.staffOpen || hasAdminToken();
export const signOut = () => AUTH.client?.auth.signOut();

// ---------- screens ----------
export function openAuth(note = null) {
  if (!AUTH.enabled) return;
  if ($("auth").hidden) lastFocus = document.activeElement;
  Object.assign(V, { view: "auth", note, msg: null, busy: false });
  $("auth").hidden = false;
  render();
  setTimeout(() => $("auth-demo")?.focus(), 30);
}
export function openDeleteData() {
  lastFocus = document.activeElement;
  Object.assign(V, { view: "delete", msg: null, busy: false });
  $("auth").hidden = false;
  render();
  setTimeout(() => $("del-cancel")?.focus(), 30);
}
export function closeAuth() {
  $("auth").hidden = true;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}


function render() {
  const c = $("auth-card");
  const msg = V.msg ? `<div class="state-box ${V.msg.err ? "err" : ""}" role="${V.msg.err ? "alert" : "status"}"><span>${esc(V.msg.text)}</span></div>` : "";
  if (V.view === "delete") {
    c.innerHTML = `<div class="ob-top"><div><div class="ob-kicker">${esc(t("del.kicker"))}</div><h2 id="auth-title">${esc(t("del.title"))}</h2><p>${esc(t("del.body"))}</p></div></div>
      <div class="ob-body">${msg}</div>
      <div class="ob-foot"><button class="ghost" id="del-cancel" type="button">${esc(t("common.cancel"))}</button>
        <button class="btn btn-danger" id="del-go" type="button" ${V.busy ? "disabled" : ""}>${V.busy ? '<span class="spin"></span>' : '<i data-lucide="trash-2"></i>'}${esc(t("del.confirm"))}</button></div>`;
    icons();
    c.querySelector("#del-cancel").addEventListener("click", closeAuth);
    c.querySelector("#del-go").addEventListener("click", deleteData);
    return;
  }
  const up = V.mode === "signup";
  c.innerHTML = `<div class="ob-top"><button class="icon-btn ob-x" type="button" id="auth-close" aria-label="${esc(t("common.close"))}"><i data-lucide="x"></i></button>
      <div><div class="ob-kicker">${esc(t("auth.kicker"))}</div><h2 id="auth-title">${esc(t(up ? "auth.titleUp" : "auth.title"))}</h2><p>${esc(t("auth.intro"))}</p></div></div>
    <div class="ob-body">
      ${V.note ? `<p class="note">${esc(V.note)}</p>` : ""}
      <button class="btn btn-primary auth-wide" id="auth-demo" type="button"><i data-lucide="user-round"></i>${esc(t("auth.demo"))}</button>
      <p class="rs auth-center">${esc(t("auth.demoNote"))}</p>
      <div class="auth-or"><span>${esc(t("auth.or"))}</span></div>
      <form class="auth-form" id="auth-form" novalidate>
        <label>${esc(t("auth.email"))}<input name="email" type="email" autocomplete="email" required maxlength="200"></label>
        <label>${esc(t("auth.password"))}<input name="password" type="password" autocomplete="${up ? "new-password" : "current-password"}" required minlength="${up ? 8 : 1}" maxlength="200"></label>
        ${msg}
        <button class="btn btn-soft auth-wide" type="submit" ${V.busy ? "disabled" : ""}>${V.busy ? '<span class="spin"></span>' : ""}${esc(t(up ? "auth.signup" : "auth.signin"))}</button>
      </form>
      <button class="linkish" id="auth-mode" type="button">${esc(t(up ? "auth.toSignin" : "auth.toSignup"))}</button>
    </div>
    <div class="ob-foot"><span class="left"><i data-lucide="lock"></i>${esc(t("auth.privacy"))}</span></div>`;
  icons();
  c.querySelector("#auth-close").addEventListener("click", chooseDemo);
  c.querySelector("#auth-demo").addEventListener("click", chooseDemo);
  c.querySelector("#auth-mode").addEventListener("click", () => { V.mode = up ? "signin" : "signup"; V.msg = null; render(); });
  c.querySelector("#auth-form").addEventListener("submit", submit);
}

function chooseDemo() {
  store.set("authChoice", "demo");
  closeAuth();
  onDemo();
}

async function submit(ev) {
  ev.preventDefault();
  const f = ev.target, email = f.email.value.trim(), password = f.password.value;
  const up = V.mode === "signup";
  if (!email || !password) { V.msg = { err: true, text: `${t("auth.failed")}: ${t("auth.email")} / ${t("auth.password")}` }; render(); return; }
  if (up && password.length < 8) { V.msg = { err: true, text: t("auth.shortPassword") }; render(); $("auth-form").email.value = email; return; }
  V.busy = true; V.msg = null; render();
  const res = up
    ? await AUTH.client.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } })
    : await AUTH.client.auth.signInWithPassword({ email, password });
  V.busy = false;
  if (res.error) { V.msg = { err: true, text: `${t("auth.failed")}: ${res.error.message}` }; render(); $("auth-form").email.value = email; return; }
  if (up && !res.data.session) { V.mode = "signin"; V.msg = { err: false, text: t("auth.checkEmail") }; render(); $("auth-form").email.value = email; return; }
  // Signed in: onAuthStateChange loads the account and the app closes this screen.
}

async function deleteData() {
  V.busy = true; V.msg = null; render();
  try {
    const out = await del("/me/data");
    AUTH.profileId = null;
    closeAuth();
    onChange({ deleted: out.deleted });
  } catch (e) {
    V.busy = false; V.msg = { err: true, text: e.message }; render();
  }
}

export function initAuthScreen() {
  $("auth").addEventListener("keydown", e => {
    if (e.key === "Escape") { e.preventDefault(); if (V.view === "delete") closeAuth(); else chooseDemo(); return; }
    if (e.key !== "Tab") return;
    const f = [...$("auth-card").querySelectorAll("button:not([disabled]), input")].filter(x => x.offsetParent !== null);
    if (!f.length) return;
    if (e.shiftKey && document.activeElement === f[0]) { e.preventDefault(); f[f.length - 1].focus(); }
    else if (!e.shiftKey && document.activeElement === f[f.length - 1]) { e.preventDefault(); f[0].focus(); }
  });
}
