"use client";

import { useEffect, useState } from "react";
import { Search } from "lucide-react";
import { Input } from "@/components/ui";
import type { HistorySearchHit } from "@/lib/history/contract";
import { searchHistory } from "./client";
import { formatPartialDate, matchLabel } from "./model";

const DEBOUNCE_MS = 300;

/** Debounced search over the patient's own records. */
export function HistorySearch({ caseId, onPick }: { caseId: string; onPick: (eventId: string) => void }) {
  const [query, setQuery] = useState("");
  const [state, setState] = useState<{ q: string; hits: HistorySearchHit[]; error: string | null } | null>(null);
  const q = query.trim();

  useEffect(() => {
    if (!q) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const result = await searchHistory(caseId, q);
      if (cancelled) return;
      setState(result.ok ? { q, hits: result.data, error: null } : { q, hits: [], error: result.message });
    }, DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [caseId, q]);

  const current = q && state?.q === q ? state : null;
  return (
    <section aria-labelledby="search-heading" className="grid gap-3">
      <h2 id="search-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
        Search your records
      </h2>
      <div className="relative">
        <Search aria-hidden className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
        <Input
          type="search"
          aria-label="Search your records"
          placeholder="A gene, a medicine, or a doctor's name"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="pl-10"
        />
      </div>
      <div aria-live="polite" className="grid gap-2">
        {q && !current ? <p className="m-0 text-small text-ink-2">Searching...</p> : null}
        {current?.error ? <p role="alert" className="m-0 text-small text-danger">{current.error}</p> : null}
        {current && !current.error && current.hits.length === 0 ? (
          <p className="m-0 text-small text-ink-2">No matches in your records.</p>
        ) : null}
        {current && current.hits.length > 0 ? (
          <ul className="m-0 grid list-none border-t border-line p-0">
            {current.hits.map((hit) => {
              const body = (
                <>
                  <span className="text-body text-ink">{hit.snippet}</span>
                  <span className="flex flex-wrap items-center gap-2 text-small text-ink-2">
                    <span>Source: {hit.docTitle}</span>
                    {hit.date ? <span>{formatPartialDate(hit.date)}</span> : null}
                    <span>{matchLabel(hit.match)}</span>
                  </span>
                </>
              );
              const key = `${hit.sourceDocId}-${hit.eventId ?? hit.snippet}`;
              return (
                <li key={key}>
                  {hit.eventId ? (
                    <button
                      type="button"
                      onClick={() => onPick(hit.eventId as string)}
                      className="grid w-full gap-1 border-b border-line px-3 py-3 text-left hover:bg-paper-2 focus-ring"
                    >
                      {body}
                      <span className="text-small font-semibold text-teal">Show on timeline</span>
                    </button>
                  ) : (
                    <div className="grid gap-1 border-b border-line px-3 py-3">{body}</div>
                  )}
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
