import type { NppesProvider as RawNppesProvider } from "@/lib/sources/nppes";
/**
 * Minimal source interfaces the research agents depend on. The real wrappers in lib/sources/* are adapted to
 * these ports at wiring time; agents never import a wrapper directly. Ports return plain facts, never URLs the
 * agent has to guess: where a URL is needed, the port (or the tool handler built on it) supplies it.
 */

export interface PubmedAuthorHit {
  /** Display name as "First Last". */
  name: string;
  firstName: string;
  lastName: string;
  /** Affiliation text from the author's most relevant paper, if PubMed had one. */
  affiliation?: string;
  affiliations?: string[];
  middleName?: string;
  /** Two-letter US state parsed from the affiliation, if any. */
  state?: string;
  /** Papers in the retrieved set that this author appears on. */
  paperCount: number;
  /** Subset of paperCount published in the last 5 years. */
  recentPaperCount: number;
  papers: Array<{ pmid: string; title: string; year?: number }>;
}

export interface PubmedPort {
  searchAuthors(input: { disease: string; limit?: number }): Promise<PubmedAuthorHit[]>;
}

export interface CtgovStudy {
  nctId: string;
  title: string;
  status: string;
  phases?: string[];
  sponsor?: string;
  sites: Array<{ facility?: string; city?: string; state?: string; country?: string; status?: string }>;
  /** Registry fields for relevance/age filtering and ranking signals. */
  conditions?: string[];
  keywords?: string[];
  meshTerms?: string[];
  stdAges?: string[];
  minimumAge?: string;
  maximumAge?: string;
  /** Overall official names (study leads), as listed. */
  investigators?: string[];
  /** True when the registry lists a central contact. */
  hasContact?: boolean;
  /** Central contact phone/email exactly as the registry lists them (structured fields, not prose). */
  centralContacts?: Array<{ phone?: string; email?: string }>;
}

export interface CtgovPort {
  recruitingStudies(input: { condition: string; state?: string }): Promise<CtgovStudy[]>;
}

export interface NppesProvider {
  /** Full registry facts retained for deterministic identity checks. */
  raw?: RawNppesProvider;
  npi: string;
  firstName: string;
  lastName: string;
  credential?: string;
  taxonomy?: string;
  city?: string;
  state?: string;
}

export interface NppesLookupResult {
  truncated?: boolean;
  /** The registry query URL that produced these results (usable as a source URL for "no unique match"). */
  searchUrl: string;
  providers: NppesProvider[];
}

export interface NppesPort {
  lookup(input: { firstName: string; lastName: string; state?: string }): Promise<NppesLookupResult>;
}

export interface ExaResult {
  url: string;
  title: string;
  text?: string;
}

export interface ExaPort {
  search(input: { query: string; numResults?: number }): Promise<ExaResult[]>;
}

export interface NciCenter {
  name: string;
  designation: string;
  city: string;
  state: string;
  /** NCI profile URL for the center. */
  url: string;
}

export interface CentersPort {
  match(input: { diseaseName: string; homeState?: string; travelLimitMiles?: number }): Promise<NciCenter[]>;
}

export interface SourcePorts {
  pubmed: PubmedPort;
  ctgov: CtgovPort;
  nppes: NppesPort;
  exa: ExaPort;
  centers: CentersPort;
}
