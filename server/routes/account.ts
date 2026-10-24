// Accounts: what the browser needs to sign in, who is signed in, and "Delete my data".
//   GET    /config    { auth:{ enabled, publishableKey?, proxyUrl? } }
//   GET    /me        { authEnabled, user:{id,email}|null, roles, profileId|null }
//   DELETE /me/data   deletes the signed-in user's profile and everything linked to it
import { Router } from "express";
import type { Services } from "../context.ts";
import { HttpError } from "../lib/http.ts";
import { audit } from "../repo.ts";
import { deleteProfileData } from "../lib/auth.ts";
import { guestOwnerId } from "../middlewares/guestSession.ts";

export default function accountRoutes(svc: Services) {
  const r = Router();
  const enabled = () => svc.config.clerkEnabled || !!svc.auth;

  r.get("/config", (_req, res) => {
    res.json({ auth: enabled()
      ? { enabled: true, publishableKey: svc.config.clerkPublishableKey, proxyUrl: svc.config.clerkProxyUrl }
      : { enabled: false } });
  });

  const ownProfileId = async (userId: string) =>
    (await svc.db.query<{ id: number }>("select id from profiles where auth_user_id=$1", [userId])).rows[0]?.id ?? null;

  r.get("/me", async (req, res) => {
    const u = req.user;
    const guestProfileId = req.guestSessionId ? await ownProfileId(guestOwnerId(req.guestSessionId)) : null;
    const profileId = (u ? await ownProfileId(u.id) : null) ?? guestProfileId;
    res.json({ authEnabled: enabled(), user: u ? { id: u.id, email: u.email } : null, roles: u?.roles ?? [], profileId, guestProfileId });
  });

  r.delete("/me/data", async (req, res) => {
    const u = req.user;
    if (!u && !req.guestSessionId) throw new HttpError(401, "sign_in_required", "Start a guest session or sign in to delete your data.");
    const ids = [...new Set([
      u ? await ownProfileId(u.id) : null,
      req.guestSessionId ? await ownProfileId(guestOwnerId(req.guestSessionId)) : null,
    ].filter((id): id is number => id !== null))];
    const out = await svc.db.tx(async t => {
      let deleted = false, plans = 0;
      for (const id of ids) {
        const result = await deleteProfileData(t, id);
        deleted ||= result.deleted;
        plans += result.plans;
      }
      return { profileId: ids[0] ?? null, deleted, plans };
    });
    // Record that a deletion happened, without keeping anything about the person.
    await audit(svc.db, "user", "account.delete_data", null, { deleted: out.deleted, plans: out.plans });
    res.json(out);
  });

  return r;
}
