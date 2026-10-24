import { SwarmView } from "@/components/swarm/SwarmView";

/** Content only: the case layout supplies the header, journey stepper and <main>. */
export default async function SwarmPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <section aria-labelledby="swarm-heading" className="ds-root grid gap-10">
      <header className="grid max-w-3xl gap-3">
        <p className="m-0 text-micro font-semibold uppercase text-ink-3">Research in progress</p>
        <h2 id="swarm-heading" className="m-0 font-display text-h1 font-light text-ink display-soft text-balance">
          Nine researchers, <em className="emph">one</em> map
        </h2>
        <p className="m-0 max-w-prose text-lead text-ink-2 text-pretty">
          Each search runs at the same time. Watch where they are, what they kept, and the source behind every record.
        </p>
      </header>
      <SwarmView caseId={id} />
    </section>
  );
}
