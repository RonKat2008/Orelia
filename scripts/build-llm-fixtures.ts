// Hand-builds fixtures/llm/<agent>/<case>.json for the six live research agents from the recorded API
// responses (fixtures/api, data/nci-centers.json). Every fact and URL comes from those files; nothing is invented.
// Run: npx tsx scripts/build-llm-fixtures.ts
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createFixturePorts } from "@/lib/agents/research/fixture-ports";
import { nppesProviderUrl } from "@/lib/agents/research/identity";
import { pubmedUrl } from "@/lib/agents/research/pubmed-tool";
import { researchOutputSchema, type ResearchOutput } from "@/lib/agents/research/shared";
import { ctgovUrl } from "@/lib/agents/research/trials";
import type { SourcePorts } from "@/lib/agents/research/source-ports";

type Resource = ResearchOutput["records"][number];
type Evidence = ResearchOutput["evidence"][number];
interface Case {
  slug: string;
  diseaseName: string;
  homeState: string;
  travelLimitMiles: number;
}

const AS_OF_YEAR = 2026;
/** Matches the identity agent's live author limit (lib/agents/research/identity.ts). */
const AUTHOR_LIMIT = 15;
const CASES: Case[] = [
  { slug: "epithelioid-sarcoma", diseaseName: "Epithelioid sarcoma", homeState: "AZ", travelLimitMiles: 600 },
  { slug: "vascular-eds", diseaseName: "Vascular Ehlers-Danlos syndrome", homeState: "OH", travelLimitMiles: 300 },
  { slug: "igg4-related-disease", diseaseName: "IgG4-related disease", homeState: "NC", travelLimitMiles: 150 },
];
const ROOT = process.cwd();
const US = /^(united states|usa|us)$/i;
const slug = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/** Curated picks from the recorded Exa results. url must appear in the recorded results or the build fails. */
interface OrgPick {
  url: string;
  name: string;
  claim: string;
}
interface InstPick extends OrgPick {
  institutionKind: "cancer_center" | "rare_disease_center" | "hospital";
}
interface AidPick extends OrgPick {
  organizationKind: "financial_aid" | "travel_aid";
}

const ADVOCACY: Record<string, OrgPick[]> = {
  "epithelioid-sarcoma": [
    {
      url: "https://www.sarcoma-patients.org/",
      name: "Sarcoma Patient Advocacy Global Network (SPAGN)",
      claim: "SPAGN's home page describes it as the global network of national sarcoma patient advocacy organizations.",
    },
    {
      url: "https://sarctrials.org/patient-resources/patient-advocacy-directory/",
      name: "SARC Patient Advocacy Directory",
      claim: "SARC's Patient Advocacy Directory page lists sarcoma patient advocacy and support organizations.",
    },
  ],
  "vascular-eds": [
    {
      url: "https://www.fightveds.org/",
      name: "FIGHT vEDS",
      claim: "FIGHT vEDS describes itself as a non-profit organization dedicated to fighting and finding a treatment for vascular Ehlers-Danlos Syndrome.",
    },
    {
      url: "https://thevedsmovement.org/research/veds-collaborative/",
      name: "The VEDS Movement",
      claim: "The VEDS Movement's VEDS Collaborative page describes a group of patients, family members, researchers and clinicians.",
    },
    {
      url: "https://collagenadvocacynetwork.org/",
      name: "Collagen Advocacy Network",
      claim: "Collagen Advocacy Network describes advocacy, education and research for people living with genetically defined forms of Ehlers-Danlos Syndrome.",
    },
    {
      url: "https://www.weareveds.com/",
      name: "We Are vEDS",
      claim: "We Are vEDS describes resources and support for the vascular Ehlers-Danlos community.",
    },
  ],
  "igg4-related-disease": [
    {
      url: "https://igg4ward.org/",
      name: "IgG4ward! Foundation",
      claim: "The IgG4ward! Foundation's site describes providing advocacy, education and support for people living with IgG4-related disease.",
    },
  ],
};

