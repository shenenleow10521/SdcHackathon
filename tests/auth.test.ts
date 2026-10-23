// Accounts (Supabase Auth, mocked): each user sees only their own profile, plans and ESCO skills; staff routes
// need a role; "Delete my data" removes everything linked to the profile. With accounts off, nothing changes
// (the rest of the suite runs that way).
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { createApp } from "../server/app.ts";
import { testServices } from "./helpers/services.ts";
import { createMockLlm } from "../server/lib/llm.ts";
import { createMockEmbedder } from "../server/lib/embed.ts";
import { supabaseVerifier, type AuthVerifier } from "../server/lib/auth.ts";
import { cvLlmHandler } from "./fixtures/cv/mock-llm.ts";
import type { Services } from "../server/context.ts";

const PRIYA = readFileSync(new URL("./fixtures/cv/priya-nair.txt", import.meta.url), "utf8");

const USERS: Record<string, { id: string; email: string }> = {
  "tok-a": { id: "00000000-0000-4000-8000-00000000000a", email: "a@example.com" },
  "tok-b": { id: "00000000-0000-4000-8000-00000000000b", email: "b@example.com" },
  "tok-admin": { id: "00000000-0000-4000-8000-0000000000ad", email: "Admin@Example.com" },
  "tok-adv": { id: "00000000-0000-4000-8000-0000000000ae", email: "advisor@example.com" },
};
const mockAuth: AuthVerifier = async token => USERS[token] ?? null;
const as = (tok: string) => ({ Authorization: `Bearer ${tok}` });

let svc: Services;
let app: ReturnType<typeof createApp>;
let profileA: number;

beforeAll(async () => {
  svc = await testServices({
    llm: createMockLlm(cvLlmHandler()), embed: createMockEmbedder(512), auth: mockAuth,
    config: { supabase: { url: "https://example.supabase.co", anonKey: "anon-key" }, adminEmails: ["admin@example.com"], advisorEmails: ["advisor@example.com"], adminToken: "script-token" },
  });
  app = createApp(svc);
});

const intake = (tok?: string) => {
  const r = request(app).post("/api/profile/intake");
  return (tok ? r.set(as(tok)) : r).send({ text: PRIYA, hours: 6 });
};

describe("sign-in basics", () => {
  it("GET /config gives the browser the public Supabase settings", async () => {
    const res = await request(app).get("/api/config");
    expect(res.body).toEqual({ auth: { enabled: true, url: "https://example.supabase.co", anonKey: "anon-key" } });
  });

  it("GET /config says accounts are off when Supabase isn't configured", async () => {
    const off = createApp(await testServices({ db: svc.db }));
    expect((await request(off).get("/api/config")).body).toEqual({ auth: { enabled: false } });
  });

  it("GET /me: anonymous, signed in, and an invalid token", async () => {
    expect((await request(app).get("/api/me")).body).toEqual({ authEnabled: true, user: null, roles: [], profileId: null });
    const me = await request(app).get("/api/me").set(as("tok-a"));
    expect(me.body).toMatchObject({ user: { id: USERS["tok-a"].id, email: "a@example.com" }, roles: [], profileId: null });
    const bad = await request(app).get("/api/me").set(as("expired"));
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe("invalid_session");
  });

  it("roles come from the email allow-lists (case-insensitive); admin is also advisor", async () => {
    expect((await request(app).get("/api/me").set(as("tok-admin"))).body.roles).toEqual(["admin", "advisor"]);
    expect((await request(app).get("/api/me").set(as("tok-adv"))).body.roles).toEqual(["advisor"]);
  });
});

