// Accounts (Replit-managed Clerk). When Clerk is configured, verified Clerk sessions
// populate req.user. Roles come from the ADMIN_EMAILS / ADVISOR_EMAILS allow-lists.
// - profileGuard: any request that names a profile (path, ?profile=, body profileId, or a plan id) must come from
//   that profile's owner. The shared demo persona stays open to everyone; staff may read any profile.
// - intakeGuard: a new profile from CV intake needs a signed-in user and is linked to them
//   (one profile per account: a new intake replaces the old profile).
import type { Request, Response, NextFunction } from "express";
import { clerkClient, getAuth } from "@clerk/express";
import type { Services, Config } from "../context.ts";
import type { Db } from "./db.ts";
import { HttpError } from "./http.ts";
import { guestOwnerId } from "../middlewares/guestSession.ts";

export type Role = "admin" | "advisor";
export interface AuthUser { id: string; email: string | null; roles: Role[] }
/** Optional injected verifier used by auth tests; production sessions are verified by Clerk middleware. */
export type AuthVerifier = (token: string) => Promise<{ id: string; email: string | null } | null>;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express { interface Request { user?: AuthUser } }
}

const authEnabled = (svc: Services) => svc.config.clerkEnabled || !!svc.auth;
const CLERK_USER_CACHE_MS = 60_000;
const clerkUserCache = new Map<string, { email: string | null; expires: number }>();

async function clerkEmail(userId: string): Promise<string | null> {
  const now = Date.now(), cached = clerkUserCache.get(userId);
  if (cached && cached.expires > now) return cached.email;
  try {
    const user = await clerkClient.users.getUser(userId);
    const email = user.primaryEmailAddress?.emailAddress?.toLowerCase() || null;
    if (clerkUserCache.size > 1000) for (const [id, value] of clerkUserCache) if (value.expires <= now) clerkUserCache.delete(id);
    clerkUserCache.set(userId, { email, expires: now + CLERK_USER_CACHE_MS });
    return email;
  } catch {
    throw new HttpError(503, "auth_unavailable", "Couldn't check your sign-in right now. Please try again.");
  }
}

export function rolesFor(email: string | null, config: Pick<Config, "adminEmails" | "advisorEmails">): Role[] {
  if (!email) return [];
  const e = email.toLowerCase();
  if (config.adminEmails.includes(e)) return ["admin", "advisor"];
  if (config.advisorEmails.includes(e)) return ["advisor"];
  return [];
}

const hasAdminToken = (svc: Services, req: Request) => !!svc.config.adminToken && req.get("x-admin-token") === svc.config.adminToken;

/** Sets req.user from the verified Clerk session. The injected verifier is used only by tests. */
export function authenticate(svc: Services) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      if (!authEnabled(svc)) return next();
      let u: { id: string; email: string | null } | null = null;
      if (svc.auth) {
        const m = /^Bearer\s+(\S+)$/i.exec(req.get("authorization") || "");
        if (!m) return next();
        u = await svc.auth(m[1]);
        if (!u) return next(new HttpError(401, "invalid_session", "Your sign-in has expired. Please sign in again."));
      } else {
        const { userId } = getAuth(req);
        if (!userId) return next();
        u = { id: userId, email: await clerkEmail(userId) };
      }
      req.user = { ...u, roles: rolesFor(u.email, svc.config) };
      next();
    } catch (e) { next(e); }
  };
}

/** Throws unless this request may read (or write) the profile. Missing profiles pass, so the route answers 404. */
export async function assertProfileAccess(svc: Services, req: Request, profileId: number, write: boolean) {
  if (!authEnabled(svc)) return;
  const row = (await svc.db.query<{ is_demo: boolean; auth_user_id: string | null }>("select is_demo, auth_user_id from profiles where id=$1", [profileId])).rows[0];
  if (!row || row.is_demo) return;
  if (req.user && row.auth_user_id === req.user.id) return;
  if (req.guestSessionId && row.auth_user_id === guestOwnerId(req.guestSessionId)) return;
  if (!write && req.user?.roles.length) return;
  if (hasAdminToken(svc, req)) return;
  if (!req.user) throw new HttpError(401, "sign_in_required", "Sign in to open your profile, or try the demo.");
  throw new HttpError(403, "forbidden", "This profile belongs to another account.");
}

const PROFILE_PATH = /^\/(?:esco\/)?profile\/(\d+)(?:\/|$)/;
const PLAN_PATH = /^\/plans\/(\d+)\/(?:send|route-update)$/;
const posInt = (v: unknown) => { const n = typeof v === "string" && /^\d+$/.test(v) ? Number(v) : v; return Number.isInteger(n) && (n as number) > 0 ? (n as number) : null; };

/** Ownership check for every request that names a profile (see the header comment). */
export function profileGuard(svc: Services) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    if (!authEnabled(svc)) return next();
    try {
      const write = req.method !== "GET" && req.method !== "HEAD";
      const ids = new Set<number>();
      const m = PROFILE_PATH.exec(req.path);
      if (m) ids.add(Number(m[1]));
      const q = posInt(req.query?.profile); if (q) ids.add(q);
      const b = posInt(req.body?.profileId); if (b) ids.add(b);
      const pm = PLAN_PATH.exec(req.path);
      if (pm) {
        const row = (await svc.db.query<{ profile_id: number }>("select profile_id from plans where id=$1", [Number(pm[1])])).rows[0];
        if (row) ids.add(row.profile_id);
      }
      for (const id of ids) await assertProfileAccess(svc, req, id, write);
      next();
    } catch (e) { next(e); }
  };
}

/** Link a new profile to its account. An older profile of the same account is deleted with everything linked to it. */
export async function claimProfile(db: Db, userId: string, profileId: number) {
  await db.tx(async t => {
    const old = (await t.query<{ id: number }>("select id from profiles where auth_user_id=$1 and id<>$2", [userId, profileId])).rows;
    for (const o of old) await deleteProfileData(t, o.id);
    await t.query("update profiles set auth_user_id=$1 where id=$2 and auth_user_id is null", [userId, profileId]);
  });
}

/** Delete a profile and everything linked to it: skills, ESCO skills, plans, snapshots (FK cascade) and its audit entries. */
export async function deleteProfileData(db: Db, profileId: number) {
  const plans = (await db.query<{ id: number }>("select id from plans where profile_id=$1", [profileId])).rows.map(r => `plan:${r.id}`);
  await db.query("delete from audit_log where actor=$1 or target=$2 or target like $3 or target = any($4::text[])",
    [`user:${profileId}`, String(profileId), `${profileId}:%`, plans]);
  const r = await db.query("delete from profiles where id=$1 and is_demo=false returning id", [profileId]);
  return { profileId, deleted: r.rows.length > 0, plans: plans.length };
}

/** CV intake needs an account when auth is on; the new profile is linked to it before the reply is sent. */
export function intakeGuard(svc: Services) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!authEnabled(svc) || req.method !== "POST" || req.path !== "/profile/intake") return next();
    const ownerId = req.user?.id || (req.guestSessionId ? guestOwnerId(req.guestSessionId) : null);
    if (!ownerId) return next(new HttpError(401, "guest_session_unavailable", "Your guest session couldn't be started. Please sign in and try again."));
    const json = res.json.bind(res);
    res.json = ((body: any) => {
      if (res.statusCode !== 201 || !Number.isInteger(body?.profileId)) return json(body);
      claimProfile(svc.db, ownerId, body.profileId).then(() => json(body), err => next(err));
      return res;
    }) as typeof res.json;
    next();
  };
}
