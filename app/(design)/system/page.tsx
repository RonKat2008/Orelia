import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteFooter } from "@/components/shell/SiteFooter";
import { SiteHeader } from "@/components/shell/SiteHeader";
import { Badge, Button, Card, CardTitle, EvidenceBadge, Input, Label, SourceChip, Stepper } from "@/components/ui";
import {
  ActionsSection,
  EvidenceSection,
  FormsSection,
  NavigationSection,
  OverlaySection,
  StatusSection,
  SurfaceSection,
} from "./_components/Gallery";
import { V2Section } from "./_components/V2Gallery";
import { Emph, Section } from "./_components/Section";
import { ColorSection, MotionSection, ShapeSection, TypeSection } from "./_components/Tokens";
import { JOURNEY } from "./_components/tokens-data";

export const metadata: Metadata = {
  title: "Design system | Wayfinder",
  description: "Clear Day: Wayfinder's tokens, type, motion and UI primitives in both themes.",
};

const CONTENTS = [
  ["color", "Colour"],
  ["type", "Type"],
  ["space", "Space"],
  ["motion", "Motion"],
  ["actions", "Buttons"],
  ["evidence", "Evidence"],
  ["surfaces", "Surfaces"],
  ["forms", "Forms"],
  ["navigation", "Navigation"],
  ["overlays", "Overlays"],
  ["status", "Status"],
  ["v2", "v2 primitives"],
  ["pair", "Both themes"],
] as const;

function Specimen({ theme }: { theme: "light" | "dark" }) {
  const id = `pair-${theme}`;
  return (
    <div data-theme={theme} className="grain rounded-lg border border-line bg-paper p-5 text-ink sm:p-8">
      <p className="m-0 mb-5 font-mono text-mono text-ink-3">{theme === "light" ? "Clear Day" : "Night"}</p>
      <Card variant="raised" padding="md">
        <div className="flex flex-wrap gap-2">
          <Badge tone="gold">Best match</Badge>
          <Badge tone="warn">Awaiting approval</Badge>
        </div>
        <CardTitle className="mt-3">
          A trial that <em className="emph">fits</em>
        </CardTitle>
        <p className="mt-2 text-body text-ink-2">Recruiting adults with your diagnosis, 40 minutes away.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <SourceChip url="https://clinicaltrials.gov/study/NCT05123456" date="2026-10-02" verified />
          <EvidenceBadge level="moderate" sources={1} />
        </div>
        <div className="mt-5 grid gap-2">
          <Label htmlFor={`${id}-q`}>Question for the study team</Label>
          <Input id={`${id}-q`} placeholder="Are remote visits possible?" />
        </div>
        <div className="mt-5 flex flex-wrap gap-3">
          <Button>Approve email</Button>
          <Button variant="secondary">Edit</Button>
          <Button variant="link">Sources</Button>
        </div>
      </Card>
      <div className="mt-6">
        <Stepper steps={JOURNEY.slice(0, 4)} current={2} />
      </div>
    </div>
  );
}

export default function DesignSystemPage() {
  return (
    <div className="ds-root bg-paper text-ink">
      <SiteHeader />

      <section aria-label="About this design system" className="grain overflow-hidden border-b border-line bg-paper-2">
        <div className="page-container grid gap-10 py-section lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-end">
          <div className="grid gap-6">
            <p className="m-0 flex items-center gap-3 text-micro font-semibold uppercase text-ink-3">
              <span aria-hidden className="h-px w-10 bg-terracotta" /> Wayfinder design system
            </p>
            <h1 className="m-0 max-w-[14ch] font-display text-display font-light text-ink display-soft text-balance">
              <Emph text="A calm place to *find* your way." />
            </h1>
            <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">
              Clear Day is crisp, calm and human: the feeling of a trusted friend who has done the research and
              written it down clearly. Every token and primitive below is live, in both themes.
            </p>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg">
                <a href="#actions">
                  See the primitives <ArrowRight aria-hidden />
                </a>
              </Button>
              <Button asChild size="lg" variant="secondary">
                <Link href="/">Back to Wayfinder</Link>
              </Button>
            </div>
          </div>
          <nav aria-label="On this page" className="rounded-lg border border-line bg-card/80 p-5 shadow-md backdrop-blur-sm">
            <p className="m-0 mb-3 text-micro font-semibold uppercase text-ink-3">On this page</p>
            <ol className="m-0 grid list-none grid-cols-2 gap-x-4 gap-y-1 p-0 text-small">
              {CONTENTS.map(([id, label], i) => (
                <li key={id}>
                  <a
                    href={`#${id}`}
                    className="flex gap-2 rounded-sm py-1 text-ink no-underline hover:text-teal focus-ring"
                  >
                    <span className="font-mono text-mono text-ink-3">{String(i + 1).padStart(2, "0")}</span>
                    {label}
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>
      </section>

      <main id="main" className="page-container">
        <ColorSection />
        <TypeSection />
        <ShapeSection />
        <MotionSection />
        <ActionsSection />
        <EvidenceSection />
        <SurfaceSection />
        <FormsSection />
        <NavigationSection />
        <OverlaySection />
        <StatusSection />
        <V2Section />
        <Section
          id="pair"
          index="13 / Both themes"
          title={<Emph text="Same system, *two* lights." />}
          intro="The same primitives with the theme forced on a wrapper via data-theme. Night is a deep blue-grey (#0b111b); teal and the accent hues lighten to keep every text token at 6.5:1 or better."
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <Specimen theme="light" />
            <Specimen theme="dark" />
          </div>
        </Section>
      </main>

      <SiteFooter />
    </div>
  );
}
