/**
 * Landing page copy and illustrative data. Plain data (no "use client"), so server
 * components read it directly. Every product claim here mirrors behaviour in the
 * codebase (lib/sources, lib/safety); the sample run is labelled illustrative on screen.
 */

export const START_HREF = "/start";
/** The detailed intake and swarm, for judges who want to watch every agent. */
export const JUDGE_START_HREF = "/start?view=judge";
export const HOW_IT_WORKS_ID = "how-it-works";

/** The one quiet promise under the hero buttons (the full list lives in "What we never do"). */
export const HERO_REASSURANCE = "Nothing is sent without your OK." as const;

/** Landing "How it works" lede and the closing line for people still looking for a diagnosis. */
export const HOW_LEDE = "Most doctors may never have seen a case. We find the ones who have." as const;
export const NO_DIAGNOSIS_LINE = "No diagnosis yet? We can help you look for one too." as const;

export const HERO_PROMISE = "Expert finders tell you who the expert is. Orelia gets you seen." as const;

export interface HowStep {
  id: string;
  /** Same four names as the patient progress line in a case, so one step count runs site-wide. */
  title: string;
  /** One plain sentence (grade 6 to 8). */
  body: string;
  /** Judge-level detail for /how-it-works. Agent names are fine here. */
  behind: string;
}

export const HOW_STEPS: readonly HowStep[] = [
  {
    id: "tell",
    title: "Tell us",
    body: "Share a report. No diagnosis yet? Tell us your symptoms. You check every detail first.",
    behind:
      "Your report is read into fields. You confirm each one before any research starts, and you choose which fields a contact may ever see.",
  },
  {
    id: "search",
    title: "We search",
    body: "We look for the few specialists, studies and patient groups who know your condition. Every claim is checked against its source.",
    behind:
      "Nine search agents run at once across registries, trial listings, medical papers, advocacy groups and aid programs. A verifier drops any claim it cannot source. A curator keeps the best fits.",
  },
  {
    id: "choose",
    title: "You choose",
    body: "Pick up to 5 people or groups. You may have to travel, so we show how far each one is. Tick what each one may see.",
    behind:
      "A case keeps at most five active contacts. A planner picks the way in for each one: call, email, an online form, or a mix.",
  },
  {
    id: "reach",
    title: "We reach out",
    body: "You read each message first. Then we send it and follow up.",
    behind:
      "Every message passes the outbound gate: approved by you, only the fields you ticked, and an AI disclosure. Follow-ups on business day 3 and day 7 are approved up front.",
  },
] as const;

/** Site-wide patient step count. The judge console has 7 stages. */
export const PATIENT_STEP_COUNT = HOW_STEPS.length;

export type ChannelId = "call" | "email" | "web";

export interface Channel {
  id: ChannelId;
  label: string;
  /** What Orelia does on this channel, in plain words. */
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
  id: string;
  title: string;
  /** One sentence for the landing page and the top of /trust. */
  body: string;
  /** More for the Details disclosure on /trust. */
  more: string;
}

/** "What we never do": each line mirrors a guardrail in lib/safety. The landing page shows the first three. */
export const PROMISES: readonly SafetyPromise[] = [
  {
    id: "advice",
    title: "Never medical advice",
    body: "We find people and groups and help you reach them. We never guess a diagnosis, read your results or suggest treatments.",
    more: "Orelia does not interpret reports, recommend treatments or choose care for you. Every fact about a person or group links to the public page it came from, and anything without a source is dropped.",
  },
  {
    id: "approval",
    title: "Never a message you did not approve",
    body: "Every email, call script and form waits for you to read it and say yes.",
    more: "Follow-ups are approved up front too, so you can walk away. A case has at most five active contacts. Every email, and the start of every call, says that AI helped.",
  },
  {
    id: "fields",
    title: "Never a detail you did not choose",
    body: "You tick what each contact may see. Anything unticked stays out.",
    more: "Unticked details stay out of the email, the call and the form. The check happens in code before anything leaves, and it cannot be switched off.",
  },
  {
    id: "test-inboxes",
    title: "In this demo, messages only go to our own test inboxes",
    body: "Real clinics, doctors and phone numbers are never contacted in the demo.",
    more: "In demo mode, messages can only reach addresses and numbers on an approved test list. Real intake teams are never contacted.",
  },
  {
    id: "urgent",
    title: "Urgent? Call 911",
    body: "If symptoms are new, worsening or urgent, contact your care team or call 911.",
    more: "Orelia is not for emergencies.",
  },
] as const;

/** The three promises the landing page shows. */
export const LANDING_PROMISES = PROMISES.slice(0, 3);
