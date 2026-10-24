/** Plain-language wording for the patient view. Pure. */

type Channel = "email" | "voice" | "web_form";
type Purpose = "intro" | "apply" | "follow_up" | "confirm" | "verify";
export interface PlainStep {
  order: number;
  channel: Channel;
  purpose: Purpose;
  enabled: boolean;
}

function first(channel: Channel): string {
  if (channel === "email") return "email them";
  if (channel === "voice") return "call them";
  return "fill in their online form";
}

function later(step: PlainStep): string {
  if (step.purpose === "follow_up") {
    if (step.channel === "email") return "email again if there's no reply";
    if (step.channel === "voice") return "call if there's no reply";
    return "use their online form if there's no reply";
  }
  if (step.purpose === "verify" || step.purpose === "confirm") return "call to check the details";
  return first(step.channel);
}

/** "We'll email them, then call if there's no reply." from a resource's plan steps. */
export function planLine(steps: readonly PlainStep[]): string {
  const live = steps.filter((s) => s.enabled).sort((a, b) => a.order - b.order);
  if (live.length === 0) return "We couldn't find a public way to reach them, so we won't contact them.";
  const [head, ...rest] = live;
  const parts = [first(head!.channel), ...rest.map(later)];
  return `We'll ${parts.join(", then ")}.`;
}

export function resourceKindLabel(kind: string, subKind?: string | null): string {
  if (kind === "expert") return "Specialist";
  if (kind === "institution") return "Care center";
  if (kind === "trial") return "Research study";
  if (subKind === "financial_aid") return "Help with costs";
  if (subKind === "travel_aid") return "Help with travel";
  return "Support group";
}

const SHARE_LABELS: Record<string, string> = {
  diseaseName: "Your diagnosis",
  subtype: "The specific type",
  stageSummary: "How things stand, from your report",
  homeCity: "Your city",
  homeState: "Your state",
  insurer: "Your insurance company",
  planId: "Your insurance member ID",
  travelLimitMiles: "How far you can travel",
  goals: "What you're hoping for",
};

export function shareLabel(key: string): string {
  return SHARE_LABELS[key] ?? key;
}
