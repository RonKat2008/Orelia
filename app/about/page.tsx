import Link from "next/link";
import { EditorialHero, EditorialPage, EditorialSection } from "@/components/pitch/Editorial";
import { Button } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";

export const metadata = {
  title: "About Wayfinder",
  description: "Wayfinder gets you seen by the specialists, trials, advocacy groups, and aid programs you choose.",
};

const KINDS = [
  { title: "Specialists and centers", text: "People and programs who see your condition, with the public door to reach them." },
  { title: "Recruiting trials", text: "Studies that are open now, with the contact for screening." },
  { title: "Advocacy groups", text: "Organizations that run for people with your condition." },
  { title: "Financial and travel aid", text: "Programs that help with the cost of getting to care." },
] as const;

export default function AboutPage() {
  return (
    <EditorialPage>
      <EditorialHero
        compact
        eyebrow="About"
        title={
          <>
            Expert finders tell you who the expert is. Wayfinder gets you <em className="emph">seen</em>.
          </>
        }
        lede="A rare diagnosis often means knowing the right names but not how to reach them. Wayfinder does the legwork between a name and an appointment, and keeps you in charge of every step."
      >
        <Button asChild size="lg">
          <Link href="/start">Start a case</Link>
        </Button>
        <Button asChild size="lg" variant="secondary">
          <Link href="/how-it-works">See how it works</Link>
        </Button>
      </EditorialHero>

      <div className="page-container grid gap-14 py-section">
        <div className="grid gap-14 lg:grid-cols-2">
          <EditorialSection id="gap" title="The gap is the last mile">
            <p>
              Directories and search tools are good at telling you who the expert is. The hard part comes after:
              finding the intake door, asking for the right thing, sending the right records, and following up when
              nobody answers.
            </p>
            <p>
              Wayfinder takes that on. It drafts the contact, waits for your approval, sends it, reads the replies,
              and turns each request into a task for you, until there is an appointment, a screening, a membership or
              an application.
            </p>
          </EditorialSection>
          <EditorialSection id="limits" title="What it is not">
            <p>
              Wayfinder is not a doctor and does not act like one. It never interprets a report, recommends a
              treatment or ranks care options. If you have new or worsening symptoms, contact your care team or call
              911.
            </p>
            <p>
              Its limits are part of the product. <Link href="/trust" className="text-teal underline underline-offset-4 focus-ring rounded-sm">Read every promise and how it is enforced.</Link>
            </p>
          </EditorialSection>
        </div>

        <section aria-labelledby="kinds-heading" className="grid gap-6 border-t border-line pt-8">
          <h2 id="kinds-heading" className="m-0 font-display text-h2 font-light display-soft text-balance">
            Four kinds of help, one place
          </h2>
          <ul className="m-0 grid list-none gap-5 p-0 sm:grid-cols-2">
            {KINDS.map((kind, i) => (
              <li key={kind.title} className={i % 2 === 1 ? "sm:translate-y-6" : undefined}>
                <Card variant={i === 0 ? "raised" : "flat"} className="h-full">
                  <CardTitle>{kind.title}</CardTitle>
                  <p className="m-0 mt-2 text-body text-ink-2">{kind.text}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="demo-heading" className="grid gap-3 rounded-lg border border-gold/70 bg-gold-soft p-6 sm:p-8">
          <h2 id="demo-heading" className="m-0 font-display text-h3 font-normal display-soft">
            About this demo
          </h2>
          <p className="m-0 max-w-prose text-body text-ink">
            The walkthrough uses a synthetic report. It is not a real patient. Nothing in the demo is sent to a real
            hospital, clinician, organization or phone number; outbound mail is limited to test addresses we own.
          </p>
        </section>
      </div>
    </EditorialPage>
  );
}
