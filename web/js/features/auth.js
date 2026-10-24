// Replit-managed Clerk accounts. Sessions stay in Clerk's same-origin cookies;
// the server verifies them and owns every profile/role decision.
import { get, del, hasAdminToken } from "../api.js";
import { t } from "../i18n.js";
import { $, esc, icons, store } from "../util.js";

const CLERK_SCRIPT = "/vendor/clerk/clerk.browser.js";
const CLERK_UI_SCRIPT = "/vendor/clerk-ui/ui.browser.js";
const V = { msg: null, busy: false, view: "auth" };

export const AUTH = { enabled: false, client: null, user: null, roles: [], profileId: null, guestProfileId: null, staffOpen: false };
let onChange = () => {}, onDemo = () => {}, onGuest = () => {}, lastFocus = null, mountedNode = null;

let clerkSdkPromise;
function loadClerkSdk(publishableKey, proxyUrl) {
  if (globalThis.Clerk?.load) return Promise.resolve(globalThis.Clerk);
  if (clerkSdkPromise) return clerkSdkPromise;
  clerkSdkPromise = loadScript(CLERK_UI_SCRIPT).then(() => new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const loaded = () => globalThis.Clerk ? resolve(globalThis.Clerk) : reject(new Error("Clerk browser SDK did not load"));
    script.addEventListener("load", loaded, { once: true });
    script.addEventListener("error", () => reject(new Error("Couldn't load the sign-in service")), { once: true });
    script.dataset.clerkPublishableKey = publishableKey;
    if (proxyUrl) script.dataset.clerkProxyUrl = proxyUrl;
    script.src = CLERK_SCRIPT;
    script.async = true;
    document.head.append(script);
  }));
  return clerkSdkPromise;
}

/** Clerk's sign-in screens (@clerk/ui); without them mountSignIn fails with "not loaded with Ui components". */
function loadScript(src) {
  if (globalThis.__internal_ClerkUICtor) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.addEventListener("load", () => resolve(), { once: true });
    s.addEventListener("error", () => reject(new Error("Couldn't load the sign-in service")), { once: true });
    s.src = src;
    s.async = true;
    document.head.append(s);
  });
}

const appearance = {
  variables: {
    colorPrimary: "#2879dc",
    colorForeground: "#172033",
    colorMutedForeground: "#64748b",
    colorBackground: "#ffffff",
    colorInput: "#f7f9fc",
    colorInputForeground: "#172033",
    colorDanger: "#c83b45",
    colorNeutral: "#d7dee8",
    fontFamily: 'Geist, ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif',
    borderRadius: "0.7rem",
  },
  elements: {
    rootBox: "w-full",
    cardBox: "w-full max-w-full",
    card: "shadow-none border-0",
    headerTitle: "font-semibold",
    headerSubtitle: "text-slate-600",
    formFieldLabel: "text-slate-700",
    formFieldInput: "rounded-lg",
    formButtonPrimary: "rounded-lg",
    footerActionLink: "font-semibold",
    footerActionText: "text-slate-600",
  },
};

export async function initAuth(handlers) {
  onChange = handlers.onChange || onChange;
  onDemo = handlers.onDemo || onDemo;
  onGuest = handlers.onGuest || onGuest;
  let cfg;
  try { cfg = await get("/config"); } catch { return AUTH; }
  if (!cfg?.auth?.enabled) return AUTH;

  AUTH.client = await loadClerkSdk(cfg.auth.publishableKey, cfg.auth.proxyUrl);
  await AUTH.client.load({ ui: { ClerkUI: globalThis.__internal_ClerkUICtor } });
  AUTH.enabled = true;

  await applySession(AUTH.client.user);
  let previousUserId = AUTH.client.user?.id || null;
  AUTH.client.addListener(({ user }) => {
    const nextUserId = user?.id || null;
    if (nextUserId === previousUserId) return;
    previousUserId = nextUserId;
    void applySession(user).then(() => onChange()).catch(e => console.warn("Couldn't load the signed-in account", e));
  });
  return AUTH;
}

async function applySession(clerkUser) {
  AUTH.user = null; AUTH.roles = []; AUTH.profileId = null;
  const me = await get("/me");
  if (clerkUser && me.user?.id !== clerkUser.id) throw new Error("Clerk session and application account did not match");
  AUTH.user = clerkUser ? me.user : null;
  AUTH.roles = clerkUser ? (me.roles || []) : [];
  AUTH.profileId = me.profileId ?? null;
  AUTH.guestProfileId = me.guestProfileId ?? null;
}

