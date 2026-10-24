import { describe, expect, it } from "vitest";
import { resolveSources, rowBadge, rowMeta, safeHref, verdictView, channelLabel, refreshMessage } from "@/components/experts/view-model";
import { badgeViews, canVerifyByPhone, reasonText, resourceKeyOf, sharedFieldsFor, statusText, verifyQuestions } from "@/components/shortlist/verify-model";
import type { ShortlistCard } from "@/components/shortlist/data";

const row = (id: string, sourceUrl: string) =>
  ({ id, claimType: "experts.affiliation", claim: "c", sourceUrl, sourceKind: "pubmed", fetchedAt: "2026-10-23T12:00:00.000Z", targetKind: "expert", targetId: "e1" }) as never;

describe("experts view model", () => {
  it("only allows http(s) links", () => {
    expect(safeHref("https://a.org/x")).toBe("https://a.org/x");
    expect(safeHref("javascript:alert(1)")).toBeNull();
    expect(safeHref(null)).toBeNull();
    expect(safeHref("not a url")).toBeNull();
  });

  it("resolves evidence ids, dedupes and counts unresolved ones", () => {
    const trace = { evidence: [row("a", "https://a.org"), row("b", "javascript:x")] };
    const { links, missing } = resolveSources(trace, ["a", "a", "b", "zzz"]);
    expect(links.map((l) => l.id)).toEqual(["a"]);
    expect(missing).toBe(2);
  });

  it("renders unknown as neutral, never negative", () => {
    expect(verdictView("sees", "unknown")).toEqual({ label: "Not confirmed yet", tone: "neutral" });
    expect(verdictView("consult", "unknown").tone).toBe("neutral");
    expect(verdictView("sees", "yes").tone).toBe("ok");
  });

  it("labels channels", () => {
    expect(channelLabel("voice")).toBe("Phone");
  });

  it("shows at most one fact on a row: only a documented 'sees patients' earns a badge", () => {
    const base = { seesPatients: { verdict: "unknown", text: "", evidenceIds: [] } };
    expect(rowBadge(base as never)).toBeNull();
    expect(rowBadge({ seesPatients: { ...base.seesPatients, verdict: "no" } } as never)).toBeNull();
    expect(rowBadge({ seesPatients: { ...base.seesPatients, verdict: "yes" } } as never)?.tone).toBe("ok");
  });

  it("summarises a row as workplace and paper count", () => {
    const chain = { institution: { name: "Northgate", pageUrl: null, evidenceIds: [] }, paper: { pmid: "1" }, papers: [{ pmid: "1" }, { pmid: "2" }] };
    expect(rowMeta(chain as never)).toBe("Northgate · 2 papers");
    expect(rowMeta({ ...chain, institution: { name: null } } as never)).toMatch(/not confirmed yet/);
  });
});

describe("verification view model", () => {
  const card = (kind: "expert" | "organization", evidence: unknown[]) =>
    ({ resource: { kind, id: "x1", name: "N" }, evidence }) as unknown as ShortlistCard;

  it("keys resources as kind:id", () => {
    expect(resourceKeyOf(card("expert", []))).toBe("expert:x1");
  });

  it("offers phone verification only for experts/institutions without needing evidence for others", () => {
    expect(canVerifyByPhone(card("organization", []))).toBe(false);
    expect(canVerifyByPhone(card("expert", []))).toBe(false);
  });

  it("lists six questions and shared fields", () => {
    expect(verifyQuestions()).toHaveLength(6);
    expect(sharedFieldsFor(false)).toEqual(["diseaseName"]);
    expect(sharedFieldsFor(true)).toEqual(["diseaseName", "insurer"]);
  });

  it("maps reason codes to plain text", () => {
    expect(reasonText("contact_cap")).toMatch(/Five contacts/);
    expect(reasonText("weird")).toMatch(/safety check/);
    expect(statusText({ status: "blocked", blockedReasons: ["not_approved"] })).toMatch(/Blocked before dialing/);
    expect(statusText({ status: "awaiting_approval", blockedReasons: [] })).toMatch(/Nothing has been dialed/);
  });

  it("attaches the callee quote to a badge", () => {
    const badge = { resourceKey: "expert:x1", key: "new_adult_patients", value: "yes", label: "Verified", verifiedAt: "2026-10-24T00:00:00.000Z", evidenceId: "ev1" } as never;
    const request = { resourceKey: "expert:x1", result: { answers: [{ key: "new_adult_patients", value: "yes", quote: "Yes we do", detail: null, turnIndex: 1 }] } } as never;
    expect(badgeViews([badge], [request])).toEqual([{ id: "ev1", text: "Verified", quote: "Yes we do" }]);
    expect(badgeViews(undefined, [])).toEqual([]);
  });
});

describe('refreshMessage', () => {
  it('names what was found and that nobody was contacted', () => {
    expect(refreshMessage({ affiliations: 2, contactPoints: 1 })).toBe('Research refreshed: found 2 affiliations and 1 phone or email contact. Nobody was contacted.');
    expect(refreshMessage({ affiliations: 0, contactPoints: 0 })).toBe('Research refreshed. Nobody was contacted.');
  });
});
