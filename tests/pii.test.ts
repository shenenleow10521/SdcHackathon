// Personal-detail scrubbing for Malaysian CVs (server/lib/pii.ts).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { scrubPii } from "../server/lib/pii.ts";

const cv = (name: string) => readFileSync(new URL(`./fixtures/cv/${name}.txt`, import.meta.url), "utf8");
const scrub = (t: string, first = false) => scrubPii(t, { dropFirstLineName: first });

describe("removes personal details", () => {
  it.each([
    ["880412-07-5566", "id"], ["880412075566", "id"], ["880412 07 5566", "id"], ["A12345678", "id"],
    ["+60 12-345 6789", "phone"], ["+6012-3456789", "phone"], ["012-345 6789", "phone"], ["0123456789", "phone"],
    ["011-1234 5678", "phone"], ["04-123 4567", "phone"], ["(03) 2123 4567", "phone"], ["+60 4-123 4567", "phone"],
    ["+65 9123 4567", "phone"], ["priya.nair@example.com", "email"],
    ["linkedin.com/in/priya-nair-sample", "profile_link"], ["https://www.linkedin.com/in/someone", "profile_link"],
    ["github.com/meiling-sample", "profile_link"],
  ])("inline %s (%s)", (value, kind) => {
    const r = scrub(`Contact me: ${value} anytime`);
    expect(r.text).not.toContain(value);
    expect(r.removed).toContain(kind);
  });

  it.each([
    ["Address: 23, Jalan Bunga Raya 5, Taman Sri Bunga", "address"],
    ["No. 8, Lorong Melati 2, Taman Melati", "address"],
    ["11900 Bayan Lepas, Pulau Pinang", "address"],
    ["53100 Kuala Lumpur", "address"],
    ["Alamat: Lot 12 Kampung Baru", "address"],
    ["Date of Birth: 12 April 1988", "dob"], ["DOB: 12/04/1988", "dob"], ["Tarikh Lahir: 12 April 1988", "dob"],
    ["Age: 38", "protected_attribute"], ["Umur: 36 tahun", "protected_attribute"],
    ["Gender: Female", "protected_attribute"], ["Jantina: Lelaki", "protected_attribute"],
    ["Race: Indian", "protected_attribute"], ["Bangsa: Melayu", "protected_attribute"],
    ["Religion: Hindu", "protected_attribute"], ["Agama: Islam", "protected_attribute"],
    ["Marital Status: Married", "protected_attribute"], ["Status Perkahwinan: Berkahwin", "protected_attribute"],
    ["Nationality: Malaysian", "protected_attribute"], ["Warganegara: Malaysia", "protected_attribute"],
    ["Female | Married | Malaysian", "protected_attribute"], ["Malay, Muslim, 36 years old", "protected_attribute"],
    ["IC No: 900215-14-6021", "id"], ["No. K/P: 900215-14-6021", "id"], ["NRIC - 900215146021", "id"],
    ["[Photo]", "photo"], ["Photo: attached", "photo"],
  ])("line %s", (line, kind) => {
    const r = scrub(`Skills\n${line}\nExcel`);
    expect(r.text).toBe("Skills\nExcel");
    expect(r.removed).toContain(kind);
  });

  it("labelled attributes after a separator on a contact line", () => {
    expect(scrub("Phone: 012-345 6789 | Religion: Islam").text).toBe("");
  });

  it("unlabelled ages in a sentence", () => {
    expect(scrub("I am 38 years old and work in AP.").text).toBe("I am [age] and work in AP.");
    expect(scrub("Saya berumur 38 tahun.").text).toBe("Saya [age].");
  });

  it("drops the name line (with or without a CV heading) and later mentions of the name", () => {
    expect(scrub("Priya Nair\nAP executive. Signed, Priya Nair", true).text).toBe("[name]\nAP executive. Signed, [name]");
    expect(scrub("Curriculum Vitae\nMuhammad Hafiz bin Abdullah\nStore Supervisor", true).text).toBe("Curriculum Vitae\n[name]\nStore Supervisor");
    expect(scrub("NUR AISYAH BINTI AHMAD\nClerk", true).text).toBe("[name]\nClerk");
    expect(scrub("Priya a/p Ramasamy\nClerk", true).text).toBe("[name]\nClerk");
    expect(scrub("Name: Tan Mei Ling\nAnalyst").text).toBe("[name]\nAnalyst");
  });

  it("does not mistake a job title for a name", () => {
    expect(scrub("Accounts Payable Executive\nPenang", true).text).toBe("Accounts Payable Executive\nPenang");
  });

  it("removes referees' names given with an honorific", () => {
    expect(scrub("Mr. Lim Boon Huat, Finance Manager").text).toBe("[name], Finance Manager");
    expect(scrub("Puan Siti Aminah binti Yusof (HR)").text).toBe("[name] (HR)");
  });

  it("the synthetic CVs keep their work content and lose every personal detail", () => {
    const r = scrub(cv("priya-nair"), true);
    for (const pii of ["Priya Nair", "345 6789", "example.com", "880412", "Jalan Bunga", "11900", "Female", "Hindu", "Indian", "Married", "1988", "Lim Boon Huat"])
      expect(r.text).not.toContain(pii);
    for (const work of ["three-way matching", "SAP S/4HANA", "RM 12,000", "SST-02", "Jan 2015 - Present", "Bayan Lepas", "Malay, Tamil"])
      expect(r.text).toContain(work);
    const h = scrub(cv("retail-supervisor"), true);
    for (const pii of ["Hafiz", "987 6543", "Lorong Melati", "900215", "Lelaki", "Melayu", "Islam", "Berkahwin", "36"]) expect(h.text).not.toContain(pii);
    expect(h.text).toContain("10 tahun pengalaman");
    const m = scrub(cv("fresh-graduate"), true);
    for (const pii of ["Tan Mei Ling", "222 3344", "github.com", "Female", "23 years"]) expect(m.text).not.toContain(pii);
    expect(m.text).toContain("CGPA 3.65");
  });
});

