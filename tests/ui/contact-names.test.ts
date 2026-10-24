import { describe, expect, it } from "vitest";
import { namesFromShortlist, withDisplayNames } from "@/components/outreach/case-activity";
import type { ApiContact } from "@/components/outreach/client";

const base: ApiContact = {
  id: "c1", caseId: "k", targetId: "t1", targetKind: "trial", channel: "voice", address: "+15555550100", state: "drafted",
};

describe("withDisplayNames", () => {
  it("fills a missing displayName from the live contacts list by contact id", () => {
    const out = withDisplayNames([base], [{ ...base, displayName: "Celiprolol trial" }]);
    expect(out[0].displayName).toBe("Celiprolol trial");
  });

  it("keeps an existing name and does not mutate the input", () => {
    const named = { ...base, displayName: "Kept" };
    const out = withDisplayNames([named], [{ ...base, displayName: "Other" }]);
    expect(out[0].displayName).toBe("Kept");
    expect(withDisplayNames([base], null)[0]).toEqual(base);
    expect(base.displayName).toBeUndefined();
  });
});

describe("namesFromShortlist", () => {
  it("maps case candidate ids to resource names across groups", () => {
    const names = namesFromShortlist({
      groups: {
        institution: [{ caseCandidateId: "cc1", name: "Cleveland Clinic" }],
        organization: [{ caseCandidateId: "cc2", name: "NORD" }, { name: "no id" }],
      },
    });
    expect(names.get("cc1")).toBe("Cleveland Clinic");
    expect(names.get("cc2")).toBe("NORD");
    expect(names.size).toBe(2);
  });

  it("returns an empty map for anything malformed", () => {
    expect(namesFromShortlist(null).size).toBe(0);
    expect(namesFromShortlist({ groups: "x" }).size).toBe(0);
  });
});
