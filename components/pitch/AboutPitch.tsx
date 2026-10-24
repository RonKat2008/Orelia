"use client";

import Link from "next/link";
import { Reveal } from "@/components/motion/Reveal";
import { StaggerList } from "@/components/motion/StaggerList";
import { WaypointRoute } from "@/components/motion/WaypointRoute";
import "./pitch.css";

const STEPS = [
  { id: "case", label: "Your case" },
  { id: "swarm", label: "Research swarm" },
  { id: "shortlist", label: "Sourced shortlist" },
  { id: "approve", label: "You approve" },
  { id: "outreach", label: "Email or call" },
  { id: "tasks", label: "Replies as tasks" },
  { id: "follow", label: "Follow-up" },
] as const;

const PROMISES = [
  {
    id: "advice",
    title: "No medical advice",
    text: "Wayfinder finds people and programs and helps you reach them. It does not interpret a report, recommend a treatment, or rank therapies. If you have new or worsening symptoms, contact your care team or call 911.",
  },
  {
    id: "sources",
    title: "Every claim has a source",
    text: "A verifier drops anything that does not come from a public source. You can open that source yourself.",
  },
  {
    id: "approval",
    title: "You approve every send",
    text: "Drafts wait for you. A message includes only the case fields you tick, and a case keeps at most five active contacts.",
  },
  {
    id: "disclosure",
    title: "The outreach says it used AI",
    text: "Every email, and the start of every call, discloses that AI assistance was used.",
  },
  {
    id: "demo",
    title: "The demo stays on test inboxes",
    text: "Nothing in the demo is sent to a real hospital, clinician, organization, or phone number. Outbound mail is limited to test addresses we own.",
  },
] as const;

export function AboutPitch() {
  return (
    <article className="pitch-article">
      <header className="masthead">
        <Link className="wordmark" href="/">
          Wayfinder
        </Link>
        <p className="eyebrow">For the demo</p>
      </header>

      <h1>Expert finders tell you who the expert is. Wayfinder gets you actually seen by them.</h1>
      <p className="lede pitch-lede">
        You bring a case. A research swarm looks up specialists and centers, recruiting trials,
        advocacy groups, and financial or travel aid. You choose who to contact. Agents then email
        or call the intake teams you approved, and they keep following up until there is an
        appointment, a screening, a membership, or an application — with you approving each step.
      </p>

      <WaypointRoute waypoints={[...STEPS]} label="How a case moves from intake to a connection" />

      <StaggerList
        as="ol"
        className="pitch-steps"
        aria-label="The path from case to appointment"
        getKey={(step) => step.id}
        items={STEPS}
        renderItem={(step, index) => (
          <div className="pitch-step">
            <span className="pitch-step__n">{index + 1}</span>
            <div>
              <h2>{step.label}</h2>
              <p>{STEP_COPY[step.id]}</p>
            </div>
          </div>
        )}
      />

      <section className="pitch-promises" aria-labelledby="promises-heading">
        <h2 id="promises-heading">What you can count on</h2>
        <StaggerList
          aria-label="Safety promises"
          getKey={(item) => item.id}
          items={PROMISES}
          renderItem={(item) => (
            <div className="pitch-promise">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </div>
          )}
        />
      </section>

      <Reveal revealKey="try-demo">
        <div className="pitch-cta">
          <p>The walkthrough uses a synthetic epithelioid sarcoma report. It is not a real patient.</p>
          <Link className="button" href="/">
            Try the demo case
          </Link>
        </div>
      </Reveal>
    </article>
  );
}

const STEP_COPY: Record<(typeof STEPS)[number]["id"], string> = {
  case: "Paste a report. You check the extracted fields before anything else runs.",
  swarm: "Nine research agents look in public sources at the same time and stream their progress.",
  shortlist: "You get a shortlist grouped by kind of help. Each reason links to its source.",
  approve: "You pick at most five contacts, tick the fields that may be shared, and approve each draft.",
  outreach: "Approved drafts go to intake teams by email or a call that starts with an AI disclosure.",
  tasks: "Replies become tasks — send slides, get a referral, call to schedule — and you decide what happens next.",
  follow: "If nobody answers, a follow-up draft appears on business day 3 and again on day 7. Wayfinder does not send it on its own.",
};
