"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Button, EmptyState } from "@/components/ui";
import { loadNeedsJudge, type NeedsJudgeResult } from "@/components/judge/client";
import { CasePage } from "@/components/outreach/CasePage";
import type { VerificationsResponse } from "@/lib/verification/contract";
import {
  initialSelection,
  shouldPersistInitialSelection,
  topPicks,
  loadHomeState,
  loadShortlist,
  selectionKey,
  type ShortlistCard,
} from "./data";
import { ShortlistConsole } from "./ShortlistConsole";
import { ShortlistSkeleton } from "./ShortlistSkeleton";
import { SelectionTray } from "./SelectionTray";
import { loadInsurer, loadVerifications } from "./verify-client";
import { filtersToQuery, parseFilters, type ShortlistFilters } from "./view-model";

/** At most 5 active contacts per case (outbound gate rule, lib/safety). */
const MAX_SELECTED = 5;

export function selectionLimit(): number {
  return MAX_SELECTED;
}

function readStoredSelection(caseId: string): string[] | null {
  try {
    const stored = sessionStorage.getItem(`wayfinder.selected.${caseId}`);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as unknown;
    if (Array.isArray(parsed) && parsed.every((item) => typeof item === "string")) return parsed;
  } catch {
    return null;
  }
  return null;
}

function writeStoredSelection(caseId: string, ids: string[]) {
  try {
    sessionStorage.setItem(`wayfinder.selected.${caseId}`, JSON.stringify(ids));
  } catch {
    // Selection still works for this visit when storage is blocked.
  }
}

interface Loaded {
  items: ShortlistCard[];
  summary: string | null;
  suggested: string[];
  preview: boolean;
  error: string | null;
  homeState: string | null;
}

function Notices({ loaded }: { loaded: Loaded }) {
  return (
    <>
      {loaded.error ? (
        <p role="alert" className="m-0 text-body text-ink">
          <span className="font-semibold">There is a problem: </span>
          {loaded.error}
        </p>
      ) : null}
      {loaded.preview ? (
        <p className="m-0 text-small text-ink-2">
          This is a sample list with real source links. Your own list replaces it when the search finishes.
        </p>
      ) : null}
    </>
  );
}

/**
 * Shortlist (docs/DESIGN-v2.md 7.6). Container: loads the shortlist, the needs/judge result, phone verifications and
 * the insurer once, owns the selection (session storage, as before), and renders the judge console. Patient view
 * is lane C's PatientShortlist (switched in the page file). The selection limit, suggested pre-selection and stored-selection rules are unchanged.
 */
export function ShortlistView({ caseId }: { caseId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [judgeResult, setJudgeResult] = useState<NeedsJudgeResult | null>(null);
  const [verifications, setVerifications] = useState<VerificationsResponse | null>(null);
  const [insurer, setInsurer] = useState<string | null>(null);
  const limit = selectionLimit();

  useEffect(() => {
    let active = true;
    const stored = readStoredSelection(caseId);
    void Promise.all([loadShortlist(caseId), loadHomeState(caseId)]).then(([result, homeState]) => {
      if (!active) return;
      setLoaded({
        items: result.payload.items,
        summary: result.payload.curationSummary,
        suggested: result.payload.suggested,
        preview: result.preview,
        error: result.error,
        homeState,
      });
      const initial = initialSelection(stored, result.payload.suggested, limit);
      setSelected(initial);
      if (shouldPersistInitialSelection(stored, initial)) writeStoredSelection(caseId, initial);
    });
    return () => {
      active = false;
    };
  }, [caseId, limit]);

  useEffect(() => {
    let active = true;
    void loadNeedsJudge(caseId).then((next) => {
      if (active) setJudgeResult(next);
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  const refreshVerifications = useCallback(() => {
    void loadVerifications(caseId).then(setVerifications);
  }, [caseId]);

  useEffect(() => {
    let active = true;
    void Promise.all([loadVerifications(caseId), loadInsurer(caseId)]).then(([found, name]) => {
      if (!active) return;
      setVerifications(found);
      setInsurer(name);
    });
    return () => {
      active = false;
    };
  }, [caseId]);

  const setFilters = useCallback(
    (next: ShortlistFilters) => {
      const query = filtersToQuery(next);
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router],
  );

  const choose = useCallback(
    (next: string[]) => {
      setSelected(next);
      writeStoredSelection(caseId, next);
    },
    [caseId],
  );

  const toggle = useCallback(
    (id: string) => {
      if (selected.includes(id)) choose(selected.filter((item) => item !== id));
      else if (selected.length < limit) choose([...selected, id]);
    },
    [choose, limit, selected],
  );

  const items = useMemo(() => loaded?.items ?? [], [loaded]);
  const chosen = selected.flatMap((id) => items.filter((card) => selectionKey(card) === id));
  const lede = loaded && items.length > 0 ? `${items.length} found, ranked with sources. Pick up to ${limit} to contact.` : undefined;

  return (
    <CasePage title="Shortlist" lede={lede} className="pb-28">
      {!loaded ? (
        <ShortlistSkeleton />
      ) : (
        <>
          <Notices loaded={loaded} />
          {items.length === 0 ? (
            <EmptyState
              title="No one to choose from yet"
              description="When the search finishes, the best fits appear here, each with its sources."
              action={
                <Button asChild>
                  <Link href={`/cases/${caseId}/swarm`}>Check the search</Link>
                </Button>
              }
            />
          ) : (
            <>
              <ShortlistConsole
                  caseId={caseId}
                  items={items}
                  filters={filters}
                  homeState={loaded.homeState}
                  onFiltersChange={setFilters}
                  selected={selected}
                  limit={limit}
                  onToggle={toggle}
                  summary={loaded.summary}
                  judgeResult={judgeResult}
                  verifications={verifications}
                  insurer={insurer}
                  onVerificationChanged={refreshVerifications}
                />
                <SelectionTray
                  caseId={caseId}
                  chosen={chosen}
                  limit={limit}
                  onRemove={(id) => choose(selected.filter((item) => item !== id))}
                  onPickTop={() => choose(topPicks(items, loaded.suggested, limit))}
                  canPickTop={topPicks(items, loaded.suggested, limit).join() !== selected.join()}
                />
            </>
          )}
        </>
      )}
    </CasePage>
  );
}
