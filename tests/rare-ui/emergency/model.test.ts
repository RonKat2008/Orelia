import { describe, expect, it } from "vitest";
import { buildCard } from "@/lib/rare-disease/emergency/filter";
import { approvalState, approveRecord, emptyRecord, withInputs } from "@/lib/rare-disease/emergency/approval";
import { buildSheetModel, canonicalJson, escapeHtml, renderSheetHtml, sheetHash, EMERGENCY_DISCLAIMER } from "@/components/rare/emergency/model";
import { emergencyKey, loadRecord, saveRecord, type KeyValueStore } from "@/components/rare/emergency/store";
import { CASE_A, documents, events, inputs, needs } from "../../rare-disease/emergency/fixtures";

const NOW = new Date("2026-10-24T12:00:00.000Z");
const content = (i = inputs) => buildCard({ caseId: CASE_A, undiagnosed: false, needs, events, documents, inputs: i }).content;

function fakeStore(seed: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } {
  const data = { ...seed };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
}

describe("buildSheetModel and renderSheetHtml", () => {
  it("keeps only filtered lines and carries the disclaimer", () => {
    const model = buildSheetModel(content(), "Condition X", NOW.toISOString());
    const text = JSON.stringify(model);
    expect(text).not.toContain("seek emergency care");
    expect(model.disclaimer).toBe(EMERGENCY_DISCLAIMER);
    expect(model.approvedOn).toBe("2026-10-24");
    expect(model.sections.map((s) => s.heading)).toContain("My contacts");
  });

  it("escapes markup in the saved file and has no scripts", () => {
    const html = renderSheetHtml({ ...buildSheetModel(content(), "<b>X</b>", null) });
    expect(html).not.toContain("<b>X</b>");
    expect(html).toContain("&lt;b&gt;X&lt;/b&gt;");
    expect(html).not.toContain("<script");
    expect(escapeHtml(`a&"'<`)).toBe("a&amp;&quot;&#39;&lt;");
  });
});

describe("sheetHash", () => {
  it("is stable, ignores key order, and changes with the content or condition", async () => {
    const a = await sheetHash(content(), "X");
    expect(await sheetHash(content(), "X")).toBe(a);
    expect(await sheetHash(content(), "Y")).not.toBe(a);
    expect(await sheetHash(content({ ...inputs, contacts: [] }), "X")).not.toBe(a);
    expect(canonicalJson({ b: 1, a: 2 })).toBe(canonicalJson({ a: 2, b: 1 }));
  });

  it("ties approval to the hash: edited contacts need a new approval", async () => {
    const c = content();
    const h = await sheetHash(c, "X");
    const rec = withInputs(emptyRecord(NOW), inputs, NOW);
    const done = approveRecord(rec, c, { version: rec.version, contentHash: h }, NOW, () => h);
    if (!done.ok) throw new Error(done.error);
    expect(approvalState(done.record, h)).toBe("approved");
    const h2 = await sheetHash(content({ ...inputs, contacts: [] }), "X");
    expect(approvalState(done.record, h2)).toBe("changed");
  });
});

describe("local store", () => {
  it("round-trips a record per case", () => {
    const s = fakeStore();
    const rec = withInputs(emptyRecord(NOW), inputs, NOW);
    expect(saveRecord(s, CASE_A, rec)).toBe(true);
    expect(loadRecord(s, CASE_A, NOW)).toEqual(rec);
    expect(loadRecord(s, "other", NOW).inputs.contacts).toEqual([]);
  });

  it("reads broken or tampered values as a fresh unapproved record", () => {
    for (const bad of ["{", JSON.stringify({ version: 1, approval: { x: 1 } })]) {
      const rec = loadRecord(fakeStore({ [emergencyKey(CASE_A)]: bad }), CASE_A, NOW);
      expect(rec.approval).toBeNull();
    }
  });

  it("reports a blocked store", () => {
    const blocked: KeyValueStore = { getItem: () => null, setItem: () => { throw new Error("full"); } };
    expect(saveRecord(blocked, CASE_A, emptyRecord(NOW))).toBe(false);
    expect(saveRecord(null, CASE_A, emptyRecord(NOW))).toBe(false);
  });
});
