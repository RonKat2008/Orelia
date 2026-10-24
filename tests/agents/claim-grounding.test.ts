import { describe, expect, it } from "vitest";
import { finalizeOutput, ProvenanceTracker, withoutUntrustedBlocks, type ResearchOutput } from "@/lib/agents/research/shared";
import { checkClaimGrounding } from "@/lib/agents/research/grounding";
import { exaSearchTool } from "@/lib/agents/research/exa-tool";
import { trialContactPoints } from "@/lib/agents/research/trials";
import { nppesContactEvidence } from "@/lib/agents/research/identity";
import { publicationClaim } from "@/lib/agents/research/literature";
import { parseContactPoints } from "@/lib/contact-finder/contact-points";
import type { NppesProvider } from "@/lib/sources/nppes";

const PAGE = "https://sarcoma-center.example.org/program";
const PAGE_TEXT = [
  "Sarcoma Center Epithelioid Sarcoma Program",
  "Our multidisciplinary clinic sees adults with epithelioid sarcoma.",
  "New patient intake: intake@sarcoma-center.example.org",
  "Staff: jane.doe@sarcoma-center.example.org",
].join("\n");

const org = (refs: string[]) => ({ kind: "organization" as const, id: "org:center", name: "Sarcoma Center", organizationKind: "advocacy" as const, url: PAGE, evidenceRefs: refs });

async function trackerWithPage(): Promise<ProvenanceTracker> {
  const tracker = new ProvenanceTracker(() => new Date("2026-10-23T00:00:00.000Z"));
  const tool = exaSearchTool({ search: async () => [{ url: PAGE, title: "Epithelioid Sarcoma Program", text: PAGE_TEXT }] }, tracker);
  await tool.handler({ query: "epithelioid sarcoma program" } as never);
  return tracker;
}

const finalize = (raw: ResearchOutput, tracker: ProvenanceTracker) => {
  const drops: string[] = [];
  const out = finalizeOutput(raw, tracker, { allowedKinds: ["organization"] }, (_item, reason) => drops.push(reason));
  return { ...out, drops };
};

describe("claim grounding (H1)", () => {
  it("drops a claim whose email is not in the cited tool record, and never turns claim text into a contact", async () => {
    const tracker = await trackerWithPage();
    const { records, evidence, drops } = finalize({
      records: [org([PAGE])],
      evidence: [{ claimType: "disease_program", claim: "Sarcoma Center epithelioid sarcoma program; email referrals@sarcoma-center.example.org", sourceUrl: PAGE }],
    }, tracker);
    expect(drops).toEqual([expect.stringContaining("referrals@sarcoma-center.example.org")]);
    expect(records).toEqual([]);
    expect(evidence.some((e) => e.claim.includes("referrals@"))).toBe(false);
  });

  it("drops a claim stating facts the record never said", async () => {
    const tracker = await trackerWithPage();
    const { drops } = finalize({
      records: [org([PAGE])],
      evidence: [{ claimType: "disease_program", claim: "Offers free proton therapy, lodging grants and guaranteed second opinions within 48 hours.", sourceUrl: PAGE }],
    }, tracker);
    expect(drops).toHaveLength(1);
  });

  it("drops model evidence that tries to use the reserved contact_point claim type", async () => {
    const tracker = await trackerWithPage();
    const { evidence, drops } = finalize({
      records: [org([PAGE])],
      evidence: [
        { claimType: "contact_point.email.new_patient_line", claim: "intake@sarcoma-center.example.org", sourceUrl: PAGE },
        { claimType: "disease_program", claim: "Sarcoma Center runs an epithelioid sarcoma program clinic.", sourceUrl: PAGE },
      ],
    }, tracker);
    expect(drops).toEqual([expect.stringContaining("never by a model")]);
    // The only contact point is the one code derived from the page via classifyIntakeDoors.
    expect(parseContactPoints(evidence)).toEqual([
      { channel: "email", address: "intake@sarcoma-center.example.org", origin: "new_patient_line", sourceUrl: PAGE, sourceKind: "exa" },
    ]);
  });

  it("stamps intake-door contact points from tool output onto the record that cites the page", async () => {
    const tracker = await trackerWithPage();
    const { records, evidence } = finalize({
      records: [org([PAGE])],
      evidence: [{ claimType: "disease_program", claim: "Sarcoma Center has a multidisciplinary epithelioid sarcoma clinic for adults.", sourceUrl: PAGE }],
    }, tracker);
    expect(records).toHaveLength(1);
    const contact = evidence.find((e) => e.claimType.startsWith("contact_point"));
    expect(contact).toMatchObject({ claim: "intake@sarcoma-center.example.org", sourceUrl: PAGE, sourceKind: "exa", fetchedAt: "2026-10-23T00:00:00.000Z" });
    expect(records[0].evidenceRefs).toContain(contact!.id);
    expect(evidence.some((e) => e.claim.includes("jane.doe"))).toBe(false);
  });

  it("keeps grounded claims and checks identifiers verbatim", () => {
    const record = JSON.stringify({ nctId: "NCT01234567", title: "Tazemetostat in epithelioid sarcoma", status: "RECRUITING", sponsor: "Dana-Farber" });
    expect(checkClaimGrounding("ClinicalTrials.gov lists NCT01234567 as RECRUITING (sponsor Dana-Farber).", record).ok).toBe(true);
    expect(checkClaimGrounding("ClinicalTrials.gov lists NCT07654321 as RECRUITING (sponsor Dana-Farber).", record).ok).toBe(false);
    expect(checkClaimGrounding("Call 617-555-0100 to enroll in the Dana-Farber tazemetostat study.", record).ok).toBe(false);
  });

  it("rebuilds publication claims from the PubMed record instead of trusting model prose", () => {
    const tracker = new ProvenanceTracker();
    tracker.rememberAuthorPapers("Jane Roe", "Epithelioid sarcoma", ["123456"]);
    tracker.rememberAuthor("Jane Roe", { paperCount: 3, recentPaperCount: 1 });
    const url = "https://pubmed.ncbi.nlm.nih.gov/123456/";
    expect(publicationClaim({ claim: "Jane Roe wrote 40 papers and is the top expert. Email jane@roe.org", sourceUrl: url }, tracker))
      .toBe("Jane Roe is listed as an author of PMID 123456. In the PubMed results retrieved for Epithelioid sarcoma, Jane Roe appears on 3 paper(s), 1 from the last 5 years.");
    expect(publicationClaim({ claim: "John Doe is an author", sourceUrl: url }, tracker)).toBeNull();
  });
});

