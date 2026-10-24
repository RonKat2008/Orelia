"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { RefreshCw } from "lucide-react";
import {
  Badge,
  Button,
  EmptyState,
  JudgeOnly,
  List,
  ListRow,
  PageHeader,
  PatientOnly,
  Sheet,
  TwoPane,
  toast,
} from "@/components/ui";
import type { ExpertChain, ExpertTrace } from "@/lib/experts/contract";
import { getExperts, refreshResearch } from "./client";
import { ExpertChainCard } from "./ExpertChainCard";
import { ExpertsSkeleton } from "./ExpertsSkeleton";
import { describeTrace, refreshMessage, rowBadge, rowMeta } from "./view-model";

/** Heading level of the page title: the case shell prints no h1 now, so each page owns it. */
const CASE_PAGE_HEADING = "h1" as const;

type State =
  | { phase: "loading" }
  | { phase: "ready"; trace: ExpertTrace | null; error: string | null };

function ExpertRows({
  chains,
  selectedId,
  onSelect,
}: {
  chains: readonly ExpertChain[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  return (
    <List label="Experts we found">
      {chains.map((chain) => {
        const badge = rowBadge(chain);
        return (
          <ListRow
            key={chain.id}
            title={chain.author.name}
            meta={rowMeta(chain)}
            badges={badge ? [<Badge key="v" tone={badge.tone}>{badge.label}</Badge>] : undefined}
            onSelect={() => onSelect(chain.id)}
            selected={selectedId === chain.id}
          />
        );
      })}
    </List>
  );
}

export function ExpertsView({ caseId }: { caseId: string }) {
  const [state, setState] = useState<State>({ phase: "loading" });
  const [tracing, setTracing] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const header = (action?: ReactNode) => (
    <PageHeader
      as={CASE_PAGE_HEADING}
      eyebrow="Experts"
      title="Experts who study your condition"
      lede="We follow each author to where they work and how to reach them. We contact no one here."
      action={action}
    />
  );

  if (state.phase === "loading") {
    return (
      <>
        {header()}
        <ExpertsSkeleton />
      </>
    );
  }
  const { trace, error } = state;
  const hasTrace = trace !== null;
  const selected = trace?.chains.find((chain) => chain.id === selectedId) ?? null;

  const action = (
    <Button
      onClick={() => void run()}
      loading={tracing}
      loadingText={hasTrace ? "Refreshing research" : "Tracing authors"}
      variant={hasTrace ? "secondary" : "primary"}
    >
      <RefreshCw aria-hidden />
      {hasTrace ? "Refresh research" : "Trace authors"}
    </Button>
  );

  const detail = selected && trace ? <ExpertChainCard chain={selected} trace={trace} /> : null;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-8">
      {header(action)}

      {trace ? (
        <p className="m-0 -mt-4 max-w-prose text-small text-ink-2" aria-live="polite">
          {describeTrace(trace)}
        </p>
      ) : null}

      {error ? (
        <p role="alert" className="m-0 border-l-2 border-danger pl-4 text-small text-ink">
          {error}
        </p>
      ) : null}

      {!trace ? (
        <EmptyState
          title="No experts traced yet"
          description="Tracing reads public papers about your condition and the pages of the places where authors work."
        />
      ) : trace.chains.length === 0 ? (
        <EmptyState
          title="No experts found yet"
          description="We found no papers with authors we could follow. That says nothing about the people involved. Try again later."
        />
      ) : (
        <>
          <PatientOnly>
            <ExpertRows chains={trace.chains} selectedId={selectedId} onSelect={setSelectedId} />
            <Sheet open={Boolean(detail)} onOpenChange={(open) => !open && setSelectedId(null)} title={selected?.author.name ?? "Expert"}>
              {selected && trace ? <ExpertChainCard chain={selected} trace={trace} showName={false} /> : null}
            </Sheet>
          </PatientOnly>
          <JudgeOnly>
            <TwoPane
              listLabel="Experts"
              detailLabel="Selected expert"
              list={<ExpertRows chains={trace.chains} selectedId={selectedId} onSelect={setSelectedId} />}
              detail={detail}
              emptyDetail={<EmptyState title="Pick an expert" description="Their papers, workplace and sources show here." />}
              detailOpen={Boolean(detail)}
              onDetailOpenChange={(open) => !open && setSelectedId(null)}
              detailTitle={selected?.author.name}
            />
          </JudgeOnly>
        </>
      )}

      <p className="m-0 max-w-prose text-small text-ink-3 text-pretty">
        This shows who published and where they work. It is not treatment advice and does not rank anyone.
      </p>
    </div>
  );
}