const AID: Record<string, AidPick[]> = {
  "epithelioid-sarcoma": [
    {
      url: "https://sarcomaalliance.org/financial-assistance/",
      name: "Sarcoma Alliance",
      organizationKind: "financial_aid",
      claim: "The Sarcoma Alliance Financial Assistance page lists organizations offering grants, copay help, travel and lodging support.",
    },
    {
      url: "https://sarcomaalliance.org/second-opinion-grants/",
      name: "Sarcoma Alliance Second Opinion Grants",
      organizationKind: "financial_aid",
      claim: "The Sarcoma Alliance Second Opinion Grants page describes the Suzanne Renee Leider Memorial Assistance Fund, which provides financial assistance for obtaining a second opinion from a sarcoma expert.",
    },
    {
      url: "https://beattheoddsfund.org/apply",
      name: "Beat the Odds Sarcoma Fund",
      organizationKind: "travel_aid",
      claim: "Beat the Odds Sarcoma Fund hosts an application for a travel grant for people who need to travel to a distant sarcoma center.",
    },
    {
      url: "https://curesarcoma.org/support-resources/clinical-trials-assistance/",
      name: "Sarcoma Foundation of America Clinical Trial Assistance",
      organizationKind: "travel_aid",
      claim: "The Sarcoma Foundation of America describes a program providing financial reimbursement for transportation and lodging expenses tied to clinical trial participation.",
    },
    {
      url: "https://www.lmsdr.org/financial-resources",
      name: "LMSDR Financial Resources",
      organizationKind: "financial_aid",
      claim: "LMSDR's Financial Help for Sarcoma Patients page lists funds, including one covering out-of-pocket expenses for patients in clinical trials.",
    },
  ],
  "vascular-eds": [
    {
      url: "https://www.ehlers-danlos.com/us-resource-hub/disability-benefits-financial-assistance/",
      name: "The Ehlers-Danlos Society (financial assistance)",
      organizationKind: "financial_aid",
      claim: "The Ehlers-Danlos Society's U.S. resource hub has a Disability Benefits & Financial Assistance page covering disability benefits, financial aid and grants.",
    },
    {
      url: "https://rarediseases.org/patient-assistance-programs/",
      name: "National Organization for Rare Disorders (NORD) Patient Assistance Programs",
      organizationKind: "financial_aid",
      claim: "NORD's Patient Assistance Programs page says NORD has helped patients who are struggling to afford their medications and care.",
    },
    {
      url: "https://www.edsguardians.org/",
      name: "EDS Guardians",
      organizationKind: "financial_aid",
      claim: "EDS Guardians describes itself as a 501(c)(3) charity helping EDS patients who lack support and need medical care; its page mentions a Travel Grants & Assistance section.",
    },
  ],
  "igg4-related-disease": [
    {
      url: "https://tafcares.org/newsroom/press-releases/the-assistance-fund-opens-new-program-for-immunoglobulin-g4-related-disease/",
      name: "The Assistance Fund",
      organizationKind: "financial_aid",
      claim: "A press release from The Assistance Fund announces a financial assistance program for people living with immunoglobulin G4-related disease, covering out-of-pocket costs such as copays and insurance premiums.",
    },
    {
      url: "https://rarediseases.org/patient-assistance-programs/",
      name: "National Organization for Rare Disorders (NORD) Patient Assistance Programs",
      organizationKind: "financial_aid",
      claim: "NORD's Patient Assistance Programs page says NORD has helped patients who are struggling to afford their medications and care.",
    },
  ],
};

const WEB_CENTERS: Record<string, InstPick[]> = {
  "epithelioid-sarcoma": [
    {
      url: "https://www.tgh.org/institutes-and-services/cancer-institute/sarcoma-center-of-excellence",
      name: "Tampa General Hospital Cancer Institute Sarcoma Center of Excellence",
      institutionKind: "cancer_center",
      claim: "A Tampa General Hospital Cancer Institute page describes a Sarcoma Center of Excellence that offers telehealth appointments.",
    },
    {
      url: "https://www.dukecancerinstitute.org/center/duke-sarcoma-center",
      name: "Duke Sarcoma Center",
      institutionKind: "cancer_center",
      claim: "The Duke Cancer Institute lists the Duke Sarcoma Center and describes itself as an NCI-designated Comprehensive Cancer Center.",
    },
  ],
  "vascular-eds": [
    {
      url: "https://www.hopkinsmedicine.org/genetic-medicine/patient-care/genetics-clinics/cardiovascular-connective-tissue-disorder-clinic",
      name: "Johns Hopkins Cardiovascular Connective Tissue Disorder Clinic",
      institutionKind: "rare_disease_center",
      claim: "The Johns Hopkins Institute of Genetic Medicine lists a Cardiovascular Connective Tissue Disorder Clinic.",
    },
  ],
  "igg4-related-disease": [
    {
      url: "https://www.henryford.com/services/rheumatology/igg4-related-disease-center",
      name: "Henry Ford Health IgG4 Related Disease Center",
      institutionKind: "rare_disease_center",
      claim: "Henry Ford Health lists an IgG4 Related Disease Center.",
    },
    {
      url: "https://www.massgeneralbrigham.org/en/services/igg4-related-systemic-disease",
      name: "Mass General Brigham IgG4-Related Systemic Disease Program",
      institutionKind: "rare_disease_center",
      claim: "Mass General Brigham lists an IgG4-Related Systemic Disease Program.",
    },
    {
      url: "https://www.uchicagomedicine.org/conditions-services/gastroenterology/igg4-related-disease-igg4-rd",
      name: "UChicago Medicine IgG4-Related Disease Clinical Consortium",
      institutionKind: "rare_disease_center",
      claim: "UChicago Medicine lists an IgG4-Related Disease Clinical Consortium.",
    },
  ],
};