describe("no false positives on normal job text", () => {
  it.each([
    "SAP S/4HANA 2020", "RM 12,000 average daily payments", "RM12k budget", "Jan 2015 - Present", "2015 - 2020", "2015-2020",
    "01/2015 - 03/2020", "06.2019 - 03.2023", "ISO 14001", "MFRS 16 leases", "GHG Protocol Scope 1, 2 and 3", "Improved accuracy by 30%",
    "Processed 1,200 invoices per month", "CGPA 3.65", "SST-02 returns", "+30% faster close", "GL account 600100",
    "Languages: English, Malay, Mandarin", "Managed Chinese New Year promotions", "Aged debtors and age-analysis reports",
    "Retail supervisor with 10 tahun pengalaman", "Built MS Excel dashboards", "Single source of truth for vendor data",
    "Office at Jalan Ampang, 2015 - 2019", "Reduced 5 kg of paper waste per week", "Drive 20% cost savings in 2 quarters",
    "Team of 12 cashiers", "Version 2.0 rollout", "0.5 FTE", "Scored 98 / 100",
  ])("%s", text => {
    expect(scrub(text).text).toBe(text);
  });
});

describe("stability", () => {
  it("is idempotent (llm.ts scrubs again before sending)", () => {
    for (const name of ["priya-nair", "retail-supervisor", "fresh-graduate"]) {
      const once = scrub(cv(name), true).text;
      expect(scrubPii(once).text).toBe(once);
      expect(scrubPii(once, { dropFirstLineName: true }).text).toBe(once);
    }
  });
  it("handles empty input", () => {
    expect(scrubPii("")).toEqual({ text: "", removed: [] });
  });
});

describe("gaps found by the CV benchmark (eval/cv)", () => {
  const s = (t: string) => scrubPii(t, { dropFirstLineName: true }).text;
  it("finds the name inside a 'CURRICULUM VITAE - NAME  Page 1 of 3' heading and removes later mentions", () => {
    const out = s("CURRICULUM VITAE - LIM WEI LING                Page 1 of 3\nLIM WEI LING\nAP clerk\nfooter: lim wei ling | resume");
    expect(out).not.toMatch(/lim wei ling/i);
  });
  it("handles Malaysian name connectors in capitals (A/L, ANAK)", () => {
    expect(s("SARAVANAN A/L MUNIANDY\nStore supervisor")).not.toContain("SARAVANAN");
    expect(s("Resume\nJENNIFER ANAK JALONG\nStaff nurse")).not.toContain("JALONG");
  });
  it("drops attribute pieces from packed lines but keeps the rest", () => {
    const out = s("Accounts clerk\nNRIC 900918-14-6342 · Female · Indian · Hindu · Single · Malaysian\nIC No. 890530-10-5871 | Age 36 | Male | Indian | Married | Warganegara Malaysia\nMyKad 960811-14-5123 · 29 · Male · Chinese · Christian · Single\nKP: 980402-10-5233  Umur 27  Bujang");
    for (const w of ["Female", "Indian", "Hindu", "Single", "Age 36", "Married", "Chinese", "Christian", "Bujang", "Umur 27", " 29 "]) expect(out).not.toContain(w);
    expect(out).toContain("Accounts clerk");
  });
  it("removes religious affiliation shown through activities", () => {
    const out = s("Clerk\nChurch: worship team keyboardist\nAJK Surau Al-Hidayah (Bendahari)\nINTERESTS: futsal, fishing, usrah group at Masjid Setia Alam\nCommittee member, Sri Damansara Buddhist Fellowship");
    expect(out).not.toMatch(/church|surau|masjid|buddhist|usrah/i);
  });
  it("keeps Islamic finance and Shariah work, and job titles like 'Senior Accountant'", () => {
    const out = s("Analyst\nStructured sukuk and Islamic finance deals for a Shariah-compliant fund\nSenior Accountant, Sr Accountant duties");
    expect(out).toContain("Islamic finance");
    expect(out).toContain("sukuk");
    expect(out).toContain("Senior Accountant");
  });
  it("removes referee names with honorifics such as Sister and Ustazah", () => {
    expect(s("Nurse\n1. Sister Mary Lim, Nursing Manager")).not.toContain("Mary Lim");
    expect(s("Teacher\nUstazah Nur Aina binti Hassan")).not.toContain("Nur Aina");
  });
});

describe("short marital-status lines", () => {
  it("removes 'Status: Berkahwin' but keeps 'Project status: completed'", () => {
    const out = scrubPii("Kerani\nStatus: Berkahwin\nProject status: completed on time").text;
    expect(out).not.toContain("Berkahwin");
    expect(out).toContain("Project status: completed");
  });
});
