import type { RequestHandler } from "express";
import { HttpError } from "../lib/http.ts";

/** Cookie-authenticated browser writes must come from this app. CLI clients may omit Origin. */
export const sameOriginMutations: RequestHandler = (req, _res, next) => {
  if (["GET", "HEAD", "OPTIONS"].includes(req.method)) return next();
  const origin = req.get("origin");
  if (!origin) return next();
  const host = (req.get("x-forwarded-host") || req.get("host") || "").split(",")[0].trim();
  try {
    const expected = new URL(`${req.protocol}://${host}`).origin;
    if (new URL(origin).origin === expected) return next();
  } catch { /* Malformed or opaque origins are not trusted. */ }
  next(new HttpError(403, "cross_site_request", "Open this action from HalaTuju and try again."));
};
