// Full ESCO taxonomy: the seed file is complete, search works, and "check any job" computes match and exposure honestly.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { loadEsco, escoStats, searchOccupations, searchSkills, occupationDetail, RELATED_COSINE } from "../server/services/esco.ts";
import { PARAMS } from "../shared/engine.js";
import { knowledge } from "./helpers/seed-graph.ts";
import { testServices } from "./helpers/services.ts";
import { createApp } from "../server/app.ts";
import type { Server } from "node:http";

const map = JSON.parse(readFileSync(new URL("../db/seed/esco_map.json", import.meta.url), "utf8"));
const escoId = (cat: string) => String(map.skills[cat].uri).split("/").pop()!;

describe("ESCO data", () => {
  it("has every ESCO v1.2.1 occupation and skill, with skill links and ILO exposure", () => {
    const s = escoStats() as any;
    expect(s.available).toBe(true);
    expect(s.counts.occupations).toBeGreaterThan(2900);
    expect(s.counts.skills).toBeGreaterThan(13000);
    expect(s.counts.skillLinks).toBeGreaterThan(100000);
    const d = loadEsco()!;
    const withIlo = Object.values<any>(d.occupations).filter(o => o.ilo).length;
    expect(withIlo / s.counts.occupations).toBeGreaterThan(0.9);
    for (const o of Object.values<any>(d.occupations)) for (const k of [...o.essential, ...o.optional]) expect(d.skills[k], k).toBeTruthy();
  });

  it("ILO exposure matches the per-occupation values already in studies.json", () => {
    const studies = JSON.parse(readFileSync(new URL("../db/seed/studies.json", import.meta.url), "utf8"));
    const d = loadEsco()!;
    let checked = 0;
    for (const st of studies.filter((x: any) => x.source === "ilo_wp140")) {
      const uri = map.occupations[st.occupationId]?.uri;
      const o = uri && d.occupations[String(uri).split("/").pop()!];
      if (!o?.ilo) continue;
      expect(o.ilo.mean, st.occupationId).toBe(st.value);
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  it("every skill has a model score and a nearest catalogue skill", () => {
    const d = loadEsco()!;
    const ids = Object.keys(d.skills);
    expect(Object.keys(d.scores).length).toBe(ids.length);
    const cat = new Set(knowledge.skills.map((s: any) => s.id));
    for (const id of ids.slice(0, 500)) {
      const [e, near, cos] = d.scores[id];
      expect(e).toBeGreaterThanOrEqual(0); expect(e).toBeLessThanOrEqual(1);
      expect(cat.has(near)).toBe(true); expect(cos).toBeLessThanOrEqual(1);
    }
  });
});

describe("search", () => {
  it("finds occupations by title and alternative labels", () => {
    const r = searchOccupations("accountant");
    expect(r.length).toBeGreaterThan(0);
    expect(r[0].title.toLowerCase()).toContain("accountant");
    expect(searchOccupations("qxqxzv")).toEqual([]);
  });
  it("finds skills", () => {
    expect(searchSkills("reconcile accounts").length).toBeGreaterThan(0);
  });
});

describe("check any job", () => {
  it("counts a profile skill mapped to an essential ESCO skill as 'have', and computes match over essential skills only", () => {
    const d = loadEsco()!;
    const cat = Object.keys(map.skills).find(c => map.skills[c].uri && Object.values<any>(d.occupations).some(o => o.essential.includes(escoId(c))))!;
    const occId = Object.keys(d.occupations).find(id => d.occupations[id].essential.includes(escoId(cat)))!;
    const without = occupationDetail(occId, {})!;
    const withIt = occupationDetail(occId, { [cat]: 3 })!;
    expect(without.essential.find(s => s.id === escoId(cat))!.basis).toBe("missing");
    const s = withIt.essential.find(s => s.id === escoId(cat))!;
    expect(s).toMatchObject({ basis: "have", via: cat, coverage: 1 });
    const expected = Math.round(100 * withIt.essential.reduce((a, x) => a + x.coverage, 0) / withIt.essential.length);
    expect(withIt.match).toBe(expected);
    expect(withIt.match).toBeGreaterThan(without.match);
  });

  it("counts a closely related skill at bridge weight, never as 'have'", () => {
    const d = loadEsco()!;
    const sid = Object.keys(d.scores).find(id => d.scores[id][2] >= RELATED_COSINE && !(d.catalogueByEsco.get(id) || []).length && Object.values<any>(d.occupations).some(o => o.essential.includes(id)))!;
    const occId = Object.keys(d.occupations).find(id => d.occupations[id].essential.includes(sid))!;
    const s = occupationDetail(occId, { [d.scores[sid][1]]: 2 })!.essential.find(x => x.id === sid)!;
    expect(s).toMatchObject({ basis: "related", coverage: PARAMS.bridgeCoverage });
  });

  it("returns null for an unknown occupation", () => { expect(occupationDetail("00000000-0000-0000-0000-000000000000")).toBeNull(); });
});

describe("ESCO API", () => {
  let server: Server, base = "";
  beforeAll(async () => {
    const svc = await testServices();
    server = createApp(svc).listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  });
  afterAll(() => server?.close());

  it("searches and opens an occupation with the demo profile", async () => {
    const s = await (await fetch(`${base}/esco/occupations?q=accountant`)).json();
    expect(s.results.length).toBeGreaterThan(0);
    const o = await (await fetch(`${base}/esco/occupations/${s.results[0].id}?profile=1`)).json();
    expect(o.essential.length).toBe(o.counts.essential);
    expect(typeof o.match).toBe("number");
  });
  it("validates ids and profiles", async () => {
    expect((await fetch(`${base}/esco/occupations/not-an-id`)).status).toBe(400);
    expect((await fetch(`${base}/esco/occupations/00000000-0000-0000-0000-000000000000`)).status).toBe(404);
    expect((await fetch(`${base}/esco/occupations?q=a`)).status).toBe(400);
  });
  it("reports stats", async () => {
    const s = await (await fetch(`${base}/esco/stats`)).json();
    expect(s.available).toBe(true);
  });
});

// Keep gunzip import used for a quick format check of the file itself.
it("seed file is gzip JSON with provenance", () => {
  const j = JSON.parse(gunzipSync(readFileSync(new URL("../db/seed/esco_full.json.gz", import.meta.url))).toString("utf8"));
  expect(j._meta.esco).toContain("ESCO v1.2.1");
  expect(j._meta.ilo).toContain("WP140");
});

describe("confirming ESCO skills", () => {
  let server: Server, base = "";
  beforeAll(async () => {
    const svc = await testServices();
    server = createApp(svc).listen(0);
    base = `http://127.0.0.1:${(server.address() as any).port}/api`;
  });
  afterAll(() => server?.close());
  const put = (body: any) => fetch(`${base}/esco/profile/1/skills`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

  it("a confirmed essential skill counts as 'have' and raises the match; undo removes it", async () => {
    const occ = (await (await fetch(`${base}/esco/occupations?q=accounting%20assistant`)).json()).results[0];
    const before = await (await fetch(`${base}/esco/occupations/${occ.id}?profile=1`)).json();
    const target = before.essential.find((s: any) => s.basis === "missing");
    expect((await put({ add: [target.id] })).status).toBe(200);
    const after = await (await fetch(`${base}/esco/occupations/${occ.id}?profile=1`)).json();
    expect(after.essential.find((s: any) => s.id === target.id)).toMatchObject({ basis: "have", confirmed: true, coverage: 1 });
    expect(after.match).toBeGreaterThan(before.match);
    await put({ remove: [target.id] });
    const undone = await (await fetch(`${base}/esco/occupations/${occ.id}?profile=1`)).json();
    expect(undone.match).toBe(before.match);
  });

  it("rejects unknown skill ids and unknown profiles", async () => {
    expect((await put({ add: ["00000000-0000-0000-0000-000000000000"] })).status).toBe(400);
    const r = await fetch(`${base}/esco/profile/99999/skills`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ add: [] }) });
    expect(r.status).toBe(404);
  });
});

describe("O*NET task layer (via the ESCO-O*NET crosswalk)", () => {
  it("links most ESCO occupations to an O*NET occupation with human-rated tasks", () => {
    const s = escoStats() as any;
    expect(s.onet.counts.withTasks).toBeGreaterThan(2000);
    expect(s.onet.counts.tasks).toBeGreaterThan(15000);
  });
  it("an occupation's task split adds up and uses only human ratings", () => {
    const occ = searchOccupations("accounting assistant", 1)[0];
    const o = occupationDetail(occ.id)!;
    expect(o.onet).toBeTruthy();
    const { ai, tools, human } = o.onet!.split!;
    expect(Math.abs(ai + tools + human - 100)).toBeLessThanOrEqual(2);
    expect(o.onet!.tasks.every(t => ["ai", "tools", "human"].includes(t.rating))).toBe(true);
    expect(["exact", "close", "narrow", "broad"]).toContain(o.onet!.match);
  });
});

describe("Malaysian trend (DOSM, by MASCO/ISCO major group)", () => {
  it("attaches the DOSM figures of the occupation's major group", () => {
    const occ = searchOccupations("accounting assistant", 1)[0];
    const o = occupationDetail(occ.id)!;
    expect(o.code[0]).toBe("3");
    expect(o.malaysia).toMatchObject({ group: "technicians", year: 2025, since: 2021 });
    expect(o.malaysia.medianWageRm).toBeGreaterThan(1000);
    const dosm = JSON.parse(readFileSync(new URL("../db/seed/dosm.json", import.meta.url), "utf8")).datasets.find((x: any) => x.id === "wages_occupation");
    const row = dosm.rows.find((r: any) => r.occupation === "technicians" && r.sex === "both" && r.date === "2025-01-01");
    expect(o.malaysia.medianWageRm).toBe(row.wages_median);
  });
});

describe("Malaysia's Critical Occupations List (MyCOL 2024/2025)", () => {
  it("has all 66 occupations and flags ESCO occupations in those 4-digit groups", () => {
    const mycol = JSON.parse(readFileSync(new URL("../db/seed/mycol.json", import.meta.url), "utf8"));
    expect(mycol.occupations).toHaveLength(66);
    expect(mycol.occupations.filter((o: any) => o.new)).toHaveLength(5);
    expect(mycol.occupations.filter((o: any) => o.everyEdition)).toHaveLength(9);
    const s = escoStats() as any;
    expect(s.mycol.escoOccupationsFlagged).toBeGreaterThan(50);
    const acc = searchOccupations("accountant", 5).find(o => o.isco === "2411")!;
    expect(acc.critical).toBe(true);
    expect(occupationDetail(acc.id)!.critical).toMatchObject({ masco: "2411", title: "Accountants and Auditors" });
    const clerk = searchOccupations("accounting assistant", 1)[0];
    expect(occupationDetail(clerk.id)!.critical).toBeNull();
  });
});
