import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { matchIdentity } from "@/lib/identity/match";
import type { NppesProvider } from "@/lib/sources/nppes";

const author = { firstName: "Jane", lastName: "Smith", affiliation: "Medical Center, Phoenix, Arizona, USA" };
const provider = (overrides: Partial<NppesProvider> = {}): NppesProvider => ({
  number: "1234567890", enumeration_type: "NPI-1", basic: { first_name: "JANE", last_name: "SMITH", status: "A" },
  taxonomies: [{ code: "207RX0202X", desc: "Medical Oncology", primary: true }],
  addresses: [{ address_purpose: "LOCATION", city: "PHOENIX", state: "AZ" }], ...overrides,
});
const match = (p: NppesProvider[], a = author) => matchIdentity(a, p, "Epithelioid sarcoma");

describe("deterministic identity", () => {
  it("verifies only corroborated active disease-relevant clinicians", () => {
    expect(match([provider()])).toMatchObject({ status: "verified", verified: true, npi: "1234567890", summary: "NPI verified: Medical Oncology, PHOENIX AZ, matches affiliation" });
  });
  it.each([
    ["epithelioid-sarcoma/li-liping", "Liping", "Li", "sarcoma"],
  ])("rejects recorded trainee %s", (path, firstName, lastName, disease) => {
    const data = JSON.parse(readFileSync(`fixtures/api/nppes/${path}.json`, "utf8"));
    const verdict = matchIdentity({ firstName, lastName, affiliation: "Geisinger, Danville, PA" }, data.results, disease);
    expect(verdict.status).toBe("rejected");
    expect(verdict.reasons.join(" ")).toMatch(/trainee/);
    expect(verdict.npi).toBeUndefined();
  });
  it.each([
    ["epithelioid-sarcoma/ambiguous-smith", "John", "Smith", "sarcoma"],
    ["vascular-eds/ambiguous-johnson", "David", "Johnson", "vascular EDS"],
    ["igg4-related-disease/ambiguous-williams", "Robert", "Williams", "IgG4-related disease"],
  ])("never guesses a recorded namesake %s", (path, firstName, lastName, disease) => {
    const data = JSON.parse(readFileSync(`fixtures/api/nppes/${path}.json`, "utf8"));
    const verdict = matchIdentity({ firstName, lastName }, data.results, disease);
    expect(verdict.verified).toBe(false);
    expect(verdict.npi).toBeUndefined();
  });
  it("requires city and state on the same affiliation; mailing does not count", () => {
    expect(match([provider()], { ...author, affiliation: "Hospital, Tucson, AZ" }).status).toBe("probable");
    expect(match([provider({ addresses: [{ address_purpose: "MAILING", city: "Phoenix", state: "AZ" }] })]).verified).toBe(false);
    expect(match([provider()], { ...author, affiliation: "Phoenix, California" }).verified).toBe(false);
  });
  it("checks middle initials, including in the PubMed first-name field", () => {
    const p = provider({ basic: { first_name: "Jane", last_name: "Smith", middle_name: "Ann", status: "A" } });
    expect(match([p], { ...author, firstName: "Jane A" }).verified).toBe(true);
    expect(match([p], { ...author, firstName: "Jane B" }).status).toBe("rejected");
    expect(match([provider()], { ...author, firstName: "Jane A" }).status).toBe("probable");
  });
  it("rejects irrelevant/nonclinical taxonomies even with matching name and city", () => {
    for (const desc of ["Dentist", "Student", "Internal Medicine", "Nurse Practitioner"]) {
      expect(match([provider({ taxonomies: [{ desc }] })]).status).toBe("rejected");
    }
    expect(matchIdentity(author, [provider()], "unknown disease").status).toBe("rejected");
  });
  it("never picks between plausible namesakes or verifies truncated results", () => {
    expect(match([provider(), provider({ number: "1234567891" })]).status).toBe("ambiguous");
    expect(matchIdentity(author, [provider()], "sarcoma", { truncated: true }).status).toBe("ambiguous");
  });
  it("rejects a trainee code even if another taxonomy qualifies", () => {
    expect(match([provider({ taxonomies: [{ code: "390200000X" }, { code: "207RX0202X" }] })]).status).toBe("rejected");
  });
  it("deduplicates NPI results and rejects inactive/organization records", () => {
    expect(match([provider(), provider()]).verified).toBe(true);
    expect(match([provider({ enumeration_type: "NPI-2" })]).status).toBe("rejected");
    expect(match([provider({ basic: { first_name: "Jane", last_name: "Smith", status: "I" } })]).status).toBe("rejected");
  });
});
