"use client";

import Link from "next/link";
import { Skeleton } from "@/components/ui";
import type { ConditionFact } from "@/lib/rare-disease/condition-facts";
import type { ConditionCardResponse } from "@/app/api/cases/[id]/condition-card/load";
import { RARE_COPY } from "./copy";
import { factText, isInAppHref, MAX_QUOTES, pickCompactFacts } from "./condition-card-model";
import { useConditionCard } from "./useConditionCard";

function SourceLink({ source }: { source: { label: string; href: string } }) {
  const cls = "inline-flex min-h-11 items-center text-micro text-ink-3 underline decoration-line-strong underline-offset-2 hover:text-ink sm:min-h-0";
  const label = RARE_COPY.card.source(source.label);
  return isInAppHref(source.href) ? (
    <Link href={source.href} className={cls}>{label}</Link>
  ) : (
    <a href={source.href} target="_blank" rel="noopener noreferrer" className={cls}>
      {label}
      <span className="sr-only"> (opens in a new tab)</span>
    </a>
  );
}

function FactRow({ fact, lead }: { fact: ConditionFact; lead?: boolean }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <span className={lead ? "text-h4 font-semibold text-ink" : "text-small text-ink-2"}>{factText(fact)}</span>
      <SourceLink source={fact.source} />
    </li>
  );
}

function Body({ data }: { data: ConditionCardResponse }) {
  if (data.card.undiagnosed) {
    const quotes = (data.symptoms?.quotes ?? []).slice(0, MAX_QUOTES);
    return (
      <>
        <h2 className="text-small font-semibold text-ink-2">{RARE_COPY.symptoms.title}</h2>
        {quotes.length === 0 ? (
          <p className="text-small text-ink-2">{RARE_COPY.symptoms.empty}</p>
        ) : (
          <ul className="grid gap-1.5">
            {quotes.map((q) => (
              <li key={`${q.citation.href}-${q.text}`} className="flex flex-wrap items-baseline gap-x-2">
                <q className="text-small text-ink">{q.text}</q>
                <SourceLink source={q.citation} />
              </li>
            ))}
          </ul>
        )}
      </>
    );
  }
  const { name, extras } = pickCompactFacts(data.card);
  return (
    <>
      <h2 className="text-small font-semibold text-ink-2">{RARE_COPY.card.title}</h2>
      <ul className="grid gap-1">
        {name ? <FactRow fact={name} lead /> : null}
        {extras.map((f) => <FactRow key={f.id} fact={f} />)}
      </ul>
    </>
  );
}

/** Compact "Your condition" card: name, up to two more sourced facts, or the patient's own words when undiagnosed. */
export function ConditionCard({ caseId }: { caseId: string }) {
  const state = useConditionCard(caseId);
  return (
    <section
      aria-label={RARE_COPY.card.title}
      aria-busy={state.kind === "loading"}
      className="grid min-h-[7.5rem] content-start gap-1.5 rounded-lg border border-line bg-card px-4 py-3"
    >
      {state.kind === "loading" ? (
        <>
          <span className="sr-only">{RARE_COPY.card.loading}</span>
          <Skeleton className="h-4 w-28" />
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </>
      ) : state.kind === "error" ? (
        <p role="status" className="text-small text-ink-2">{RARE_COPY.card.failed}</p>
      ) : (
        <Body data={state.data} />
      )}
    </section>
  );
}
