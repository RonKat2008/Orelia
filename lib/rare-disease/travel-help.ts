/**
 * "You may have to travel — here's help with that". Lists the case's travel_aid and financial_aid organizations from
 * the shortlist, each with its evidence link, plus the nearest expert's distance against the travel limit. Pure;
 * takes the shortlist's organization rows (GET /api/cases/[id]/shortlist groups.organization) as they come.
 */
import type { OrganizationKind } from "@/lib/contracts/resource";
import { flagMedicalAdvice } from "@/lib/safety/no-medical-advice";
import type { NearestCare } from "./condition-facts";

export type TravelHelpKind = Extract<OrganizationKind, "travel_aid" | "financial_aid">;
const HELP_KINDS: readonly TravelHelpKind[] = ["travel_aid", "financial_aid"];

/** The fields of a shortlist organization row this helper reads. */
export interface TravelOrganization {
  targetId: string;
  name: string;
  organizationKind: OrganizationKind | null;
  evidence: readonly { sourceUrl: string }[];
}

export interface TravelHelpItem {
  id: string;
  name: string;
  kind: TravelHelpKind;
  href: string;
}

export interface TravelHelp {
  items: TravelHelpItem[];
  nearest: NearestCare | null;
  /** True when there is something to say: an organization to list, or a nearest expert beyond the limit. */
  show: boolean;
}

export interface TravelHelpInput {
  organizations: readonly TravelOrganization[];
  nearest: NearestCare | null;
}

const safeLink = (url: string) => (/^https?:\/\/[^\s]+$/i.test(url) ? url : null);
const isHelpKind = (kind: OrganizationKind | null): kind is TravelHelpKind => HELP_KINDS.includes(kind as TravelHelpKind);

function toItem(org: TravelOrganization): TravelHelpItem[] {
  if (!isHelpKind(org.organizationKind)) return [];
  const href = org.evidence.map((e) => safeLink(e.sourceUrl)).find((u): u is string => !!u);
  const name = org.name.trim();
  if (!href || !name || flagMedicalAdvice(name).flagged) return [];
  return [{ id: org.targetId, name, kind: org.organizationKind, href }];
}

export function buildTravelHelp(input: TravelHelpInput): TravelHelp {
  const seen = new Set<string>();
  const items = input.organizations.flatMap(toItem).filter((item) => {
    const key = item.name.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const beyond = input.nearest ? !input.nearest.withinTravelLimit : false;
  return { items, nearest: input.nearest, show: items.length > 0 || beyond };
}
