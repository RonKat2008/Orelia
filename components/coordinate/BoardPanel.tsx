'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CalendarClock } from 'lucide-react';
import { Badge, EmptyState, Skeleton } from '@/components/ui';
import { getBoard } from './client';
import { BOARD_STATUS_LABELS, BOARD_STATUS_TONE, formatDue, groupBoard, isSafeHttpUrl } from './model';
import { PanelHeading, Reveal, SourceLink } from './shared';
import type { Board, BoardItem } from './types';

export function BoardPanel({ caseId }: { caseId: string }) {
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    let live = true;
    void getBoard(caseId).then(res => {
      if (!live) return;
      if (res.ok) setBoard(res.data);
      else setError(res.message);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [caseId]);
  const groups = groupBoard(board);

  return (
    <section aria-labelledby="board-heading" className="grid gap-6">
      <PanelHeading id="board-heading" eyebrow="Next steps" title="Who has the next move" lede="Everything still open across you, your doctors and the places you chose, in one list." />
      {loading ? <Skeleton className="h-32 w-full rounded-lg" /> : null}
      {error ? <p role="alert" className="m-0 text-body text-danger">{error}</p> : null}
      {!loading && !error && groups.length === 0 ? <EmptyState title="Nothing open yet" description="As you check requirements and start requests, the next steps show up here." /> : null}
      <div className="grid gap-6 lg:grid-cols-3">
        {groups.map((g, gi) => (
          <Reveal key={g.key} index={gi} className="grid content-start gap-3">
            <h4 className="m-0 font-display text-h4 font-normal text-ink">{g.title}</h4>
            <ul className="m-0 grid list-none gap-3 p-0">
              {g.items.map(item => <BoardCard key={item.id} item={item} />)}
            </ul>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

function BoardCard({ item }: { item: BoardItem }) {
  const due = formatDue(item.due);
  return (
    <li className="grid gap-2 rounded-md border border-line bg-card p-4">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={BOARD_STATUS_TONE[item.status]} dot>{BOARD_STATUS_LABELS[item.status]}</Badge>
        {due ? <span className="inline-flex items-center gap-1 text-small text-ink-2"><CalendarClock aria-hidden className="size-4" />{due}</span> : null}
      </div>
      <p className="m-0 font-semibold text-ink text-pretty">{item.title}</p>
      <p className="m-0 text-micro uppercase text-ink-3">{item.owner.name}</p>
      {item.detail ? <p className="m-0 text-small text-ink-2 text-pretty">{item.detail}</p> : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        {item.href && item.href.startsWith('/') ? (
          <Link href={item.href} className="inline-flex min-h-8 items-center gap-1 rounded-sm text-small font-semibold text-teal underline decoration-teal/35 underline-offset-4 focus-ring">
            Open <ArrowRight aria-hidden className="size-3.5" />
          </Link>
        ) : null}
        {item.sourceUrl && isSafeHttpUrl(item.sourceUrl) ? <SourceLink url={item.sourceUrl} /> : null}
      </div>
    </li>
  );
}
