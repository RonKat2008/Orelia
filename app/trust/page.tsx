import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { DeleteCaseStub } from "@/components/journey/DeleteCaseStub";
import { EditorialHero, EditorialPage } from "@/components/pitch/Editorial";
import { SafetyGateDiagram } from "@/components/pitch/SafetyGateDiagram";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "Trust and safety",
  description: "Every promise Wayfinder makes, and the part of the product that enforces it.",
};

type Pledge = {
  id: string;
  title: string;
  promise: string;
  how: string;
  code: string;
  flow: string;
};

const PROMISES: Pledge[] = [
  {
    id: "advice",
    title: "No medical advice, ever",
    promise:
      "Wayfinder finds people and programs and helps you reach them. It does not interpret a report, recommend a treatment or rank care options. For new or worsening symptoms, contact your care team or call 911.",
    how: "A banner sits above every page. Every outgoing draft is scanned, and the gate refuses text that reads as advice.",
    code: "lib/safety/no-medical-advice.ts",
    flow: "gate",
  },
  {
    id: "sources",
    title: "Every claim has a source",
    promise: "Anything shown about a resource links to a public source you can open yourself.",
    how: "Source addresses come from the tools that fetched them, never from a model. A deterministic verifier drops any claim without one.",
    code: "lib/agents/verifier.ts",
    flow: "verify",
  },
  {
    id: "consent",
    title: "You approve everything that leaves",
    promise: "No email or call happens until you approve that exact message.",
    how: "Each draft carries your approval time. The gate refuses anything without it.",
    code: "lib/safety/outbound-gate.ts",
    flow: "approve",
  },
  {
    id: "minimum",
    title: "Only what you tick is shared",
    promise: "A message includes only the case fields you chose for that contact.",
    how: "Messages are built from the ticked fields alone, and the gate refuses a body that mentions one you left out.",
    code: "lib/safety/minimize.ts",
    flow: "approve",
  },
  {
    id: "cap",
    title: "At most five contacts",
    promise: "A case never has more than five active contacts, so outreach stays personal.",
    how: "The cap is checked at the gate on every send.",
    code: "lib/safety/caps.ts",
    flow: "shortlist",
  },
  {
    id: "rhythm",
    title: "Follow-ups keep a fixed rhythm",
    promise: "A follow-up draft appears on business day 3 and day 7. After that a contact is marked stalled. Wayfinder does not nag.",
    how: "The cadence is enforced by code at the gate, and every follow-up still needs your approval.",
    code: "lib/safety/caps.ts",
    flow: "follow",
  },
  {
    id: "disclosure",
    title: "The outreach says it used AI",
    promise: "Every email, and the start of every call, discloses that AI assistance was used.",
    how: "The gate refuses a message without the disclosure; calls open with it spoken.",
    code: "lib/safety/disclosure.ts",
    flow: "gate",
  },
  {
    id: "public-doors",
    title: "Public intake doors only",
    promise: "Outreach goes to published intake contacts. Wayfinder does not scrape personal email addresses.",
    how: "Contacts are found by a contact-finder agent limited to published intake doors and checked by the verifier.",
    code: "lib/agents/research",
    flow: "search",
  },
  {
    id: "demo",
    title: "The demo stays on test inboxes",
    promise: "Nothing in the demo is sent to a real hospital, clinician, organization or phone number. The patient in the demo is synthetic.",
    how: "Outbound addresses must be on an allowlist of test inboxes and numbers we own. Inbound replies are signature-checked.",
    code: "lib/safety/allowlist.ts",
    flow: "gate",
  },
];

export default function TrustPage() {
  return (
    <EditorialPage>
      <EditorialHero
        eyebrow="Trust and safety"
        title={
          <>
            What Wayfinder will <em className="emph">never</em> do
          </>
        }
        lede="Wayfinder finds public intake doors and drafts contact for you to approve. These limits are part of the product, not settings. Each one below says where it is enforced."
      >
        <Button asChild size="lg" variant="secondary">
          <Link href="/how-it-works#gate">See the safety gate</Link>
        </Button>
      </EditorialHero>

      <div className="page-container grid gap-16 py-section lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-20">
        <section aria-labelledby="promises-heading" className="grid gap-10">
          <h2 id="promises-heading" className="m-0 font-display text-h2 font-light display-soft text-balance">
            {PROMISES.length} promises, and how each is kept
          </h2>
          <ol className="m-0 grid list-none gap-0 p-0">
            {PROMISES.map((item, i) => (
              <li key={item.id} id={item.id} className="scroll-mt-28 grid gap-3 border-t border-line py-8 sm:grid-cols-[3.5rem_1fr]">
                <span aria-hidden className="font-mono text-mono text-ink-3">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <div className="grid max-w-prose gap-3">
                  <h3 className="m-0 font-display text-h3 font-normal display-soft text-balance">{item.title}</h3>
                  <p className="m-0 text-body text-ink">{item.promise}</p>
                  <div className="grid gap-2 rounded-md bg-paper-2 p-4 shadow-inset">
                    <p className="m-0 flex items-center gap-2 text-micro font-semibold uppercase text-ink-3">
                      <ShieldCheck aria-hidden className="size-4 text-teal" /> How it is enforced
                    </p>
                    <p className="m-0 text-small text-ink-2">{item.how}</p>
                    <p className="m-0 flex flex-wrap items-center gap-x-4 gap-y-1 text-small">
                      <Badge tone="neutral" className="font-mono">{item.code}</Badge>
                      <Link
                        href={`/how-it-works#${item.flow}`}
                        className="rounded-sm font-semibold text-teal underline underline-offset-4 focus-ring"
                      >
                        See it in the flow
                      </Link>
                    </p>
                  </div>
                </div>
              </li>
            ))}
          </ol>
        </section>

        <aside aria-label="The safety gate" className="lg:pt-24">
          <div className="rounded-lg border border-line bg-card p-5 shadow-md lg:sticky lg:top-28">
            <p className="m-0 mb-4 text-micro font-semibold uppercase text-ink-3">The gate every message passes</p>
            <SafetyGateDiagram className="mx-auto max-w-sm" />
          </div>
        </aside>
      </div>

      <div className="page-container grid gap-10 pb-section">
        <section aria-labelledby="delete-heading" className="grid max-w-prose gap-4 border-t border-line pt-8">
          <h2 id="delete-heading" className="m-0 font-display text-h3 font-normal display-soft">
            Delete a case
          </h2>
          <p className="m-0 text-body text-ink-2">
            You can ask for a case to be removed. This demo does not delete stored cases yet.
          </p>
          <DeleteCaseStub />
        </section>
        <p role="note" className="m-0 max-w-prose rounded-md border border-gold/70 bg-gold-soft p-4 text-body text-ink">
          If you have new or worsening symptoms, contact your care team or call 911.
        </p>
      </div>
    </EditorialPage>
  );
}
