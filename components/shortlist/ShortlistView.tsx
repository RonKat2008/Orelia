"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Compass, SlidersHorizontal, Undo2 } from "lucide-react";
import { WeightsPanel } from "@/components/ranking/WeightsPanel";
import { RANKING_WEIGHTS, type RankingWeights } from "@/config/ranking";
import {
  Badge,
  Button,
  EmptyState,
  Sheet,
  SheetClose,
  toast,
} from "@/components/ui";
import {
  bandShortlist,
  initialSelection,
  loadHomeState,
  loadShortlist,
  orderByPreview,
  previewOrder,
  type OrderPreview,
  type ShortlistCard,
} from "./data";
import { FilterBar } from "./FilterBar";
import { ResourceCard, selectionLimit, type CardVariant } from "./ResourceCard";
import { SelectionTray } from "./SelectionTray";
import { ShortlistSkeleton } from "./ShortlistSkeleton";
import {
  filtersToQuery,
  GROUPS,
  matchesFilters,
  parseFilters,
  type ShortlistFilters,
} from "./view-model";

function readStoredSelection(caseId: string): string[] | null {
  try {
    const stored = sessionStorage.getItem(`wayfinder.selected.${caseId}`);
    if (!stored) return null;
    const parsed = JSON.parse(stored) as unknown;
    if (
      Array.isArray(parsed) &&
      parsed.every((item) => typeof item === "string")
    )
      return parsed;
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
  preview: boolean;
  homeState: string | null;
}

function CardGroup({
  cards,
  label,
  variant,
  selected,
  limit,
  onToggle,
  scoreScale,
}: {
  cards: ShortlistCard[];
  label: string;
  variant: CardVariant;
  selected: string[];
  limit: number;
  onToggle: (id: string) => void;
  scoreScale: number | undefined;
}) {
  return (
    <ol
      aria-label={label}
      className={`m-0 grid grid-cols-[minmax(0,1fr)] list-none gap-6 p-0 ${variant === "feature" ? "" : "lg:grid-cols-2"}`}
    >
      {cards.map((card) => (
        <li
          key={card.resource.id}
          className="min-w-0 animate-in fade-in-0 slide-in-from-bottom-2 duration-500 ease-out-expo motion-reduce:animate-none"
        >
          <ResourceCard
            card={card}
            variant={variant}
            selected={selected.includes(card.resource.id)}
            atCap={selected.length >= limit}
            onToggle={onToggle}
            scoreScale={scoreScale}
          />
        </li>
      ))}
    </ol>
  );
}

export function ShortlistView({ caseId }: { caseId: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const filters = useMemo(() => parseFilters(searchParams), [searchParams]);

  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [weights, setWeights] = useState<RankingWeights>({
    ...RANKING_WEIGHTS,
  });
  const [order, setOrder] = useState<OrderPreview | null>(null);
  const [panelOpen, setPanelOpen] = useState(false);
  const limit = selectionLimit();

  useEffect(() => {
    let active = true;
    const stored = readStoredSelection(caseId);
    void Promise.all([loadShortlist(caseId), loadHomeState(caseId)]).then(
      ([result, homeState]) => {
        if (!active) return;
        setLoaded({
          items: result.payload.items,
          summary: result.payload.curationSummary,
          preview: result.preview,
          homeState,
        });
        setSelected(initialSelection(stored, result.payload.suggested, limit));
      },
    );
    return () => {
      active = false;
    };
  }, [caseId, limit]);

  const setFilters = useCallback(
    (next: ShortlistFilters) => {
      const query = filtersToQuery(next);
      router.replace(query ? `${pathname}?${query}` : pathname, {
        scroll: false,
      });
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

  async function applyWeights(next: RankingWeights) {
    setWeights(next);
    try {
      setOrder(await previewOrder(caseId, next));
    } catch (cause) {
      toast.error(
        cause instanceof Error
          ? cause.message
          : "Preview ranking is unavailable.",
      );
    }
  }

  const items = useMemo(() => loaded?.items ?? [], [loaded]);
  const visible = useMemo(
    () =>
      items.filter((card) =>
        matchesFilters(card, filters, loaded?.homeState ?? null),
      ),
    [items, filters, loaded?.homeState],
  );
  const scoreScale =
    items.reduce((top, item) => Math.max(top, item.score), 0) || undefined;
  const counts = useMemo(
    () =>
      Object.fromEntries(
        GROUPS.map((group) => [
          group.id,
          items.filter((item) => item.group === group.id).length,
        ]),
      ),
    [items],
  );
  const chosen = selected.flatMap((id) =>
    items.filter((card) => card.resource.id === id),
  );

  if (!loaded) return <ShortlistSkeleton />;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-12 pb-28">
      {loaded.preview ? (
        <p className="m-0 flex flex-wrap items-center gap-2 rounded-md border border-gold/70 bg-gold-soft px-4 py-3 text-small text-ink">
          <Badge tone="gold">Sample</Badge>
          Sample shortlist with source links. Your own ranking replaces it when
          the research service answers.
        </p>
      ) : null}

      {loaded.summary ? (
        <section
          aria-label="What the curator found"
          className="grid gap-2 border-l-2 border-terracotta pl-5"
        >
          <p className="m-0 text-micro font-semibold uppercase text-ink-3">
            The curator&rsquo;s read
          </p>
          <p className="m-0 max-w-prose font-display text-body text-ink text-pretty">
            {loaded.summary}
          </p>
        </section>
      ) : null}

      {items.length === 0 ? (
        <EmptyState
          icon={<Compass />}
          title="No ranked resources yet"
          description="Research has not returned a shortlist for this case. When it does, the best fits will appear here, each with its sources."
          action={
            <Button asChild>
              <Link href={`/cases/${caseId}/swarm`}>Check the research</Link>
            </Button>
          }
        />
      ) : (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
            <FilterBar
              filters={filters}
              counts={counts}
              canFilterState={loaded.homeState !== null}
              onChange={setFilters}
            />
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="m-0 text-small text-ink-2">
                {order
                  ? "Previewing a custom order. The saved shortlist is unchanged."
                  : "Ordered by Wayfinder’s default weights."}
              </p>
              <div className="flex gap-2">
                {order ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setOrder(null);
                      setWeights({ ...RANKING_WEIGHTS });
                    }}
                  >
                    <Undo2 aria-hidden /> Back to default order
                  </Button>
                ) : null}
                <Sheet
                  open={panelOpen}
                  onOpenChange={setPanelOpen}
                  title="Tune the order"
                  description="Change what matters most and preview a new order. Nothing is saved or sent."
                  trigger={
                    <Button variant="secondary" size="sm">
                      <SlidersHorizontal aria-hidden /> Tune the order
                    </Button>
                  }
                  footer={
                    <SheetClose>
                      <Button variant="secondary">Done</Button>
                    </SheetClose>
                  }
                >
                  <WeightsPanel
                    weights={weights}
                    onChange={(next) => void applyWeights(next)}
                  />
                </Sheet>
              </div>
            </div>
          </div>

          {visible.length === 0 ? (
            <EmptyState
              title="Nothing matches these filters"
              description="Try turning a filter off. Your choices so far are kept."
              action={
                <Button
                  variant="secondary"
                  onClick={() =>
                    setFilters({ kind: "all", inState: false, travel: false })
                  }
                >
                  Clear filters
                </Button>
              }
            />
          ) : null}

          {GROUPS.map((group) => {
            const cards = visible.filter((item) => item.group === group.id);
            if (cards.length === 0) return null;
            const bands = bandShortlist(cards);
            return (
              <section
                key={group.id}
                aria-labelledby={`group-${group.id}`}
                className="grid grid-cols-[minmax(0,1fr)] gap-6"
              >
                <header className="grid gap-2 border-b border-line pb-4">
                  <h2
                    id={`group-${group.id}`}
                    className="m-0 max-w-none font-display text-h2 font-light text-ink display-soft text-balance"
                  >
                    {group.title}
                  </h2>
                  <p className="m-0 max-w-prose text-body text-ink-2 text-pretty">
                    {group.blurb}
                  </p>
                </header>

                {bands.curated && bands.best.length > 0 ? (
                  <div className="grid gap-4">
                    <h3 className="m-0 text-micro font-semibold uppercase text-teal">
                      Best fit
                    </h3>
                    <CardGroup
                      cards={orderByPreview(bands.best, order)}
                      label={`Best fit, ${group.title}`}
                      variant="feature"
                      selected={selected}
                      limit={limit}
                      onToggle={toggle}
                      scoreScale={scoreScale}
                    />
                  </div>
                ) : null}

                {bands.listed.length > 0 ? (
                  <div className="grid gap-4">
                    {bands.curated ? (
                      <h3 className="m-0 text-micro font-semibold uppercase text-ink-3">
                        Good fits and backups
                      </h3>
                    ) : null}
                    <CardGroup
                      cards={orderByPreview(bands.listed, order)}
                      label={
                        bands.curated
                          ? `Other ${group.title}`
                          : `${group.title}, ranked`
                      }
                      variant="standard"
                      selected={selected}
                      limit={limit}
                      onToggle={toggle}
                      scoreScale={scoreScale}
                    />
                  </div>
                ) : null}

                {bands.excluded.length > 0 ? (
                  <details className="group/excluded rounded-lg border border-dashed border-line-strong bg-paper-2/40">
                    <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 rounded-lg px-5 text-body font-semibold text-ink-2 focus-ring [&::-webkit-details-marker]:hidden">
                      <span>
                        Not a fit{" "}
                        <span className="font-normal text-ink-3">
                          ({bands.excluded.length})
                        </span>
                      </span>
                      <span
                        aria-hidden
                        className="text-ink-3 transition-transform duration-300 group-open/excluded:rotate-45 motion-reduce:transition-none"
                      >
                        +
                      </span>
                    </summary>
                    <div className="p-4 pt-0 sm:p-5 sm:pt-0">
                      <CardGroup
                        cards={bands.excluded}
                        label={`Not a fit, ${group.title}`}
                        variant="muted"
                        selected={selected}
                        limit={limit}
                        onToggle={toggle}
                        scoreScale={scoreScale}
                      />
                    </div>
                  </details>
                ) : null}
              </section>
            );
          })}
        </>
      )}

      <SelectionTray
        caseId={caseId}
        chosen={chosen}
        limit={limit}
        onRemove={(id) => choose(selected.filter((item) => item !== id))}
      />
    </div>
  );
}
