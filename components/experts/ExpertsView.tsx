"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpenCheck, RefreshCw, Route } from "lucide-react";
import { Button, EmptyState, toast } from "@/components/ui";
import type { ExpertTrace } from "@/lib/experts/contract";
import { getExperts, refreshResearch } from "./client";
import { ExpertChainCard } from "./ExpertChainCard";
import { ExpertsSkeleton } from "./ExpertsSkeleton";
import { describeTrace, refreshMessage } from "./view-model";

type State =
  | { phase: "loading" }
  | { phase: "ready"; trace: ExpertTrace | null; error: string | null };

export function ExpertsView({ caseId }: { caseId: string }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [tracing, setTracing] = useState(false);

  useEffect(() => {
    let active = true;
    void getExperts(caseId).then((result) => {
      if (!active) return;
      setState(
        result.ok
          ? { phase: "ready", trace: result.trace, error: null }
          : { phase: "ready", trace: null, error: result.message },
      );
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  const run = useCallback(async () => {
    setTracing(true);
    const result = await refreshResearch(caseId);
    setTracing(false);
    if (result.ok && result.trace) {
      setState({ phase: "ready", trace: result.trace, error: null });
      toast.success(refreshMessage(result.added));
      return;
    }
    const message = result.ok ? "The trace returned nothing." : result.message;
    setState((prev) => ({ phase: "ready", trace: prev.phase === "ready" ? prev.trace : null, error: message }));
    toast.error(message);
  }, [caseId]);

  if (state.phase === "loading") return <ExpertsSkeleton />;
  const { trace, error } = state;
  const hasTrace = trace !== null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="m-0 max-w-prose text-small text-ink-2" aria-live="polite">
          {trace ? describeTrace(trace) : "No trace yet."}
        </p>
        <Button onClick={() => void run()} loading={tracing} loadingText="Refreshing research" variant={hasTrace ? "secondary" : "primary"}>
          <RefreshCw aria-hidden />
          {hasTrace ? "Refresh research" : "Trace authors"}
        </Button>
      </div>

      {error ? (
        <p role="alert" className="m-0 rounded-md border border-line bg-card px-4 py-3 text-small text-ink">
          {error}
        </p>
      ) : null}

      {!trace ? (
        <EmptyState
          icon={<Route />}
          title="Follow the research to a real door"
          description="Tracing reads public papers about your condition, the national provider registry and institution web pages, then shows who wrote them, where they work and how to reach them. It contacts nobody and sends nothing."
          action={
            <Button onClick={() => void run()} loading={tracing} loadingText="Tracing authors">
              <BookOpenCheck aria-hidden /> Trace authors
            </Button>
          }
        />
      ) : trace.chains.length === 0 ? (
        <EmptyState
          title="No chains found yet"
          description="The trace ran but found no papers with authors we could follow. This says nothing about the people involved. Try again later."
        />
      ) : (
        <ul className="m-0 grid list-none gap-10 p-0" aria-label="Research-to-care chains">
          {trace.chains.map((chain, i) => (
            <li key={chain.id} className="min-w-0">
              <ExpertChainCard chain={chain} trace={trace} index={i} />
            </li>
          ))}
        </ul>
      )}

      <p className="m-0 max-w-prose text-small text-ink-3 text-pretty">
        This shows who published and where they work. It is not advice about treatment and does not rank anyone.
        &ldquo;Not confirmed yet&rdquo; means we could not find a source, not that the answer is no.
      </p>
    </div>
  );
}
