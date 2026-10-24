import type { ReactNode } from "react";
import type { CareNeeds } from "@/lib/contracts/care-needs";
import { builtInSeconds, groupQuestions, lookupSources, type SourceRef } from "./view-model";

export function SourceNumbers({ refs }: { refs: SourceRef[] }) {
  if (refs.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {refs.map((ref, index) => (
        <a
          key={ref.id}
          href={ref.url}
          target="_blank"
          rel="noreferrer"
          aria-label={`${ref.title} (opens in a new tab)`}
          title={ref.title}
          className="focus-ring inline-flex size-6 items-center justify-center rounded-pill border border-line-strong bg-card text-micro font-semibold text-teal no-underline hover:border-teal/50"
        >
          {index + 1}
        </a>
      ))}
    </span>
  );
}

function Item({ text, plain, needs, evidenceIds }: { text: string; plain: string; needs: CareNeeds; evidenceIds: string[] }) {
  return (
    <li className="grid min-w-0 gap-1 rounded-md border border-line bg-card px-4 py-3">
      <p className="m-0 break-words text-body text-ink">{text}</p>
      <p className="m-0 break-words text-small text-ink-2">{plain}</p>
      <SourceNumbers refs={lookupSources(evidenceIds, needs)} />
    </li>
  );
}

function Block({ id, title, hint, children }: { id: string; title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <h3 id={id} className="m-0 text-micro font-semibold uppercase text-teal">
        {title}
      </h3>
      {hint ? <p className="m-0 text-small text-ink-2">{hint}</p> : null}
      <ul className="m-0 grid list-none gap-2 p-0">{children}</ul>
    </section>
  );
}

export function NeedsProfile({ needs }: { needs: CareNeeds }) {
  const questions = groupQuestions(needs);
  return (
    <section aria-labelledby="needs-heading" className="grid min-w-0 gap-5 rounded-lg border border-line bg-paper-2 p-5 sm:p-6">
      <header className="grid gap-1">
        <h2 id="needs-heading" className="m-0 font-display text-h2 font-light text-ink display-soft text-balance">
          What your condition needs
        </h2>
        <p className="m-0 text-small text-ink-2">What to look for in a service. Not medical advice.</p>
      </header>

      {needs.personal.notes.length > 0 ? (
        <ul aria-label="Notes from your case" className="m-0 grid list-none gap-1 border-l-2 border-terracotta p-0 pl-4">
          {needs.personal.notes.map((note) => (
            <li key={note.id} className="break-words text-small text-ink">
              {note.text}
            </li>
          ))}
        </ul>
      ) : null}

      {needs.specialties.length > 0 ? (
        <Block id="needs-specialists" title="Specialists to look for">
          {needs.specialties.map((s) => (
            <Item
              key={s.id}
              needs={needs}
              evidenceIds={s.evidenceIds}
              text={s.subspecialty ? `${s.specialty}, ${s.subspecialty}` : s.specialty}
              plain={s.plain}
            />
          ))}
        </Block>
      ) : null}
      {needs.centerCapabilities.length > 0 ? (
        <Block id="needs-centers" title="What a center should offer">
          {needs.centerCapabilities.map((c) => (
            <Item key={c.id} needs={needs} evidenceIds={c.evidenceIds} text={c.text} plain={c.plain} />
          ))}
        </Block>
      ) : null}
      {needs.redFlags.length > 0 ? (
        <Block id="needs-red-flags" title="Red flags">
          {needs.redFlags.map((r) => (
            <Item key={r.id} needs={needs} evidenceIds={r.evidenceIds} text={r.text} plain={r.plain} />
          ))}
        </Block>
      ) : null}
      {needs.trialEligibility.length > 0 ? (
        <Block id="needs-trials" title="What trial listings ask about" hint="Things to check with the study team, never to decide on your own.">
          {needs.trialEligibility.map((t) => (
            <Item key={t.id} needs={needs} evidenceIds={t.evidenceIds} text={t.text} plain={t.plain} />
          ))}
        </Block>
      ) : null}
      {needs.supportNeeds.length > 0 ? (
        <Block id="needs-support" title="Support and aid">
          {needs.supportNeeds.map((s) => (
            <Item
              key={s.id}
              needs={needs}
              evidenceIds={s.evidenceIds}
              text={s.text}
              plain={s.organizations.length > 0 ? `${s.plain} Named in sources: ${s.organizations.join(", ")}.` : s.plain}
            />
          ))}
        </Block>
      ) : null}
      {questions.length > 0 ? (
        <section aria-labelledby="needs-questions" className="grid gap-3">
          <h3 id="needs-questions" className="m-0 text-micro font-semibold uppercase text-teal">
            Questions to ask
          </h3>
          {questions.map((group) => (
            <div key={group.kind} className="grid gap-2">
              <h4 className="m-0 text-small font-semibold text-ink">{group.label}</h4>
              <ul className="m-0 grid list-none gap-2 p-0">
                {group.items.map((q) => (
                  <li key={q.id} className="grid min-w-0 gap-1 rounded-md border border-line bg-card px-4 py-3">
                    <p className="m-0 break-words text-body text-ink">{q.text}</p>
                    <SourceNumbers refs={lookupSources(q.evidenceIds, needs)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <p className="m-0 text-micro text-ink-3">
        {needs.sources.length} {needs.sources.length === 1 ? "source" : "sources"} &middot; built in{" "}
        {builtInSeconds(needs.elapsedMs)} s{needs.fromCache ? " · reused from a recent analysis" : ""}
      </p>
    </section>
  );
}
