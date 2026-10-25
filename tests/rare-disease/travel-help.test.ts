import { describe, expect, it } from "vitest";
import { buildTravelHelp, type TravelOrganization } from "@/lib/rare-disease/travel-help";

const org = (overrides: Partial<TravelOrganization>): TravelOrganization => ({
  targetId: "o1",
  name: "Air Care Alliance",
  organizationKind: "travel_aid",
  evidence: [{ sourceUrl: "https://aircarealliance.org/" }],
  ...overrides,
});

const near = { name: "Dr. A", miles: 420, travelLimitMiles: 300, withinTravelLimit: false, href: "https://example.org/a" };

describe("buildTravelHelp", () => {
  it("lists travel and money help with links, and skips other organizations", () => {
    const help = buildTravelHelp({
      organizations: [
        org({}),
        org({ targetId: "o2", name: "PAN Foundation", organizationKind: "financial_aid", evidence: [{ sourceUrl: "https://www.panfoundation.org/" }] }),
        org({ targetId: "o3", name: "Some Society", organizationKind: "advocacy" }),
        org({ targetId: "o4", name: "No kind", organizationKind: null }),
      ],
      nearest: near,
    });
    expect(help.items.map((i) => [i.name, i.kind, i.href])).toEqual([
      ["Air Care Alliance", "travel_aid", "https://aircarealliance.org/"],
      ["PAN Foundation", "financial_aid", "https://www.panfoundation.org/"],
    ]);
  });

  it("never lists an organization without a safe link", () => {
    const help = buildTravelHelp({
      organizations: [org({ evidence: [] }), org({ targetId: "o2", evidence: [{ sourceUrl: "javascript:alert(1)" }] })],
      nearest: null,
    });
    expect(help.items).toEqual([]);
    expect(help.show).toBe(false);
  });

  it("dedupes by name and carries the nearest distance against the travel limit", () => {
    const help = buildTravelHelp({ organizations: [org({}), org({ targetId: "o9" })], nearest: near });
    expect(help.items).toHaveLength(1);
    expect(help.nearest).toEqual(near);
    expect(help.show).toBe(true);
  });

  it("shows when the nearest expert is beyond the limit even with no organizations", () => {
    expect(buildTravelHelp({ organizations: [], nearest: near }).show).toBe(true);
    expect(buildTravelHelp({ organizations: [], nearest: { ...near, miles: 50, withinTravelLimit: true } }).show).toBe(false);
  });
});