describe("profiles belong to their account", () => {
  it("CV intake needs an account, and links the new profile to it", async () => {
    const anon = await intake();
    expect(anon.status).toBe(401);
    expect(anon.body.error.code).toBe("sign_in_required");

    const res = await intake("tok-a");
    expect(res.status).toBe(201);
    profileA = res.body.profileId;
    expect((await request(app).get("/api/me").set(as("tok-a"))).body.profileId).toBe(profileA);
  });

  it("the owner can read and edit their profile", async () => {
    expect((await request(app).get(`/api/profile/${profileA}`).set(as("tok-a"))).status).toBe(200);
    expect((await request(app).put(`/api/profile/${profileA}`).set(as("tok-a")).send({ hours: 8 })).body.profile.hours).toBe(8);
    expect((await request(app).get("/api/map").query({ profile: profileA }).set(as("tok-a"))).status).toBe(200);
  });

  it("user B can't read or change user A's profile, plans or confirmed ESCO skills", async () => {
    const b = as("tok-b");
    const checks = [
      request(app).get(`/api/profile/${profileA}`).set(b),
      request(app).put(`/api/profile/${profileA}`).set(b).send({ hours: 3 }),
      request(app).put(`/api/profile/${profileA}/skills`).set(b).send({ skills: [{ skillId: "recon", level: 1 }] }),
      request(app).get(`/api/profile/${profileA}/history`).set(b),
      request(app).get("/api/map").query({ profile: profileA }).set(b),
      request(app).get("/api/plan").query({ profile: profileA, job: "esg" }).set(b),
      request(app).get("/api/plans").query({ profile: profileA }).set(b),
      request(app).post("/api/plans").set(b).send({ profileId: profileA, job: "esg" }),
      request(app).get(`/api/esco/profile/${profileA}/skills`).set(b),
      request(app).put(`/api/esco/profile/${profileA}/skills`).set(b).send({ add: [] }),
    ];
    for (const [i, res] of (await Promise.all(checks)).entries()) {
      expect(res.status, `check ${i}`).toBe(403);
      expect(res.body.error.code).toBe("forbidden");
    }
    expect((await request(app).get(`/api/profile/${profileA}`)).status).toBe(401); // anonymous
  });

  it("user B can't act on user A's saved plan", async () => {
    const job = (await request(app).get("/api/map").query({ profile: profileA }).set(as("tok-a"))).body.jobs[0].job;
    const plan = await request(app).post("/api/plans").set(as("tok-a")).send({ profileId: profileA, job });
    expect(plan.status).toBe(201);
    const id = plan.body.plan.id;
    expect((await request(app).post(`/api/plans/${id}/send`).set(as("tok-b")).send({})).status).toBe(403);
    expect((await request(app).post(`/api/plans/${id}/send`).set(as("tok-a")).send({})).body.plan.status).toBe("sent");
  });

  it("the sample persona stays open to everyone, signed in or not (and stays read-only)", async () => {
    expect((await request(app).get("/api/profile/1")).status).toBe(200);
    expect((await request(app).get("/api/map")).status).toBe(200);
    expect((await request(app).get("/api/profile/1").set(as("tok-b"))).status).toBe(200);
    expect((await request(app).put("/api/profile/1").set(as("tok-b")).send({ hours: 9 })).status).toBe(403);
  });

  it("staff may read a profile but not change it", async () => {
    expect((await request(app).get(`/api/profile/${profileA}`).set(as("tok-adv"))).status).toBe(200);
    expect((await request(app).put(`/api/profile/${profileA}`).set(as("tok-admin")).send({ hours: 2 })).status).toBe(403);
  });
});

describe("staff routes need a role", () => {
  it("non-admins get 403 on admin routes, anonymous users 401", async () => {
    const adminRoutes = [
      () => request(app).get("/api/review"),
      () => request(app).post("/api/kb/versions/1/undo").send({}),
      () => request(app).post("/api/scout/run").send({ replay: true }),
      () => request(app).post("/api/review/signals/1/approve").send({}),
    ];
    for (const r of adminRoutes) {
      expect((await r()).status).toBe(401);
      expect((await r().set(as("tok-a"))).status).toBe(403);
      expect((await r().set(as("tok-adv"))).status).toBe(403); // advisor isn't admin
    }
    expect((await request(app).get("/api/review").set(as("tok-admin"))).status).toBe(200);
  });

  it("advisor queue, advisor decisions and the HR view need the advisor role", async () => {
    const hr = (await request(app).get("/api/employers")).body.employers[0].id;
    for (const path of ["/api/advisor/queue", `/api/hr/${hr}/redeployment`]) {
      expect((await request(app).get(path).set(as("tok-a"))).status).toBe(403);
      expect((await request(app).get(path).set(as("tok-adv"))).status).toBe(200);
      expect((await request(app).get(path).set(as("tok-admin"))).status).toBe(200);
    }
    expect((await request(app).post("/api/plans/1/decision").set(as("tok-a")).send({ decision: "approve" })).status).toBe(403);
  });

  it("ADMIN_TOKEN still opens admin routes for scripts", async () => {
    expect((await request(app).get("/api/review").set("x-admin-token", "script-token")).status).toBe(200);
  });

  it("the advisor's email is recorded as the decision maker", async () => {
    const queue = (await request(app).get("/api/advisor/queue").set(as("tok-adv"))).body.plans;
    const mine = queue.find((p: any) => p.profileId === profileA);
    const res = await request(app).post(`/api/plans/${mine.id}/decision`).set(as("tok-adv")).set("x-actor", "someone-else").send({ decision: "approve" });
    expect(res.body.plan.decidedBy).toBe("advisor@example.com");
  });
});

