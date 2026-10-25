"use client";

import { useEffect, useState } from "react";
import { usedLabel } from "@/lib/accounts/used-label";
import { apiRequest } from "@/components/account/helpers/api";
import { LoadingState, Skeleton } from "@/components/ui";

export interface AgentUse {
  agent: string;
  documents: { id: string; title: string }[];
}

/** Which of the patient's documents each agent read: GET /api/cases/{id}/space/usage. */
export function AgentUsage({ caseId, refreshKey = 0 }: { caseId: string; refreshKey?: number }) {
  const [uses, setUses] = useState<AgentUse[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let active = true;
    void apiRequest<{ uses: AgentUse[] }>(`/api/cases/${encodeURIComponent(caseId)}/space/usage`).then((res) => {
      if (!active) return;
      setFailed(!res.ok);
      setUses(res.ok && res.data ? res.data.uses.filter((use) => use.documents.length > 0) : []);
    });
    return () => {
      active = false;
    };
  }, [caseId, refreshKey]);

  return (
    <section aria-labelledby="agent-usage-heading" className="grid gap-3">
      <h2 id="agent-usage-heading" className="m-0 font-display text-h3 font-normal text-ink display-soft">
        What agents used
      </h2>
      {uses === null ? (
        <LoadingState label="Loading what agents used">
          <Skeleton className="h-10 w-full" />
        </LoadingState>
      ) : failed ? (
        <p role="status" className="m-0 text-small text-ink-2">We could not load this just now.</p>
      ) : uses.length === 0 ? (
        <p className="m-0 text-body text-ink-2">No agent has used your documents yet.</p>
      ) : (
        <ul className="m-0 grid list-none gap-3 p-0">
          {uses.map((use) => (
            <li key={use.agent} className="grid gap-1.5 border-b border-line pb-3">
              <p className="m-0 text-body text-ink">
                <span className="font-semibold">{use.agent}</span>: {usedLabel(use.documents.length)}
              </p>
              <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0" aria-label={`Documents ${use.agent} used`}>
                {use.documents.map((doc) => (
                  <li key={doc.id} className="rounded-pill border border-line bg-paper-2 px-2.5 py-0.5 text-small text-ink-2">
                    {doc.title}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