function assertReturned(urls: Set<string>, url: string, where: string): void {
  if (!urls.has(url)) throw new Error(`${where}: URL not in recorded tool output: ${url}`);
}

async function literature(c: Case, ports: SourcePorts): Promise<ResearchOutput> {
  const authors = await ports.pubmed.searchAuthors({ disease: c.diseaseName, limit: AUTHOR_LIMIT });
  const records: Resource[] = [];
  const evidence: Evidence[] = [];
  for (const a of authors) {
    // Evidence ids keep co-authors of the same paper from sharing each other's claims (refs cite ids, not URLs).
    const evidenceId = (pmid: string): string => `lit:${slug(a.name)}:${pmid}`;
    const picked = a.papers.slice(0, 2);
    records.push({ kind: "expert", id: `expert:${slug(a.name)}`, name: a.name, evidenceRefs: picked.map((p) => evidenceId(p.pmid)) });
    picked.forEach((p) =>
      evidence.push({
        id: evidenceId(p.pmid),
        claimType: "disease_publications",
        claim: `${a.name} is listed as an author of PMID ${p.pmid}. In the PubMed results retrieved for ${c.diseaseName}, ${a.name} appears on ${a.paperCount} paper(s), ${a.recentPaperCount} from the last 5 years.`,
        sourceUrl: pubmedUrl(p.pmid),
      }),
    );
  }
  return { records, evidence };
}

async function trials(c: Case, ports: SourcePorts): Promise<ResearchOutput> {
  const studies = (await ports.ctgov.recruitingStudies({ condition: c.diseaseName }))
    .map((s) => ({ ...s, sites: s.sites.filter((x) => x.country && US.test(x.country)) }))
    .filter((s) => s.sites.length > 0)
    .slice(0, 12);
  const records: Resource[] = studies.map((s) => ({
    kind: "trial",
    id: `trial:${s.nctId}`,
    nctId: s.nctId,
    title: s.title,
    status: s.status,
    evidenceRefs: [ctgovUrl(s.nctId)],
  }));
  const evidence: Evidence[] = studies.map((s) => {
    const cities = [...new Set(s.sites.slice(0, 5).map((x) => [x.city, x.state].filter(Boolean).join(", ")))];
    const detail = [s.phases?.length ? s.phases.join("/") : undefined, s.sponsor ? `sponsor ${s.sponsor}` : undefined]
      .filter(Boolean)
      .join("; ");
    return {
      claimType: "trial_recruiting",
      claim: `ClinicalTrials.gov lists ${s.nctId} as ${s.status}${detail ? ` (${detail})` : ""} with U.S. sites in ${cities.join("; ")}.`,
      sourceUrl: ctgovUrl(s.nctId),
    };
  });
  return { records, evidence };
}

const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z]/g, "");
const first = (s: string): string => normalize(s.trim().split(/\s+/)[0] ?? "");

async function identity(c: Case, ports: SourcePorts): Promise<ResearchOutput> {
  const authors = await ports.pubmed.searchAuthors({ disease: c.diseaseName, limit: AUTHOR_LIMIT });
  const records: Resource[] = [];
  const evidence: Evidence[] = [];
  for (const a of authors) {
    const result = await ports.nppes.lookup({ firstName: a.firstName, lastName: a.lastName, state: a.state });
    const exact = result.providers.filter(
      (p) => first(p.firstName) === first(a.firstName) && normalize(p.lastName) === normalize(a.lastName),
    );
    const only = exact.length === 1 ? exact[0] : undefined;
    if (only) {
      const url = nppesProviderUrl(only.npi);
      records.push({
        kind: "expert",
        id: `npi:${only.npi}`,
        name: a.name,
        npi: only.npi,
        ...(only.credential ? { credentials: only.credential } : {}),
        ...(only.taxonomy ? { specialty: only.taxonomy } : {}),
        evidenceRefs: [url],
      });
      evidence.push({
        claimType: "identity_verified",
        claim: `NPI ${only.npi} is registered to ${only.firstName} ${only.lastName}${only.taxonomy ? ` (${only.taxonomy})` : ""}${only.city ? ` in ${only.city}, ${only.state}` : ""}; it was the only exact name match NPPES returned.`,
        sourceUrl: url,
      });
    } else {
      records.push({
        kind: "expert",
        id: `expert:${slug(a.name)}`,
        name: a.name,
        npi: null,
        evidenceRefs: [result.searchUrl],
      });
      evidence.push({
        claimType: "identity_unverified",
        claim: `NPPES returned ${exact.length} exact name matches for ${a.name} (${result.providers.length} providers returned); identity was not confirmed.`,
        sourceUrl: result.searchUrl,
      });
    }
  }
  return { records, evidence };
}

