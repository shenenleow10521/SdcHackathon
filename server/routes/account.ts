// Accounts: what the browser needs to sign in, who is signed in, and "Delete my data".
//   GET    /config    { auth:{ enabled, url?, anonKey? } }  (the anon key is public by design)
//   GET    /me        { authEnabled, user:{id,email}|null, roles, profileId|null }
//   DELETE /me/data   deletes the signed-in user's profile and everything linked to it
import { Router } from "express";
import type { Services } from "../context.ts";
import { HttpError } from "../lib/http.ts";
import { audit } from "../repo.ts";
import { deleteProfileData } from "../lib/auth.ts";

export default function accountRoutes(svc: Services) {
  const r = Router();
  const enabled = () => !!(svc.auth && svc.config.supabase);

  r.get("/config", (_req, res) => {
    const s = svc.config.supabase;
    res.json({ auth: enabled() && s ? { enabled: true, url: s.url, anonKey: s.anonKey } : { enabled: false } });
  });

  const ownProfileId = async (userId: string) =>
    (await svc.db.query<{ id: number }>("select id from profiles where auth_user_id=$1", [userId])).rows[0]?.id ?? null;

  r.get("/me", async (req, res) => {
    const u = req.user;
    res.json({ authEnabled: enabled(), user: u ? { id: u.id, email: u.email } : null, roles: u?.roles ?? [], profileId: u ? await ownProfileId(u.id) : null });
  });

  r.delete("/me/data", async (req, res) => {
    const u = req.user;
    if (!u) throw new HttpError(401, "sign_in_required", "Sign in to delete your data.");
    const id = await ownProfileId(u.id);
    const out = id ? await svc.db.tx(t => deleteProfileData(t, id)) : { profileId: null, deleted: false, plans: 0 };
    // Record that a deletion happened, without keeping anything about the person.
    await audit(svc.db, "user", "account.delete_data", null, { deleted: out.deleted, plans: out.plans });
    res.json(out);
  });

  return r;
}
