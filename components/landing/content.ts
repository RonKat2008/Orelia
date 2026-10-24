/**
 * Landing page copy and illustrative data. Plain data (no "use client"), so server
 * components read it directly. Every product claim here mirrors behaviour in the
 * codebase (lib/sources, lib/safety); the sample run is labelled illustrative on screen.
 */

export const START_HREF = "/start";
/** The detailed intake and swarm, for judges who want to watch every agent. */
export const JUDGE_START_HREF = "/start?view=judge";
export const HOW_IT_WORKS_ID = "how-it-works";

export const TRUST_LINE = [
  "Every claim links to its source",
  "Nothing is sent without your approval",
  "No medical advice",
] as const;

export const HERO_PROMISE = "Expert finders tell you who the expert is. Wayfinder gets you seen." as const;

export interface HowStep {
  id: string;
  kicker: string;
  title: string;
  body: string;
}

export const HOW_STEPS: readonly HowStep[] = [
  {
    id: "details",
    kicker: "Your details",
    title: "Share what you already have.",
    body: "Paste a report or describe your situation in your own words. Wayfinder pulls out the details, then asks you to confirm each one before any research starts.",
  },
  {
    id: "swarm",
    kicker: "Agent swarm",
    title: "A team of research agents goes looking.",
    body: "Separate agents search registries, trial listings, published literature, advocacy groups and aid programs at the same time, and find the public way in to each one.",
  },
  {
    id: "validate",
    kicker: "Validation",
    title: "Every claim is checked against its source.",
    body: "Each fact about a resource must trace back to the page it came from. A verifier drops anything it cannot source, and a curator keeps the best fits for you to choose from.",
  },
  {
    id: "plan",
    kicker: "A plan per resource",
    title: "Each door gets its own way in.",
    body: "A clinic may want a call and an email. A trial may want its screening form and a note to the coordinator. Wayfinder plans the channel, or the mix of channels, each one actually uses.",
  },
  {
    id: "reach",
    kicker: "Outreach & follow-up",
    title: "You approve. Wayfinder calls, emails, applies and follows up.",
    body: "Nothing leaves until you read it and say yes. Then agents send, call and submit, read the replies, follow up on a steady schedule, and turn anything you need to do into a clear task.",
  },
] as const;

export type ChannelId = "call" | "email" | "web";

export interface Channel {
  id: ChannelId;
  label: string;
  /** What Wayfinder does on this channel, in plain words. */
  body: string;
}

export const CHANNELS: readonly Channel[] = [
  {
    id: "call",
    label: "Call",
    body: "Rings the public intake line, says up front that it is an AI assistant calling for you, and saves the transcript.",
  },
  {
    id: "email",
    label: "Email",
    body: "Writes from your case inbox, carries only the details you ticked, and reads every reply that comes back.",
  },
  {
    id: "web",
    label: "Apply online",
    body: "Fills the new-patient, screening or application form on the organization's own site, then keeps the confirmation.",
  },
] as const;

export interface PlanExample {
  name: string;
  kind: string;
  channels: readonly ChannelId[];
  why: string;
}

/** Synthetic example plans: names are invented, and every one is labelled "Example" on screen. */
export const PLAN_EXAMPLES: readonly PlanExample[] = [
  {
    name: "Connective Tissue Clinic",
    kind: "Specialist center",
    channels: ["call", "email"],
    why: "Intake line takes new adults; records go by email.",
  },
  {
    name: "Natural History Study",
    kind: "Recruiting trial",
    channels: ["web", "email"],
    why: "Online screening form, then a note to the coordinator.",
  },
  {
    name: "Vascular EDS Foundation",
    kind: "Advocacy group",
    channels: ["email"],
    why: "A patient navigator answers by email.",
  },
  {
    name: "Care Travel Fund",
    kind: "Travel aid",
    channels: ["web"],
    why: "Applications only through its own form.",
  },
] as const;

export interface SafetyPromise {
  title: string;
  body: string;
}

/** "What we never do": each line mirrors a guardrail in lib/safety. */
export const PROMISES: readonly SafetyPromise[] = [
  {
    title: "Never medical advice",
    body: "Wayfinder finds, contacts and coordinates. It does not interpret reports, suggest treatments or rank care.",
  },
  {
    title: "Never a message you did not approve",
    body: "Every email, call script and form waits for you to read it and say yes. Follow-ups are approved up front, too.",
  },
  {
    title: "Never a field you did not choose",
    body: "You tick which details each contact may see. Anything unticked stays out of the email, the call and the form.",
  },
  {
    title: "Never outside the allowlist in the demo",
    body: "In demo mode, messages can only reach addresses and numbers on an approved test list. Real intake teams are never contacted.",
  },
  {
    title: "Urgent? Call 911",
    body: "If symptoms are new, worsening or urgent, contact your care team or call 911. Wayfinder is not for emergencies.",
  },
] as const;

/** Source domains each research lane reads from (see lib/sources and lib/agents/research). */
export const FIND_SOURCES = {
  centers: ["npiregistry.cms.hhs.gov", "cancer.gov"],
  trials: ["clinicaltrials.gov"],
  literature: ["pubmed.ncbi.nlm.nih.gov"],
} as const;
