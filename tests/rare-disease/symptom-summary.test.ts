import { describe, expect, it } from "vitest";
import { buildSymptomSummary, MAX_SYMPTOM_QUOTES, type SymptomSummaryInput } from "@/lib/rare-disease/symptom-summary";
import type { HistoryDocument, HistoryEvent } from "@/lib/history";

const CASE_ID = "22222222-2222-4222-8222-222222222222";

const doc = (id: string, title: string, text: string, createdAt = "2026-03-04T10:00:00.000Z"): HistoryDocument => ({
  id, caseId: CASE_ID, title, docType: "visit_note", text, createdAt, extractedBy: "rules",
});

const event = (overrides: Partial<HistoryEvent>): HistoryEvent => ({
  id: "ev1", date: "2025-01-02", kind: "note", title: "t", provider: null, institution: null, findings: [], sourceDocId: "d1", span: { start: 0, end: 1 }, ...overrides,
});

const NOTES = "My joints hurt every morning. I like gardening. I get dizzy when I stand up. It could be lupus, my aunt said.";
const DOC_TEXT = "Patient seen for follow up. Reports fatigue most days and trouble climbing stairs. Findings are consistent with Marfan syndrome. Blood pressure was normal.";

function input(overrides: Partial<SymptomSummaryInput> = {}): SymptomSummaryInput {
  return { caseId: CASE_ID, symptomNotes: NOTES, documents: [doc("d1", "Clinic visit", DOC_TEXT)], events: [], ...overrides };
}

const sourceTexts = (i: SymptomSummaryInput) => [i.symptomNotes ?? "", ...i.documents.map((d) => d.text)];

describe("buildSymptomSummary", () => {
  it("is extractive: every quote is a substring of a source text", () => {
    const i = input();
    const summary = buildSymptomSummary(i);
    expect(summary.quotes.length).toBeGreaterThan(0);
    for (const q of summary.quotes) expect(sourceTexts(i).some((t) => t.includes(q.text)), q.text).toBe(true);
  });

  it("keeps symptom sentences and drops the rest", () => {
    const texts = buildSymptomSummary(input()).quotes.map((q) => q.text);
    expect(texts).toContain("My joints hurt every morning.");
    expect(texts).toContain("I get dizzy when I stand up.");
    expect(texts).toContain("Reports fatigue most days and trouble climbing stairs.");
    expect(texts).not.toContain("I like gardening.");
    expect(texts).not.toContain("Blood pressure was normal.");
  });

  it("drops sentences that guess or name a diagnosis", () => {
    const all = JSON.stringify(buildSymptomSummary(input()));
    expect(all).not.toMatch(/lupus/i);
    expect(all).not.toMatch(/Marfan/);
    expect(all).not.toMatch(/consistent with/i);
  });

  it("cites the patient's own words and each document with title, date and a history link", () => {
    const quotes = buildSymptomSummary(input()).quotes;
    const own = quotes.find((q) => q.text.startsWith("My joints"));
    expect(own?.citation).toEqual({ label: "Your answers", href: `/cases/${CASE_ID}/documents` });
    const fromDoc = quotes.find((q) => q.text.startsWith("Reports fatigue"));
    expect(fromDoc?.citation).toEqual({ label: "Clinic visit, 2026-03-04", href: `/cases/${CASE_ID}/history` });
  });

  it("never uses text from diagnosis events", () => {
    const text = "Diagnosis note: severe pain in both hands. Ongoing headaches at night.";
    const start = 0;
    const end = text.indexOf("Ongoing");
    const summary = buildSymptomSummary(
      input({ symptomNotes: "", documents: [doc("d1", "Letter", text)], events: [event({ kind: "diagnosis", span: { start, end } })] }),
    );
    expect(summary.quotes.map((q) => q.text)).toEqual(["Ongoing headaches at night."]);
  });

  it("uses verbatim findings of non-diagnosis events", () => {
    const text = "Seen today.\nSwelling in left ankle\nNo other notes";
    const summary = buildSymptomSummary(
      input({ symptomNotes: "", documents: [doc("d1", "Visit", text)], events: [event({ kind: "specialist_visit", findings: ["Swelling in left ankle", "invented finding pain"] })] }),
    );
    expect(summary.quotes.map((q) => q.text)).toEqual(["Swelling in left ankle"]);
  });

  it("dedupes and caps the quotes", () => {
    const many = Array.from({ length: 12 }, (_, n) => `My pain number ${n} is bad.`).join(" ");
    const summary = buildSymptomSummary(input({ symptomNotes: `${many} My pain number 1 is bad.`, documents: [] }));
    expect(summary.quotes).toHaveLength(MAX_SYMPTOM_QUOTES);
    expect(new Set(summary.quotes.map((q) => q.text)).size).toBe(MAX_SYMPTOM_QUOTES);
  });

  it("returns no quotes when there is nothing to quote", () => {
    expect(buildSymptomSummary({ caseId: CASE_ID, documents: [], events: [] }).quotes).toEqual([]);
  });

  it("does not change its inputs", () => {
    const i = input();
    const before = JSON.stringify(i);
    buildSymptomSummary(i);
    expect(JSON.stringify(i)).toBe(before);
  });
});