async function centers(c: Case, ports: SourcePorts): Promise<ResearchOutput> {
  const nci = await ports.centers.match({ diseaseName: c.diseaseName, homeState: c.homeState, travelLimitMiles: c.travelLimitMiles });
  const web = await ports.exa.search({ query: `${c.diseaseName} specialty center clinic program United States` });
  const webUrls = new Set(web.map((r) => r.url));
  const records: Resource[] = [];
  const evidence: Evidence[] = [];
  for (const n of nci) {
    records.push({
      kind: "institution",
      id: `inst:${slug(n.name)}`,
      name: n.name,
      institutionKind: "cancer_center",
      city: n.city,
      state: n.state,
      evidenceRefs: [n.url],
    });
    evidence.push({
      claimType: "nci_designation",
      claim: `The NCI lists ${n.name} in ${n.city}, ${n.state} as a ${n.designation}.`,
      sourceUrl: n.url,
    });
  }
  for (const w of WEB_CENTERS[c.slug] ?? []) {
    assertReturned(webUrls, w.url, "centers");
    records.push({ kind: "institution", id: `inst:${slug(w.name)}`, name: w.name, institutionKind: w.institutionKind, evidenceRefs: [w.url] });
    evidence.push({ claimType: "disease_program", claim: w.claim, sourceUrl: w.url });
  }
  return { records, evidence };
}

function orgRecords(
  picks: Array<OrgPick & { organizationKind?: "financial_aid" | "travel_aid" }>,
  defaultKind: "advocacy" | "financial_aid" | "travel_aid",
  claimType: (kind: string) => string,
  returned: Set<string>,
  where: string,
): ResearchOutput {
  const records: Resource[] = [];
  const evidence: Evidence[] = [];
  for (const p of picks) {
    assertReturned(returned, p.url, where);
    const kind = p.organizationKind ?? defaultKind;
    records.push({ kind: "organization", id: `org:${slug(p.name)}`, name: p.name, organizationKind: kind, url: p.url, evidenceRefs: [p.url] });
    evidence.push({ claimType: claimType(kind), claim: p.claim, sourceUrl: p.url });
  }
  return { records, evidence };
}

async function advocacy(c: Case, ports: SourcePorts): Promise<ResearchOutput> {
  const web = await ports.exa.search({ query: `${c.diseaseName} patient advocacy foundation support group` });
  return orgRecords(ADVOCACY[c.slug] ?? [], "advocacy", () => "advocacy_organization", new Set(web.map((r) => r.url)), "advocacy");
}

async function aid(c: Case, ports: SourcePorts): Promise<ResearchOutput> {
  const web = await ports.exa.search({ query: `${c.diseaseName} financial assistance copay grant travel lodging assistance` });
  return orgRecords(AID[c.slug] ?? [], "financial_aid", (k) => (k === "travel_aid" ? "travel_aid_program" : "financial_aid_program"), new Set(web.map((r) => r.url)), "aid");
}

const BUILDERS = { literature, trials, identity, centers, advocacy, aid };

async function main(): Promise<void> {
  const ports = createFixturePorts({ root: ROOT, asOfYear: AS_OF_YEAR });
  for (const c of CASES) {
    for (const [agent, build] of Object.entries(BUILDERS)) {
      const output = researchOutputSchema.parse(await build(c, ports));
      const dir = path.join(ROOT, "fixtures", "llm", agent);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, `${c.slug}.json`), `${JSON.stringify(output, null, 2)}\n`);
      console.log(`${agent.padEnd(11)} ${c.slug.padEnd(22)} records=${output.records.length} evidence=${output.evidence.length}`);
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
