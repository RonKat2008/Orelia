import { describe, expect, it } from "vitest";
import { resolveJourney } from "../../components/journey/model";
import {
  addPatientNote,
  groupDocuments,
  loadDocuments,
  previewDocuments,
  sharingLine,
} from "../../components/case-docs/data";
import {
  bandShortlist,
  evidenceForReason,
  initialSelection,
  normalizeShortlist,
  previewShortlist,
  type ShortlistCard,
} from "../../components/shortlist/data";

const caseId = "11111111-1111-4111-8111-111111111111";

function curatedCard(tier: ShortlistCard["tier"], id: string): ShortlistCard {
  const base = previewShortlist[0];
  return {
    ...base,
    tier,
    tierReasons: [{ text: "Cited publication", evidenceIds: ["ev-papers"] }],
    resource: { ...base.resource, id },
    evidence: base.evidence.map((item, index) => (index === 0 ? { ...item, id: "ev-papers" } : item)),
  };
}

describe("shortlist curation", () => {
  it("keeps an older shortlist as one ranked list", () => {
    const bands = bandShortlist(previewShortlist);
    expect(bands.curated).toBe(false);
    expect(bands.listed).toHaveLength(previewShortlist.length);
    expect(bands.best).toHaveLength(0);
  });

  it("splits best fits from excluded rows and reads optional curator fields", () => {
    const payload = normalizeShortlist({
      curationSummary: "Two strongest matches.",
      suggested: ["best-1", "missing", "best-1"],
      items: [curatedCard("best", "best-1"), curatedCard("exclude", "drop-1"), curatedCard("good", "good-1")].map(
        (card) => ({
          resource: card.resource,
          score: card.score,
          breakdown: card.breakdown,
          evidence: card.evidence,
          tier: card.tier,
          tierReasons: card.tierReasons,
        }),
      ),
    });
    expect(payload?.curationSummary).toBe("Two strongest matches.");
    expect(payload?.suggested).toEqual(["best-1"]);
    const bands = bandShortlist(payload?.items ?? []);
    expect(bands.best.map((card) => card.resource.id)).toEqual(["best-1"]);
    expect(bands.listed.map((card) => card.resource.id)).toEqual(["good-1"]);
    expect(bands.excluded.map((card) => card.resource.id)).toEqual(["drop-1"]);
    expect(evidenceForReason(bands.best[0], ["ev-papers"])).toHaveLength(1);
    expect(evidenceForReason(bands.best[0], ["missing"])).toHaveLength(0);
  });

  it("pre-selects at most five suggestions unless the patient already chose", () => {
    expect(initialSelection(null, ["a", "b", "c", "d", "e", "f"], 5)).toEqual(["a", "b", "c", "d", "e"]);
    expect(initialSelection(["saved"], ["a"], 5)).toEqual(["saved"]);
  });
});

describe("case documents", () => {
  it("states sharing limits by kind", () => {
    expect(sharingLine(previewDocuments[0])).toBe("Never shared");
    expect(sharingLine(previewDocuments[1])).toBe("Public resource info");
    expect(sharingLine(previewDocuments[2])).toBe("Shared only with contacts you consent to condition name");
    expect(groupDocuments(previewDocuments).map((group) => group.kind)).toEqual([
      "intake_report",
      "public_resource",
      "patient_note",
    ]);
  });

  it("uses the documents API when it answers and a fixture when it does not", async () => {
    const live = await loadDocuments(caseId, async () =>
      new Response(JSON.stringify({ documents: [] }), { status: 200 }),
    );
    expect(live.status).toBe("empty");

    const missing = await loadDocuments(caseId, async () => {
      throw new Error("offline");
    });
    expect(missing.status).toBe("ready");
    if (missing.status === "ready") expect(missing.preview).toBe(true);

    const failed = await loadDocuments(caseId, async () => new Response("no", { status: 500 }));
    expect(failed.status).toBe("error");
  });

  it("posts a patient note and keeps a local copy when the route is absent", async () => {
    const saved = await addPatientNote(
      caseId,
      { title: "Travel limit", text: "I can travel within 200 miles.", sharedField: "home city" },
      async () => new Response("missing", { status: 404 }),
    );
    expect("document" in saved && saved.document.kind).toBe("patient_note");
    expect("document" in saved && saved.document.sharedField).toBe("home city");
    expect("document" in saved && saved.preview).toBe(true);
  });
});

describe("journey documents link", () => {
  it("points at the case documents page without changing the current step", () => {
    const plan = resolveJourney(caseId, {
      status: "ready",
      selectedCount: 0,
      openTaskCount: 0,
      contacts: [],
    });
    expect(plan.current).toBe("shortlist");
    expect(plan.documentsHref).toBe(`/cases/${caseId}/documents`);
  });
});