export const signedIn = () => !!AUTH.user;
/** UI only (the server checks every staff route): may this visitor see staff views? */
export const hasRole = r => AUTH.enabled ? AUTH.roles.includes(r) : AUTH.staffOpen || hasAdminToken();
export const signOut = () => AUTH.client?.signOut({ redirectUrl: location.pathname });

// ---------- screens ----------
export function openAuth(note = null) {
  if (!AUTH.enabled) return;
  if ($("auth").hidden) lastFocus = document.activeElement;
  Object.assign(V, { view: "auth", note, msg: null, busy: false });
  $("auth").hidden = false;
  render();
  setTimeout(() => $("auth-guest")?.focus(), 30);
}
export function openDeleteData() {
  lastFocus = document.activeElement;
  Object.assign(V, { view: "delete", msg: null, busy: false });
  $("auth").hidden = false;
  render();
  setTimeout(() => $("del-cancel")?.focus(), 30);
}
export function closeAuth() {
  if (mountedNode && AUTH.client) {
    AUTH.client.unmountSignIn(mountedNode);
    mountedNode = null;
  }
  $("auth").hidden = true;
  if (lastFocus && document.contains(lastFocus)) lastFocus.focus();
}

function mountSignIn() {
  const node = $("clerk-signin");
  if (!node || !AUTH.client || mountedNode === node) return;
  if (mountedNode) AUTH.client.unmountSignIn(mountedNode);
  try {
    AUTH.client.mountSignIn(node, {
      routing: "virtual",
      signUpUrl: location.pathname,
      afterSignInUrl: location.pathname,
      afterSignUpUrl: location.pathname,
      appearance,
      localization: store.get("lang", "en") === "ms"
        ? { signIn: { start: { title: "Selamat kembali", subtitle: "Log masuk untuk membuka akaun anda" } }, signUp: { start: { title: "Cipta akaun", subtitle: "Mulakan perjalanan kerjaya anda" } } }
        : { signIn: { start: { title: "Welcome back", subtitle: "Sign in to access your account" } }, signUp: { start: { title: "Create your account", subtitle: "Get started with your career plan" } } },
    });
    mountedNode = node;
  } catch (e) {
    console.error("Couldn't show the sign-in form", e);
    V.msg = { err: true, text: e?.message || "The sign-in form could not be loaded." };
    render();
  }
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
  c.innerHTML = `<div class="ob-top"><button class="icon-btn ob-x" type="button" id="auth-close" aria-label="${esc(t("common.close"))}"><i data-lucide="x"></i></button>
      <div><div class="ob-kicker">${esc(t("auth.kicker"))}</div><h2 id="auth-title">${esc(t("auth.title"))}</h2><p>${esc(t("auth.intro"))}</p></div></div>
    <div class="ob-body">
      ${V.note ? `<p class="note">${esc(V.note)}</p>` : ""}
      <button class="btn btn-primary auth-wide" id="auth-guest" type="button"><i data-lucide="upload"></i>${esc(t("auth.guest"))}</button>
      <p class="rs auth-center">${esc(t("auth.guestNote"))}</p>
      <button class="ghost auth-wide" id="auth-demo" type="button"><i data-lucide="user-round"></i>${esc(t("auth.demo"))}</button>
      <p class="rs auth-center">${esc(t("auth.demoNote"))}</p>
      <div class="auth-or"><span>${esc(t("auth.or"))}</span></div>
      ${msg}
      <div class="clerk-signin" id="clerk-signin" aria-label="${esc(t("auth.signin"))}"></div>
    </div>
    <div class="ob-foot"><span class="left"><i data-lucide="lock"></i>${esc(t("auth.privacy"))}</span></div>`;
  icons();
  c.querySelector("#auth-close").addEventListener("click", chooseDemo);
  c.querySelector("#auth-demo").addEventListener("click", chooseDemo);
  c.querySelector("#auth-guest").addEventListener("click", chooseGuest);
  setTimeout(mountSignIn, 0);
}

function chooseGuest() {
  store.set("authChoice", "guest");
  closeAuth();
  onGuest();
}

function chooseDemo() {
  store.set("authChoice", "demo");
  closeAuth();
  onDemo();
}

async function deleteData() {
  V.busy = true; V.msg = null; render();
  try {
    const out = await del("/me/data");
    AUTH.profileId = null; AUTH.guestProfileId = null;
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
