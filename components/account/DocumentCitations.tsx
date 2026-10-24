"use client";

import { useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import type { MedicalHistoryHit } from "@/lib/accounts/contract";
import { apiRequest } from "./helpers/api";

interface Response {
  available: boolean;
  results: MedicalHistoryHit[];
}

const RESULT_COUNT = 5;

/** "From your documents": cited excerpts from the signed-in account's library. Renders nothing when unavailable. */
export function DocumentCitations({ caseId, query, heading = "From your documents" }: { caseId: string; query: string; heading?: string }) {
  const [hits, setHits] = useState<MedicalHistoryHit[]>([]);

  useEffect(() => {
    const q = query.trim();
    if (!q) return;
    let live = true;
    const url = `/api/cases/${encodeURIComponent(caseId)}/my-documents?q=${encodeURIComponent(q)}&k=${RESULT_COUNT}`;
    void apiRequest<Response>(url).then((res) => {
      if (!live) return;
      setHits(res.ok && res.data?.available ? res.data.results : []);
    });
    return () => {
      live = false;
    };
  }, [caseId, query]);

  if (hits.length === 0) return null;

  return (
    <section aria-label={heading} className="grid gap-3 rounded-lg border border-line bg-paper-2/60 p-5">
      <h3 className="m-0 font-display text-h4 font-normal text-ink">{heading}</h3>
      <ul className="m-0 grid list-none gap-4 p-0">
        {hits.map((hit, index) => (
          <li key={`${hit.documentId}-${hit.page ?? 0}-${index}`} className="grid gap-1">
            <p className="m-0 flex flex-wrap items-baseline gap-x-2 text-small text-ink-2">
              <strong className="font-bold text-ink">{hit.title}</strong>
              {hit.page ? <span>p. {hit.page}</span> : null}
              {hit.dateOfService ? <span>{hit.dateOfService}</span> : null}
            </p>
            <p className="m-0 line-clamp-2 text-small text-ink-2">{hit.content}</p>
            <a
              href={`/api/account/documents/${hit.documentId}/file`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex w-fit items-center gap-1.5 rounded-sm text-small font-semibold text-teal hover:text-teal-ink focus-ring [&_svg]:size-3.5"
            >
              Open document<ExternalLink aria-hidden /><span className="sr-only"> {hit.title} in a new tab</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