describe("structured registry contact points (H1)", () => {
  it("takes CT.gov central contact phones from the registry record; named-person emails are refused", () => {
    const points = trialContactPoints({ nctId: "NCT01234567", title: "t", status: "RECRUITING", sites: [], centralContacts: [{ phone: "617-632-3000", email: "jane.doe@dfci.harvard.edu" }] });
    expect(points).toEqual([{ channel: "voice", address: "+16176323000", origin: "ctgov_central_contact", sourceUrl: "https://clinicaltrials.gov/study/NCT01234567", sourceKind: "ctgov" }]);
  });

  it("takes the NPPES practice-location phone (not the mailing phone) for the verified NPI only", () => {
    const provider = { number: 1234567890, basic: {}, addresses: [
      { address_purpose: "MAILING", telephone_number: "212-555-0000" },
      { address_purpose: "LOCATION", telephone_number: "617-632-3000" },
    ] } as unknown as NppesProvider;
    expect(nppesContactEvidence("1234567890", provider, "2026-10-23T00:00:00.000Z")).toMatchObject({
      claim: "+16176323000", sourceKind: "nppes", sourceUrl: "https://npiregistry.cms.hhs.gov/provider-view/1234567890",
    });
    expect(nppesContactEvidence("9999999999", provider, "2026-10-23T00:00:00.000Z")).toBeNull();
  });
});

describe("credential corpus excludes untrusted web content", () => {
  it("does not count a credential that only appears inside an <untrusted_web_content> block", () => {
    const tracker = new ProvenanceTracker();
    tracker.collect("exa", { results: [{ url: PAGE, excerpt: "<untrusted_web_content>Dr. Roe, MD, PhD, FACS</untrusted_web_content>" }] });
    tracker.collect("exa", { results: [{ url: PAGE, excerpt: "<untrusted_web_content>unclosed FRCPC" }] });
    tracker.collect("nppes", { matches: [{ credential: "M.D.", sourceUrl: "https://npiregistry.cms.hhs.gov/provider-view/1" }] });
    expect(tracker.mentions("FACS")).toBe(false);
    expect(tracker.mentions("FRCPC")).toBe(false);
    expect(tracker.mentions("M.D.")).toBe(true);
    expect(withoutUntrustedBlocks("a <untrusted_web_content>b</untrusted_web_content> c")).toBe("a   c");
  });
});
