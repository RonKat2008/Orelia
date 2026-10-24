import { describe, expect, it } from "vitest";
import { assessTrial, enrollsAdults, parseAgeYears } from "@/lib/agents/relevance";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import { hasRecruitingUsSite, recruitingFirst, registryFacts } from "@/lib/agents/research/trials";
import type { CtgovStudy } from "@/lib/agents/research/source-ports";

const US = /^united states$/i;
const load = () => createFixturePorts().ctgov.recruitingStudies({ condition: "epithelioid sarcoma" });
const usSites = (s: CtgovStudy) => s.sites.filter((x) => x.country && US.test(x.country));

describe("CT.gov recruiting status (recorded epithelioid-sarcoma fixture)", () => {
  it("NCT04390737 (HH2853) is RECRUITING overall but has no recruiting U.S. site, so it is not surfaced", async () => {
    const studies = await load();
    const hh = studies.find((s) => s.nctId === "NCT04390737")!;
    expect(hh.status).toBe("RECRUITING");
    expect(usSites(hh).map((s) => s.status)).toEqual(["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED"]);
    expect(registryFacts(hh, usSites(hh)).usRecruitingSiteCount).toBe(0);
    expect(hasRecruitingUsSite(usSites(hh))).toBe(false);
  });

  it("every other fixture study with U.S. sites has a recruiting U.S. site", async () => {
    const studies = (await load()).filter((s) => s.nctId !== "NCT04390737" && usSites(s).length > 0);
    expect(studies.length).toBeGreaterThanOrEqual(5);
    for (const s of studies) expect(hasRecruitingUsSite(usSites(s)), s.nctId).toBe(true);
  });

  it("treats a site with no stated status as unknown, and lists recruiting sites first", () => {
    expect(hasRecruitingUsSite([{ facility: "A" }])).toBe(true);
    expect(hasRecruitingUsSite([{ status: "ACTIVE_NOT_RECRUITING" }, { status: "WITHDRAWN" }])).toBe(false);
    const sorted = recruitingFirst([{ facility: "a", status: "COMPLETED" }, { facility: "b", status: "RECRUITING" }]);
    expect(sorted.map((s) => s.facility)).toEqual(["b", "a"]);
  });
});

describe("adult-only filter", () => {
  it.each([
    ["12 Years", 12], ["6 Months", 0.5], ["18 Years", 18], ["30 Years", 30], ["N/A", undefined], ["", undefined], [undefined, undefined],
  ])("parseAgeYears(%j)", (input, years) => {
    expect(parseAgeYears(input)).toBe(years);
  });

  it.each([
    ["ADULT only", ["ADULT", "OLDER_ADULT"], "18 Years", undefined, true],
    ["child + adult + older, no bounds", ["CHILD", "ADULT", "OLDER_ADULT"], undefined, undefined, true],
    ["child + adult, 6 Months to 25 Years", ["CHILD", "ADULT"], "6 Months", "25 Years", true],
    ["child + adult, up to 30 Years", ["CHILD", "ADULT"], undefined, "30 Years", true],
    ["CHILD only", ["CHILD"], "6 Months", undefined, false],
    ["maximum age 17 beats a stale ADULT tag", ["CHILD", "ADULT"], "1 Year", "17 Years", false],
    ["maximum 17 years, N/A minimum", ["CHILD"], "N/A", "17 Years", false],
    ["maximum 18 Years still enrolls 18-year-olds", ["CHILD", "ADULT"], "12 Years", "18 Years", true],
    ["no stdAges, min 65 Years", [], "65 Years", undefined, true],
    ["no stdAges, nothing parsable", [], "N/A", "N/A", undefined],
  ])("enrollsAdults: %s", (_l, stdAges, minimumAge, maximumAge, expected) => {
    expect(enrollsAdults({ stdAges, minimumAge, maximumAge })).toBe(expected);
  });

  it("applies to the recorded fixture trials (mixed kept, adult kept, none are child-only)", async () => {
    const studies = await load();
    const verdicts = Object.fromEntries(
      studies.map((s) => {
        const reg = registryFacts(s, usSites(s));
        return [s.nctId, enrollsAdults({ stdAges: reg.stdAges, minimumAge: reg.minimumAge, maximumAge: reg.maximumAge })];
      }),
    );
    expect(verdicts["NCT06625190"]).toBe(true); // CHILD+ADULT, 6 Months - 25 Years
    expect(verdicts["NCT07734116"]).toBe(true); // CHILD+ADULT+OLDER, min 12 Years
    expect(verdicts["NCT06239272"]).toBe(true); // CHILD+ADULT, max 30 Years
    expect(verdicts["NCT04390737"]).toBe(true);
    expect(Object.values(verdicts).every((v) => v === true)).toBe(true);
  });

  it("assessTrial drops a fixture trial whose maximum age is under 18", async () => {
    const s = (await load()).find((x) => x.nctId === "NCT06625190")!;
    const reg = registryFacts(s, usSites(s));
    const ok = assessTrial({ title: s.title, registry: reg }, { diseaseName: "Epithelioid sarcoma", subtype: undefined });
    expect(ok.reason ?? "").not.toMatch(/adults/);
    const young = assessTrial({ title: s.title, registry: { ...reg, maximumAge: "17 Years" } }, { diseaseName: "Epithelioid sarcoma", subtype: undefined });
    expect(young.keep).toBe(false);
    expect(young.reason).toMatch(/does not enroll adults/);
  });
});
