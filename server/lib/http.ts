// Small HTTP helpers shared by all routes.
import type { Request, Response, NextFunction } from "express";
import { z } from "zod";
import type { Services } from "../context.ts";

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}
export const badRequest = (msg: string, details?: unknown) => new HttpError(400, "bad_request", msg, details);
export const notFound = (what: string) => new HttpError(404, "not_found", `${what} not found`);

/** Parse and validate input with zod; throws a 400 with the issues on failure. */
export function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw badRequest("Invalid input", r.error.issues.map(i => ({ path: i.path.join("."), message: i.message })));
  return r.data;
}

/** Common query parameters: ?profile=&year=&scenario=&mode= */
export const scenarioQuery = z.object({
  profile: z.coerce.number().int().positive().default(1),
  year: z.coerce.number().int().min(2026).max(2030).default(2026),
  scenario: z.enum(["moderate", "fast"]).default("moderate"),
  mode: z.enum(["fastest", "noregret", "safest"]).default("fastest"),
});

/**
 * Staff-only routes. Open when neither accounts nor ADMIN_TOKEN are set (local demo).
 * Otherwise: the x-admin-token header (scripts, tests) or a signed-in user with the role (admin also counts as advisor).
 */
export function requireRole(svc: Services, role: "admin" | "advisor") {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = svc.config.adminToken;
    if (token && req.get("x-admin-token") === token) return next();
    if (req.user?.roles.includes(role)) return next();
    if (!svc.auth && !token) return next();
    if (!svc.auth) return next(new HttpError(401, "unauthorized", "Admin token required"));
    if (!req.user) return next(new HttpError(401, "unauthorized", `Sign in with an ${role} account`));
    next(new HttpError(403, "forbidden", `This needs the ${role} role`));
  };
}
export const requireAdmin = (svc: Services) => requireRole(svc, "admin");
/** Who is acting, for the audit log: the signed-in user's email, else x-actor (default "admin"). */
export const actorOf = (req: Request) => String(req.user?.email || req.get("x-actor") || (req.body && req.body.actor) || "admin").slice(0, 60);

/** Fixed-window rate limit per IP, for routes that call AI models or fetch the web. */
export function rateLimit(max: number, windowMs: number) {
  const hits = new Map<string, { n: number; reset: number }>();
  return (req: Request, _res: Response, next: NextFunction) => {
    if (process.env.NODE_ENV === "test") return next();
    const k = req.ip || "anon", now = Date.now();
    const h = hits.get(k);
    if (!h || h.reset < now) hits.set(k, { n: 1, reset: now + windowMs });
    else if (++h.n > max) return next(new HttpError(429, "rate_limited", "Too many requests, please wait a minute"));
    next();
  };
}
