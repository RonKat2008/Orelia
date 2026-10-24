import { describe, expect, it } from "vitest";
import { dedupeDocuments, documentLabel, humanizeTitle, sharedContactCount, type CaseDocument } from "@/components/case-docs/data";

const doc = (id: string, title: string, sharedField: string | null, contactId: string | null = null): CaseDocument => ({
  id, kind: "case_summary", title, sharedField, contactId, createdAt: "2026-10-24T00:00:00.000Z",
});

describe("document labels", () => {
  it("maps raw field keys to plain labels", () => {
    expect(humanizeTitle("HomeCity")).toBe("Your city");
    expect(humanizeTitle("diseaseName")).toBe("Your condition");
    expect(humanizeTitle("HomeState")).toBe("Your state");
    expect(documentLabel(doc("1", "x", "homeCity"))).toBe("Your city");
  });
  it("splits camelCase and strips trailing ids", () => {
    expect(humanizeTitle("experts.authorship")).toBe("Experts authorship");
    expect(humanizeTitle("Letter — a b (5b27bb4f-e4a0-4965-9d2c-c0292dd0128e)")).toBe("Letter — a b");
  });
  it("dedupes copies and counts distinct contacts", () => {
    const docs = [doc("1", "HomeCity", "homeCity", "c1"), doc("2", "homeCity", "homeCity", "c2"), doc("3", "DiseaseName", "diseaseName")];
    expect(dedupeDocuments(docs).map((d) => d.id)).toEqual(["1", "3"]);
    expect(sharedContactCount(docs, docs[0])).toBe(2);
  });
});
