// Accounts (Clerk sessions, mocked): each user sees only their own profile, plans and ESCO skills; staff routes
// need a role; "Delete my data" removes everything linked to the profile. With accounts off, nothing changes
// (the rest of the suite runs that way).
import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { readFileSync } from "node:fs";
import { createApp } from "../server/app.ts";
import { testServices } from "./helpers/services.ts";
import { createMockLlm } from "../server/lib/llm.ts";
import { createMockEmbedder } from "../server/lib/embed.ts";
import type { AuthVerifier } from "../server/lib/auth.ts";
import { cvLlmHandler } from "./fixtures/cv/mock-llm.ts";
import type { Services } from "../server/context.ts";

const PRIYA = readFileSync(new URL("./fixtures/cv/priya-nair.txt", import.meta.url), "utf8");

const USERS: Record<string, { id: string; email: string }> = {
  "tok-a": { id: "user_a", email: "a@example.com" },
  "tok-b": { id: "user_b", email: "b@example.com" },
  "tok-admin": { id: "user_admin", email: "Admin@Example.com" },
  "tok-adv": { id: "user_advisor", email: "advisor@example.com" },
};
const mockAuth: AuthVerifier = async token => USERS[token] ?? null;
const as = (tok: string) => ({ Authorization: `Bearer ${tok}` });

let svc: Services;
let app: ReturnType<typeof createApp>;
let profileA: number;

beforeAll(async () => {
  svc = await testServices({
    llm: createMockLlm(cvLlmHandler()), embed: createMockEmbedder(512), auth: mockAuth,
    config: { clerkEnabled: true, clerkPublishableKey: "pk_test_mock", clerkProxyUrl: "", guestSessionSecret: "a-test-only-guest-session-secret", adminEmails: ["admin@example.com"], advisorEmails: ["advisor@example.com"], adminToken: "script-token" },
  });
  app = createApp(svc);
});

const intake = (tok?: string, cookie?: string) => {
  const r = request(app).post("/api/profile/intake");
  if (tok) r.set(as(tok));
  if (cookie) r.set("Cookie", cookie);
  return r.send({ text: PRIYA, hours: 6 });
};

describe("sign-in basics", () => {
  it("GET /config gives the browser the public Clerk settings", async () => {
    const res = await request(app).get("/api/config");
    expect(res.body).toEqual({ auth: { enabled: true, publishableKey: "pk_test_mock", proxyUrl: "" } });
  });

  it("GET /config says accounts are off when Clerk isn't configured", async () => {
    const off = createApp(await testServices({ db: svc.db }));
    expect((await request(off).get("/api/config")).body).toEqual({ auth: { enabled: false } });
  });

  it("GET /me: anonymous, signed in, and an invalid token", async () => {
    expect((await request(app).get("/api/me")).body).toMatchObject({ authEnabled: true, user: null, roles: [], profileId: null, guestProfileId: null });
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

describe("guest CV intake", () => {
  it("creates a private guest session, permits CV intake, and limits the profile to that browser", async () => {
    const res = await intake();
    expect(res.status).toBe(201);
    const setCookies = Array.isArray(res.headers["set-cookie"]) ? res.headers["set-cookie"] : [res.headers["set-cookie"]];
    expect(setCookies).toEqual(expect.arrayContaining([expect.stringMatching(/^ht_guest=.*HttpOnly.*SameSite=Lax/i)]));
    const guestCookie = setCookies.find(value => value.startsWith("ht_guest="))!.split(";")[0];
    const profileId = res.body.profileId;

    expect((await request(app).get("/api/me").set("Cookie", guestCookie)).body).toMatchObject({
      user: null, profileId, guestProfileId: profileId,
    });
    expect((await request(app).get(`/api/profile/${profileId}`).set("Cookie", guestCookie)).status).toBe(200);
    expect((await request(app).get(`/api/profile/${profileId}`)).status).toBe(401);

    const forgedCookie = guestCookie.replace(/.$/, (character: string) => character === "A" ? "B" : "A");
    expect((await request(app).get(`/api/profile/${profileId}`).set("Cookie", forgedCookie)).status).toBe(401);
    const deleted = await request(app).delete("/api/me/data").set("Cookie", guestCookie);
    expect(deleted.status).toBe(200);
    expect(deleted.body).toMatchObject({ profileId, deleted: true });
  });
});
describe("profiles belong to their account", () => {
  it("signed-in CV intake links the new profile to its Clerk account", async () => {
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

    const emptyGuest = await request(app).delete("/api/me/data");
    expect(emptyGuest.status).toBe(200);
    expect(emptyGuest.body.deleted).toBe(false);
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