describe("one profile per account, and Delete my data", () => {
  it("a new intake replaces the account's old profile", async () => {
    const res = await intake("tok-a");
    expect(res.status).toBe(201);
    expect((await request(app).get(`/api/profile/${profileA}`).set(as("tok-admin"))).status).toBe(404);
    profileA = res.body.profileId;
    expect((await request(app).get("/api/me").set(as("tok-a"))).body.profileId).toBe(profileA);
  });

  it("DELETE /me/data removes the profile and everything linked to it", async () => {
    const job = (await request(app).get("/api/map").query({ profile: profileA }).set(as("tok-a"))).body.jobs[0].job;
    await request(app).post("/api/plans").set(as("tok-a")).send({ profileId: profileA, job });
    const count = async (sql: string) => Number((await svc.db.query(sql, [profileA])).rows[0].n);
    expect(await count("select count(*) as n from profile_skills where profile_id=$1")).toBeGreaterThan(0);
    expect(await count("select count(*) as n from plans where profile_id=$1")).toBe(1);

    expect((await request(app).delete("/api/me/data")).status).toBe(401);
    const res = await request(app).delete("/api/me/data").set(as("tok-a"));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ profileId: profileA, deleted: true, plans: 1 });

    for (const t of ["profiles where id", "profile_skills where profile_id", "profile_esco_skills where profile_id", "plans where profile_id", "profile_snapshots where profile_id"])
      expect(await count(`select count(*) as n from ${t}=$1`), t).toBe(0);
    expect(await count("select count(*) as n from audit_log where actor='user:'||$1::text or target=$1::text")).toBe(0);
    expect((await request(app).get("/api/me").set(as("tok-a"))).body.profileId).toBeNull();
    expect((await request(app).get("/api/profile/1")).status).toBe(200); // demo untouched
  });
});

describe("supabaseVerifier", () => {
  const reply = (status: number, body: unknown) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

  it("returns the user for a valid token and caches it", async () => {
    let calls = 0;
    const f = (async (url: any, init: any) => {
      calls++;
      expect(String(url)).toBe("https://x.supabase.co/auth/v1/user");
      expect(init.headers).toMatchObject({ apikey: "anon", Authorization: "Bearer good" });
      return new Response(JSON.stringify({ id: "u1", email: "Me@X.com" }), { status: 200 });
    }) as unknown as typeof fetch;
    const v = supabaseVerifier("https://x.supabase.co/", "anon", f);
    expect(await v("good")).toEqual({ id: "u1", email: "me@x.com" });
    await v("good");
    expect(calls).toBe(1);
  });

  it("an invalid token is null; Supabase being down is a 503, not a sign-out", async () => {
    expect(await supabaseVerifier("https://x.supabase.co", "anon", reply(401, { msg: "bad jwt" }))("t")).toBeNull();
    await expect(supabaseVerifier("https://x.supabase.co", "anon", reply(500, {}))("t")).rejects.toMatchObject({ status: 503 });
    const down = (async () => { throw new Error("ECONNRESET"); }) as unknown as typeof fetch;
    await expect(supabaseVerifier("https://x.supabase.co", "anon", down)("t")).rejects.toMatchObject({ status: 503 });
  });
});
