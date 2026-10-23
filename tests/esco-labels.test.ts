// Requirement labels and weights come from ESCO, and job nodes carry MyCOL and DOSM facts from their ISCO code.
import { describe, it, expect, beforeAll } from "vitest";
import { escoReq, ESCO_REQ_WEIGHT, catalogueIsco, mycolFor, dosmFor } from "../server/lib/esco-labels.ts";
import { knowledge } from "./helpers/seed-graph.ts";
import { testServices } from "./helpers/services.ts";
import { loadGraph } from "../server/kb.ts";
import type { Services } from "../server/context.ts";

const rows = Object.entries<any[]>(knowledge.requirements).flatMap(([job, rs]) => rs.map(r => ({ job, skill: r.skill, esco: escoReq(job, r.skill) })));

describe("ESCO status of catalogue requirements", () => {
  it("is computed for all 66: 10 essential, 9 optional, 34 other (we added them), 13 not in ESCO", () => {
    expect(rows).toHaveLength(66);
    const count = (k: string) => rows.filter(r => r.esco === k).length;
    expect({ essential: count("essential"), optional: count("optional"), other: count("other"), none: count("none") })
      .toEqual({ essential: 10, optional: 9, other: 34, none: 13 });
  });

  it("matches ESCO for known cases", () => {
    expect(escoReq("esgRole", "disc")).toBe("essential");      // sustainability manager: lead the sustainability reporting process
    expect(escoReq("intAudit", "audit2")).toBe("optional");    // financial auditor: internal auditing
    expect(escoReq("esgRole", "audit")).toBe("other");         // in ESCO, not listed for sustainability manager
    expect(escoReq("esgRole", "ghg")).toBe("none");            // no ESCO equivalent
    expect(new Set(rows.filter(r => r.esco === "none").map(r => r.skill))).toEqual(new Set(["prompt", "aisup", "aiinv", "ghg", "three"]));
    expect(escoReq("nope", "disc")).toBeNull();
  });

  it("weights: ESCO essential 2, everything else 1", () => {
    expect(ESCO_REQ_WEIGHT).toEqual({ essential: 2, optional: 1, other: 1, none: 1 });
  });
});

describe("MyCOL and DOSM by ISCO code", () => {
  it("flags catalogue jobs whose 4-digit group is on MyCOL", () => {
    const on = knowledge.occupations.filter((o: any) => o.isDestination && mycolFor(catalogueIsco(o.id))).map((o: any) => o.id).sort();
    expect(on).toEqual(["aiQaRole", "assurRole", "biRole", "dataRole", "esgRole", "faRole", "greenRole", "intAudit", "opsRole", "treasuryRole"].sort());
    expect(mycolFor("4311")).toBeNull();
    expect(mycolFor("2411")).toMatchObject({ code: "2411", title: "Accountants and Auditors" });
  });
  it("gives DOSM wages for the major group", () => {
    expect(dosmFor("4311")).toMatchObject({ group: "clerical" });
    expect(dosmFor("1213")).toMatchObject({ group: "managers" });
    expect(dosmFor(null)).toBeNull();
  });
});

describe("graph", () => {
  let svc: Services;
  beforeAll(async () => { svc = await testServices(); });
  it("req entries carry esco and the ESCO weight; job nodes carry iscoCode, mycol and malaysia", async () => {
    const g = await loadGraph(svc.db);
    const esg = g.req.esgRole;
    expect(esg.find(r => r.skill === "disc")).toMatchObject({ esco: "essential", weight: 2 });
    expect(esg.find(r => r.skill === "ghg")).toMatchObject({ esco: "none", weight: 1 });
    expect(g.nodes.esgRole).toMatchObject({ iscoCode: "1213", mycol: { code: "1213" }, malaysia: { group: "managers" } });
    expect(g.nodes.stayRole).toMatchObject({ iscoCode: "4311", mycol: null, malaysia: { group: "clerical" } });
  });
});
