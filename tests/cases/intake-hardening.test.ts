import { describe, expect, it } from "vitest";
import { sanitizeExtraction } from "../../lib/agents/intake-extractor";
import { assessReportScope } from "../../lib/agents/report-scope";
import { caseInputSchema } from "../../lib/contracts";

const base = { diseaseName: "Epithelioid sarcoma", goals: [] };

describe("caseInputSchema bounds", () => {
  it("normalizes a US state given as a code or a name, in any case", () => {
    for (const v of ["az", " AZ ", "Arizona", "arizona", "new  york"]) {
      expect(caseInputSchema.parse({ ...base, homeState: v }).homeState).toBe(v.toLowerCase().includes("new") ? "NY" : "AZ");
    }
  });
  it("rejects states that do not exist", () => {
    for (const v of ["ZZ", "Atlantis", "X", "Ontario", ""]) {
      expect(caseInputSchema.safeParse({ ...base, homeState: v }).success, v).toBe(false);
    }
  });
  it("rejects blank diagnosis and out-of-range or oversized values", () => {
    expect(caseInputSchema.safeParse({ ...base, diseaseName: "   " }).success).toBe(false);
    expect(caseInputSchema.safeParse({ ...base, diseaseName: "x".repeat(301) }).success).toBe(false);
    expect(caseInputSchema.safeParse({ ...base, stageSummary: "x".repeat(2_001) }).success).toBe(false);
    expect(caseInputSchema.safeParse({ ...base, travelLimitMiles: 2_147_483_648 }).success).toBe(false);
    expect(caseInputSchema.safeParse({ ...base, travelLimitMiles: -1 }).success).toBe(false);
    expect(caseInputSchema.safeParse({ ...base, travelLimitMiles: 600 }).success).toBe(true);
  });
  it("dedupes goals", () => {
    expect(caseInputSchema.parse({ ...base, goals: ["trial", "trial", "aid"] }).goals).toEqual(["trial", "aid"]);
    expect(caseInputSchema.safeParse({ ...base, goals: Array(6).fill("trial") }).success).toBe(false);
  });
});

describe("sanitizeExtraction", () => {
  it("drops unusable optional values instead of failing the extraction", () => {
    const out = sanitizeExtraction({ diseaseName: "A", homeState: "Ontario", travelLimitMiles: -4, insurer: "", planId: null, outOfScope: "maybe" });
    expect(out).toEqual({ diseaseName: "A" });
  });
});

describe("assessReportScope", () => {
  it("flags a child", () => {
    expect(assessReportScope("A 7-year-old girl with Ewing sarcoma")).toBe("pediatric");
    expect(assessReportScope("Age: 12. Diagnosis osteosarcoma")).toBe("pediatric");
    expect(assessReportScope("Infant with neuroblastoma")).toBe("pediatric");
    expect(assessReportScope("8-month-old with a tumor")).toBe("pediatric");
  });
  it("does not flag adults, or reports that also mention an adult age", () => {
    expect(assessReportScope("A 41-year-old man with vascular EDS")).toBeNull();
    expect(assessReportScope("A 38 year old mother of a 5-year-old, with epithelioid sarcoma")).toBeNull();
    expect(assessReportScope("Epithelioid sarcoma, proximal type. No age stated.")).toBeNull();
  });
});

describe("POST /api/cases scope refusal", () => {
  it("answers 422 with a polite message for a pediatric report, and creates nothing", async () => {
    const { POST } = await import("../../app/api/cases/route");
    process.env.WAYFINDER_SESSION_SECRET = "test-secret";
    const res = await POST(
      new Request("http://localhost/api/cases", {
        method: "POST",
        headers: { origin: "http://localhost", "content-type": "application/json" },
        body: JSON.stringify({ reportText: "Clinic summary: a 7-year-old girl with Ewing sarcoma of the femur, Boston, MA." }),
      }),
    );
    expect(res.status).toBe(422);
    expect(((await res.json()) as { error: string }).error).toMatch(/adult/i);
  });
});

describe("caseInputSchema text hygiene", () => {
  it("strips NUL / control characters and lone surrogates that Postgres would reject", () => {
    const parsed = caseInputSchema.parse({ ...base, diseaseName: "Ehlers\u0000-Danlos\u0007 \ud800syndrome", insurer: "A\u0000B" });
    expect(parsed.diseaseName).toBe("Ehlers-Danlos �syndrome");
    expect(parsed.insurer).toBe("AB");
  });
  it("keeps unicode, RTL, emoji and newlines in free text", () => {
    const parsed = caseInputSchema.parse({ ...base, diseaseName: "سرطان 🧬", stageSummary: "line1\nline2​" });
    expect(parsed.diseaseName).toBe("سرطان 🧬");
    expect(parsed.stageSummary).toBe("line1\nline2​");
  });
});

describe("patient note hygiene", () => {
  it("strips NUL bytes from a note before it can reach Postgres", async () => {
    const { patientNoteSchema } = await import("../../lib/contracts/case-docs");
    const parsed = patientNoteSchema.parse({ title: "a\u0000b", text: "x\u0000y", sharedField: "diseaseName" });
    expect([parsed.title, parsed.text]).toEqual(["ab", "xy"]);
  });
});
