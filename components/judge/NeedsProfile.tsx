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
          title={ref.title}
          className="focus-ring inline-flex size-6 items-center justify-center rounded-pill border border-line-strong bg-card text-small font-semibold text-teal no-underline hover:border-teal/50"
        >
          {index + 1}
          <span className="sr-only">: {ref.title} (opens in a new tab)</span>
        </a>
      ))}
    </span>
  );
}

function Item({ text, plain, needs, evidenceIds }: { text: string; plain: string; needs: CareNeeds; evidenceIds: string[] }) {
  return (
    <li className="grid min-w-0 gap-1 border-b border-line py-3">
      <p className="m-0 break-words text-body text-ink">{text}</p>
      <p className="m-0 break-words text-small text-ink-2">{plain}</p>
      <SourceNumbers refs={lookupSources(evidenceIds, needs)} />
    </li>
  );
}

type Heading = "h2" | "h3" | "h4";
const SUB: Record<Heading, "h3" | "h4" | "h5"> = { h2: "h3", h3: "h4", h4: "h5" };

function Block({
  id,
  title,
  hint,
  as: Tag,
  children,
}: {
  id: string;
  title: string;
  hint?: string;
  as: "h3" | "h4" | "h5";
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-1">
      <Tag id={id} className="m-0 text-small font-semibold text-ink">
        {title}
      </Tag>
      {hint ? <p className="m-0 text-small text-ink-2">{hint}</p> : null}
      <ul className="m-0 grid list-none border-t border-line p-0">{children}</ul>
    </section>
  );
}

/**
 * What the condition needs (needs analyst output). Judge view. `headingAs: null` drops the panel heading when a
 * surrounding Details already names it; blocks then use `blockAs`.
 */
export function NeedsProfile({
  needs,
  headingAs = "h3",
  blockAs = "h4",
}: {
  needs: CareNeeds;
  /** Level of the panel heading, or null to omit it when a surrounding Details already names the panel. */
  headingAs?: Heading | null;
  /** Block heading level when `headingAs` is null. */
  blockAs?: "h3" | "h4" | "h5";
}) {
  const questions = groupQuestions(needs);
  const B = headingAs ? SUB[headingAs] : blockAs;
  const Q = SUB[B as Heading] ?? "h5";
  const HeadingTag = headingAs ?? "h3";
  return (
    <section aria-labelledby={headingAs ? "needs-heading" : undefined} aria-label={headingAs ? undefined : "What the condition needs"} className="grid min-w-0 gap-5">
      <header className="grid gap-1">
        {headingAs ? (
          <HeadingTag id="needs-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft text-balance">
            What the condition needs
          </HeadingTag>
        ) : null}
        <p className="m-0 text-small text-ink-2">What to look for in a service. Not medical advice.</p>
      </header>

      {needs.personal.notes.length > 0 ? (
        <ul aria-label="Notes from your case" className="m-0 grid list-none gap-1 border-l-2 border-teal p-0 pl-4">
          {needs.personal.notes.map((note) => (
            <li key={note.id} className="break-words text-small text-ink">
              {note.text}
            </li>
          ))}
        </ul>
      ) : null}

      {needs.specialties.length > 0 ? (
        <Block as={B} id="needs-specialists" title="Specialists to look for">
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
        <Block as={B} id="needs-centers" title="What a center should offer">
          {needs.centerCapabilities.map((c) => (
            <Item key={c.id} needs={needs} evidenceIds={c.evidenceIds} text={c.text} plain={c.plain} />
          ))}
        </Block>
      ) : null}
      {(needs.workup ?? []).length > 0 ? (
        <Block as={B} id="needs-workup" title="What to look for in a diagnostic workup" hint="Kinds of testing services to look for. Never a diagnosis.">
          {needs.workup.map((w) => (
            <Item key={w.id} needs={needs} evidenceIds={w.evidenceIds} text={w.text} plain={w.plain} />
          ))}
        </Block>
      ) : null}
      {needs.redFlags.length > 0 ? (
        <Block as={B} id="needs-red-flags" title="Red flags">
          {needs.redFlags.map((r) => (
            <Item key={r.id} needs={needs} evidenceIds={r.evidenceIds} text={r.text} plain={r.plain} />
          ))}
        </Block>
      ) : null}
      {needs.trialEligibility.length > 0 ? (
        <Block as={B} id="needs-trials" title="What trial listings ask about" hint="Things to check with the study team, never to decide on your own.">
          {needs.trialEligibility.map((t) => (
            <Item key={t.id} needs={needs} evidenceIds={t.evidenceIds} text={t.text} plain={t.plain} />
          ))}
        </Block>
      ) : null}
      {needs.supportNeeds.length > 0 ? (
        <Block as={B} id="needs-support" title="Support and aid">
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
          <B id="needs-questions" className="m-0 text-small font-semibold text-ink">
            Questions to ask
          </B>
          {questions.map((group) => (
            <div key={group.kind} className="grid gap-2">
              <Q className="m-0 text-small font-normal text-ink-2">{group.label}</Q>
              <ul className="m-0 grid list-none border-t border-line p-0">
                {group.items.map((q) => (
                  <li key={q.id} className="grid min-w-0 gap-1 border-b border-line py-3">
                    <p className="m-0 break-words text-body text-ink">{q.text}</p>
                    <SourceNumbers refs={lookupSources(q.evidenceIds, needs)} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
      ) : null}

      <p className="m-0 text-small text-ink-2">
        {needs.sources.length} {needs.sources.length === 1 ? "source" : "sources"} &middot; built in{" "}
        {builtInSeconds(needs.elapsedMs)} s{needs.fromCache ? " · reused from a recent analysis" : ""}
      </p>
    </section>
  );
}
