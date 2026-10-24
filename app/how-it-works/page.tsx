import Link from "next/link";
import { EditorialHero, EditorialPage, EditorialSection } from "@/components/pitch/Editorial";
import { PipelineDiagram } from "@/components/pitch/PipelineDiagram";
import { SafetyGateDiagram } from "@/components/pitch/SafetyGateDiagram";
import { Button } from "@/components/ui/button";

export const metadata = {
  title: "How Wayfinder works",
  description: "What the research and contact agents do, and what they never send on their own.",
};

export default function HowItWorksPage() {
  return (
    <EditorialPage>
      <EditorialHero
        eyebrow="How it works"
        title={
          <>
            From your case to a <em className="emph">conversation</em>
          </>
        }
        lede="Wayfinder looks up specialists, centers, recruiting trials, advocacy groups, and financial or travel aid, then helps you reach the ones you pick. It coordinates contact. It does not interpret reports or suggest care."
      >
        <Button asChild size="lg">
          <Link href="/start">Start a case</Link>
        </Button>
        <Button asChild size="lg" variant="secondary">
          <Link href="/trust">What it will never do</Link>
        </Button>
      </EditorialHero>

      <div className="page-container grid gap-14 py-section lg:grid-cols-[minmax(0,1fr)_22rem] lg:gap-20">
        <div className="grid gap-14">
          <EditorialSection id="case" number="01" title="You bring a case, and check it">
            <p>
              Paste a report or type what you know. Wayfinder pulls out the condition, where you live, your insurer
              and your goals, then shows every field back to you. Nothing runs until you confirm it.
            </p>
          </EditorialSection>
          <EditorialSection id="search" number="02" title="Agents read public sources, side by side">
            <p>
              Nine research agents work at the same time in public sources: published papers, trial registries,
              provider directories, center listings, advocacy groups and aid programs. You can watch each one report
              in as it goes.
            </p>
          </EditorialSection>
          <EditorialSection id="verify" number="03" title="A verifier drops anything without a source">
            <p>
              Every claim about a resource must point to a source address that a tool fetched. A plain, deterministic
              check removes any claim that does not, so a model cannot make up a credential or a contact.
            </p>
          </EditorialSection>
          <EditorialSection id="shortlist" number="04" title="You get a shortlist, and the reasons">
            <p>
              Results are grouped by kind of help and ranked with weights you can read. Each reason links to its
              source, so you can check it yourself. You choose <strong>at most five</strong> contacts.
            </p>
          </EditorialSection>
          <EditorialSection id="approve" number="05" title="You decide what is shared, and you approve each draft">
            <p>
              For every contact you tick the case fields that may appear in a message. Unticked fields stay out.
              Drafts wait for you, and only your approval lets one move on.
            </p>
          </EditorialSection>
          <EditorialSection id="gate" number="06" title="One gate stands in front of everything that leaves">
            <p>
              Email and calls both go through the same safety gate. It checks seven things, and a single miss refuses
              the message and says why. In this demo, sending is test-only: messages go only to inboxes and numbers we
              own.
            </p>
            <div className="mt-4 rounded-lg border border-line bg-card p-5 shadow-md sm:p-8">
              <SafetyGateDiagram className="mx-auto max-w-sm" />
            </div>
          </EditorialSection>
          <EditorialSection id="replies" number="07" title="Replies become tasks you approve">
            <p>
              When a contact answers, Wayfinder reads the reply and turns the request into a task: send slides, get a
              referral, call to schedule. You decide what happens next, and the tracker shows where every contact
              stands.
            </p>
          </EditorialSection>
          <EditorialSection id="follow" number="08" title="Follow-up keeps its rhythm">
            <p>
              If nobody answers, a follow-up draft appears on business day 3 and again on day 7. After that the
              contact is marked stalled. A follow-up is a draft for you to approve, never something sent on its own.
            </p>
            <p>
              Every outbound email, and the start of every call, says that AI assistance was used.
            </p>
          </EditorialSection>
        </div>

        <aside aria-label="The path at a glance" className="hidden lg:block">
          <div className="sticky top-28 rounded-lg border border-line bg-card p-6 shadow-md">
            <p className="m-0 mb-4 text-micro font-semibold uppercase text-ink-3">The path at a glance</p>
            <PipelineDiagram />
          </div>
        </aside>
        <div className="rounded-lg border border-line bg-card p-5 shadow-md lg:hidden">
          <p className="m-0 mb-4 text-micro font-semibold uppercase text-ink-3">The path at a glance</p>
          <PipelineDiagram className="mx-auto max-w-sm" />
        </div>
      </div>
    </EditorialPage>
  );
}
