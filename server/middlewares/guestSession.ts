import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";

declare global {
  namespace Express { interface Request { guestSessionId?: string } }
}

const COOKIE = "ht_guest";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const RENEW_AFTER_SECONDS = 15 * 24 * 60 * 60;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function signature(id: string, issuedAt: number, secret: string) {
  return createHmac("sha256", secret).update(`${id}.${issuedAt}`).digest("base64url");
}

function readCookie(req: Parameters<RequestHandler>[0], secret: string) {
  const raw = req.headers.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(`${COOKIE}=`))?.slice(COOKIE.length + 1);
  if (!raw) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(raw); } catch { return null; }
  const parts = decoded.split(".");
  if (parts.length !== 3) return null;
  const [id, timestamp, supplied] = parts;
  const issuedAt = Number(timestamp);
  const now = Math.floor(Date.now() / 1000);
  if (!id || !UUID.test(id) || !Number.isSafeInteger(issuedAt) || issuedAt > now + 60 || now - issuedAt > MAX_AGE_SECONDS || !supplied) return null;
  const expected = Buffer.from(signature(id, issuedAt, secret));
  const actual = Buffer.from(supplied);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return { id, issuedAt };
}

function setCookie(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1], id: string, secret: string) {
  const issuedAt = Math.floor(Date.now() / 1000);
  const value = `${id}.${issuedAt}.${signature(id, issuedAt, secret)}`;
  const flags = [`${COOKIE}=${encodeURIComponent(value)}`, "Path=/", `Max-Age=${MAX_AGE_SECONDS}`, "HttpOnly", "SameSite=Lax"];
  if (req.secure) flags.push("Secure");
  res.append("Set-Cookie", flags.join("; "));
}

export const guestOwnerId = (sessionId: string) => `guest:${sessionId}`;

/** Issues a signed, HttpOnly browser identity so guests can securely revisit their own CV profile. */
export function guestSessionMiddleware(secret: string): RequestHandler {
  return (req, res, next) => {
    const now = Math.floor(Date.now() / 1000);
    const existing = readCookie(req, secret);
    if (existing) {
      req.guestSessionId = existing.id;
      if (now - existing.issuedAt >= RENEW_AFTER_SECONDS) setCookie(req, res, existing.id, secret);
      return next();
    }
    const id = randomUUID();
    req.guestSessionId = id;
    setCookie(req, res, id, secret);
    next();
  };
}
