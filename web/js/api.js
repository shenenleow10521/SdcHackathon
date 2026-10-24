// One fetch wrapper for every /api call.
// - JSON in and out, with a timeout.
// - Errors always become an ApiError { status, code, message, details } (the server's { error: {code, message} } shape).
// - Callers decide how to degrade: err.notAvailable means "this feature isn't built / switched on yet",
//   err.offline means "couldn't reach the server" (show a retry). Nothing here touches the DOM.

const BASE = "/api";
const TOKEN_KEY = "halatuju.adminToken";

let fetchImpl = (...a) => globalThis.fetch(...a);
/** Swap the fetch function (tests). */
export function setFetch(fn) { fetchImpl = fn; }

let adminToken = null;
try { adminToken = globalThis.sessionStorage?.getItem(TOKEN_KEY) || null; } catch { /* storage blocked */ }
export function setAdminToken(t) {
  adminToken = t || null;
  try { if (t) globalThis.sessionStorage?.setItem(TOKEN_KEY, t); else globalThis.sessionStorage?.removeItem(TOKEN_KEY); } catch { /* ignore */ }
}
export const hasAdminToken = () => !!adminToken;

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message || "Request failed");
    this.name = "ApiError";
    this.status = status;
    this.code = code || "error";
    this.details = details;
  }
  /** The endpoint doesn't exist yet or the feature is switched off. */
  get notAvailable() { return this.code === "not_available" || this.status === 501; }
  /** Network failure, timeout or a server-side failure: worth a retry. */
  get offline() { return this.status === 0 || (this.status >= 500 && this.status !== 501); }
  /** Needs the admin token. */
  get needsAuth() { return this.status === 401 || this.status === 403; }
}

const CODE_BY_STATUS = { 400: "bad_request", 401: "unauthorized", 403: "forbidden", 404: "not_found", 409: "conflict", 413: "too_large", 429: "rate_limited", 501: "not_available", 503: "unavailable" };

/** Build a query string, skipping empty values. */
export function qs(params) {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params || {})) if (v !== undefined && v !== null && v !== "") u.set(k, String(v));
  const s = u.toString();
  return s ? "?" + s : "";
}

/**
 * @param {string} path e.g. "/graph"
 * @param {{ method?: string, body?: any, form?: FormData, timeout?: number }} [opts]
 */
export async function api(path, opts = {}) {
  const { method = "GET", body, form, timeout = 15000 } = opts;
  const ctrl = typeof AbortController === "function" ? new AbortController() : null;
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl?.abort(); }, timeout);
  const headers = { Accept: "application/json" };
  if (adminToken) headers["x-admin-token"] = adminToken;
  let payload;
  if (form) payload = form;
  else if (body !== undefined) { headers["Content-Type"] = "application/json"; payload = JSON.stringify(body); }

  let res;
  try {
    res = await fetchImpl(BASE + path, { method, headers, body: payload, signal: ctrl?.signal });
  } catch (e) {
    clearTimeout(timer);
    throw timedOut
      ? new ApiError(0, "timeout", "The server took too long to answer")
      : new ApiError(0, "network", "Couldn't reach the server");
  }
  clearTimeout(timer);

  let data = null, text = "";
  try { text = await res.text(); } catch { text = ""; }
  if (text) { try { data = JSON.parse(text); } catch { data = null; } }

  if (!res.ok) {
    const e = data && typeof data === "object" ? data.error : null;
    let code = (e && e.code) || CODE_BY_STATUS[res.status] || (res.status >= 500 ? "server_error" : "error");
    const message = (e && e.message) || res.statusText || "Request failed";
    // The API's catch-all 404 means the route isn't built yet, not "record not found".
    if (res.status === 404 && /^No API route/i.test(message)) code = "not_available";
    if (res.status === 501) code = "not_available";
    throw new ApiError(res.status, code, message, e && e.details);
  }
  if (data === null || typeof data !== "object") throw new ApiError(res.status, "bad_response", "The server sent an unexpected response");
  return data;
}

export const get = (path, params, opts) => api(path + qs(params), opts);
export const post = (path, body, opts) => api(path, { ...opts, method: "POST", body: body ?? {} });
export const put = (path, body, opts) => api(path, { ...opts, method: "PUT", body: body ?? {} });
export const upload = (path, form, opts) => api(path, { ...opts, method: "POST", form });
export const del = (path, opts) => api(path, { ...opts, method: "DELETE" });
