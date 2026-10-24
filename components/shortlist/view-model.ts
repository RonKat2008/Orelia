import type { Evidence, Resource } from "@/lib/contracts";
import { RARE_TAG_LABELS, isExpertCenter, rareTags } from "@/lib/rare-disease/tags";
import { computeScoreSegments, type ScoreSegment } from "@/lib/motion/score";
import { reachabilityLabel } from "@/lib/outreach/reachability";
import type { ShortlistCard } from "./data";

export type GroupId = ShortlistCard["group"];
export type KindFilter = GroupId | "all";

export const GROUPS: {
  id: GroupId;
  title: string;
  short: string;
  blurb: string;
}[] = [
  {
    id: "specialists",
    title: "Specialists and centers",
    short: "Specialists",
    blurb:
      "People and programs who see this disease, with the publications or designations that point to them.",
  },
  {
    id: "studies",
    title: "Studies & registries",
    short: "Studies & registries",
    blurb:
      "Studies that follow people over time and patient registries. Joining usually means sharing health details, not trying a treatment.",
  },
  {
    id: "trials",
    title: "Trials",
    short: "Trials",
    blurb:
      "Studies that list your condition and are recruiting. Joining is always a conversation with the study team.",
  },
  {
    id: "advocacy",
    title: "Advocacy",
    short: "Advocacy",
    blurb:
      "Patient organizations that connect people, share plain-language guides and know the community.",
  },
  {
    id: "aid",
    title: "Aid",
    short: "Aid",
    blurb: "Programs that help with the cost of care, travel and lodging.",
  },
];

const KIND_LABEL: Record<string, string> = {
  cancer_center: "Cancer center",
  rare_disease_center: "Rare disease center",
  hospital: "Hospital",
  advocacy: "Advocacy organization",
  financial_aid: "Financial aid",
  travel_aid: "Travel aid",
  registry: RARE_TAG_LABELS.registry,
};

export function titleOf(resource: Resource): string {
  return resource.kind === "trial" ? resource.title : resource.name;
}

function label(value: string | undefined): string | undefined {
  return value ? (KIND_LABEL[value] ?? value) : undefined;
}

/**
 * Quiet "Expert center" word for NORD Centers of Excellence, RDCRN consortia and the Undiagnosed Diseases Network,
 * from code-stamped claim types only. One label (the first match), or null.
 */
export function expertCenterLabel(
  evidence: readonly Pick<Evidence, "claimType">[],
): string | null {
  const tags = rareTags(evidence);
  if (!isExpertCenter(tags)) return null;
  const tag = tags.find((t) => t === "nord_coe" || t === "rdcrn" || t === "udn");
  return tag ? RARE_TAG_LABELS[tag] : null;
}

/** Small line above the name: what this is. */
export function eyebrowOf(
  resource: Resource,
  evidence: readonly Pick<Evidence, "claimType">[] = [],
): string {
  const tags = rareTags(evidence);
  if (resource.kind === "expert")
    return (
      [resource.credentials, resource.specialty].filter(Boolean).join(", ") ||
      "Specialist"
    );
  if (resource.kind === "institution")
    return label(resource.institutionKind) ?? "Care center";
  if (resource.kind === "trial")
    return resource.studyType === "observational" || tags.includes("observational_study")
      ? RARE_TAG_LABELS.observational_study
      : "Clinical trial";
  if (tags.includes("registry") && resource.organizationKind !== "registry")
    return RARE_TAG_LABELS.registry;
  return label(resource.organizationKind) ?? "Organization";
}

/** Where it is or how to identify it, when the sources said. */
export function placeOf(resource: Resource): string | undefined {
  if (resource.kind === "institution")
    return (
      [resource.city, resource.state].filter(Boolean).join(", ") || undefined
    );
  if (resource.kind === "expert") return resource.profile?.affiliation;
  if (resource.kind === "trial")
    return (
      [resource.nctId, resource.status].filter(Boolean).join(" · ") || undefined
    );
  return undefined;
}

/** Judge meta line: type · place · expert-center word (a quiet tag, so the row keeps its badge budget). */
export function metaOf(card: Pick<ShortlistCard, "resource" | "evidence">): string {
  return [eyebrowOf(card.resource, card.evidence), placeOf(card.resource), expertCenterLabel(card.evidence)]
    .filter(Boolean)
    .join(" · ");
}

function statesOf(resource: Resource): string[] {
  if (resource.kind === "institution")
    return resource.state ? [resource.state] : [];
  if (resource.kind === "expert")
    return resource.profile?.state ? [resource.profile.state] : [];
  if (resource.kind === "trial")
    return resource.registry?.recruitingSiteStates ?? [];
  return [];
}

export interface ShortlistFilters {
  kind: KindFilter;
  inState: boolean;
  travel: boolean;
}

export const NO_FILTERS: ShortlistFilters = {
  kind: "all",
  inState: false,
  travel: false,
};

type ParamReader = { get(name: string): string | null };

export function parseFilters(params: ParamReader): ShortlistFilters {
  const kind = params.get("kind");
  return {
    kind: GROUPS.some((group) => group.id === kind) ? (kind as GroupId) : "all",
    inState: params.get("instate") === "1",
    travel: params.get("travel") === "1",
  };
}

/** Query string for the filters; defaults are omitted so the URL stays clean. */
export function filtersToQuery(filters: ShortlistFilters): string {
  const params = new URLSearchParams();
  if (filters.kind !== "all") params.set("kind", filters.kind);
  if (filters.inState) params.set("instate", "1");
  if (filters.travel) params.set("travel", "1");
  return params.toString();
}

function normalizeState(value: string): string {
  return value.trim().toLowerCase();
}

export function matchesFilters(
  card: ShortlistCard,
  filters: ShortlistFilters,
  homeState: string | null,
): boolean {
  if (filters.kind !== "all" && card.group !== filters.kind) return false;
  if (filters.inState) {
    if (!homeState) return false;
    const wanted = normalizeState(homeState);
    if (
      !statesOf(card.resource).some((state) => normalizeState(state) === wanted)
    )
      return false;
  }
  if (filters.travel) {
    if (
      card.resource.kind !== "organization" ||
      card.resource.organizationKind !== "travel_aid"
    )
      return false;
  }
  return true;
}

export interface ContactDoor {
  found: boolean;
  /** What the sources said about the door; empty when none was found. */
  text: string;
}

/**
 * A door is found only when the resource carries a code-stamped contact_point.* evidence row (email, phone, or an
 * online intake form). Scoring text and plain program pages never count; consent uses the same function.
 */
export function contactDoorOf(card: ShortlistCard): ContactDoor {
  const text = reachabilityLabel(card.evidence);
  return text ? { found: true, text } : { found: false, text: "" };
}

export const SEGMENT_CLASSES = [
  "bg-teal",
  "bg-sage",
  "bg-gold",
  "bg-ink-3",
] as const;

export function scoreSegments(
  card: ShortlistCard,
  scale: number | undefined,
): ScoreSegment[] {
  return computeScoreSegments(card.breakdown, scale);
}

export function tierLabel(tier: ShortlistCard["tier"]): string | null {
  if (tier === "best") return "Best fit";
  if (tier === "good") return "Good fit";
  if (tier === "backup") return "Backup";
  if (tier === "exclude") return "Not a fit";
  return null;
}
