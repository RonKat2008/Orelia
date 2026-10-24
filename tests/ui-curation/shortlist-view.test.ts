import { describe, expect, it } from "vitest";
import {
  normalizeShortlist,
  orderByPreview,
  previewShortlist,
  type ShortlistCard,
} from "../../components/shortlist/data";
import { sharingKind } from "../../components/case-docs/data";
import {
  contactDoorOf,
  filtersToQuery,
  matchesFilters,
  parseFilters,
  NO_FILTERS,
} from "../../components/shortlist/view-model";

const fetchedAt = "2026-10-23T12:00:00.000Z";

describe("live shortlist route shape", () => {
  const payload = normalizeShortlist({
    caseId: "c",
    groups: {
      expert: [],
      institution: [
        {
          targetKind: "institution",
          targetId: "inst-1",
          name: "Example Center",
          rank: 1,
          score: 40,
          selected: false,
          tier: "best",
          tierReasons: [{ text: "Dedicated program", evidenceIds: ["e1"] }],
          breakdown: [
            {
              factor: "contactability",
              points: 10,
              text: "Public intake line",
              evidenceIds: ["e1"],
            },
          ],
          evidence: [
            {
              id: "e1",
              claimType: "disease_program",
              claim: "Program page",
              sourceUrl: "https://example.org/p",
              sourceKind: "exa",
              fetchedAt,
            },
            {
              id: "bad",
              claimType: "x",
              claim: "no url",
              sourceUrl: "nope",
              sourceKind: "exa",
              fetchedAt,
            },
          ],
        },
      ],
      trial: [],
      organization: [
        {
          targetKind: "organization",
          targetId: "org-1",
          name: "Travel Fund",
          rank: 1,
          score: 9,
          selected: false,
          tier: "backup",
          tierReasons: [],
          breakdown: [],
          evidence: [
            {
              id: "e2",
              claimType: "travel_aid_program",
              claim: "Grants",
              sourceUrl: "https://example.org/t",
              sourceKind: "exa",
              fetchedAt,
            },
          ],
        },
      ],
    },
    curationSummary: null,
    suggested: [
      { targetKind: "institution", targetId: "inst-1", name: "Example Center" },
    ],
  });

  it("adapts slim rows, drops evidence without a valid source and keeps suggestions", () => {
    expect(payload?.items).toHaveLength(2);
    expect(payload?.items[0].evidence).toHaveLength(1);
    expect(payload?.items[0].group).toBe("specialists");
    expect(payload?.items[1].group).toBe("aid");
    expect(payload?.suggested).toEqual(["inst-1"]);
  });

  it("reads the contact door only from code-stamped contact_point evidence, never a program page", () => {
    const base = payload!.items[0];
    const row = (claimType: string, claim: string, sourceKind: "exa" | "nppes" = "exa") => ({
      id: claimType,
      claimType,
      claim,
      sourceUrl: "https://example.org/p",
      sourceKind,
      fetchedAt,
    });
    const withEvidence = (evidence: ShortlistCard["evidence"]) => ({
      ...base,
      // Scoring text claiming a door must not matter.
      breakdown: [{ factor: "contactability", points: 6, text: "Public intake line", evidenceIds: ["e1"] }],
      evidence,
    });
    expect(contactDoorOf(withEvidence([row("program_page", "https://example.org/p")]))).toEqual({
      found: false,
      text: "",
    });
    expect(contactDoorOf(withEvidence([row("contact_point.email.new_patient_line", "intake@example.org")]))).toEqual({
      found: true,
      text: "Email found",
    });
    expect(contactDoorOf(withEvidence([row("contact_point.voice.nppes_location_phone", "+16176323000", "nppes")])).text).toBe(
      "Phone found",
    );
    expect(contactDoorOf(withEvidence([row("contact_point.web_form.intake_form", "https://example.org/form")]))).toEqual({
      found: true,
      text: "Online intake form found",
    });
  });

  it("filters by travel aid, and by state only when one is known", () => {
    const [center, fund] = payload!.items;
    expect(matchesFilters(fund, { ...NO_FILTERS, travel: true }, null)).toBe(
      true,
    );
    expect(matchesFilters(center, { ...NO_FILTERS, travel: true }, null)).toBe(
      false,
    );
    expect(matchesFilters(center, { ...NO_FILTERS, inState: true }, null)).toBe(
      false,
    );
    expect(
      matchesFilters(
        previewShortlist[0],
        { ...NO_FILTERS, kind: "trials" },
        null,
      ),
    ).toBe(false);
  });
});

describe("filters as URL state", () => {
  it("round-trips and omits defaults", () => {
    expect(filtersToQuery(NO_FILTERS)).toBe("");
    const query = filtersToQuery({
      kind: "trials",
      inState: true,
      travel: false,
    });
    expect(query).toBe("kind=trials&instate=1");
    expect(parseFilters(new URLSearchParams(query))).toEqual({
      kind: "trials",
      inState: true,
      travel: false,
    });
    expect(parseFilters(new URLSearchParams("kind=bogus")).kind).toBe("all");
  });
});

describe("order preview and sharing kind", () => {
  it("sorts by preview rank without mutating the input", () => {
    const cards = previewShortlist.slice(0, 2);
    const ranked = orderByPreview(cards, {
      [cards[0].resource.id]: 2,
      [cards[1].resource.id]: 1,
    });
    expect(ranked.map((c) => c.resource.id)).toEqual([
      cards[1].resource.id,
      cards[0].resource.id,
    ]);
    expect(cards[0].resource.id).not.toBe(ranked[0].resource.id);
  });

  it("classifies sharing", () => {
    expect(sharingKind({ kind: "intake_report", sharedField: null })).toBe(
      "never",
    );
    expect(sharingKind({ kind: "patient_note", sharedField: "city" })).toBe(
      "consented",
    );
    expect(sharingKind({ kind: "public_resource", sharedField: null })).toBe(
      "public",
    );
  });
});
