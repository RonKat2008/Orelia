'use client';

import { useEffect, useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { Badge, EmptyState, List, ListRow, Skeleton } from '@/components/ui';
import { getBoard } from './client';
import { BOARD_STATUS_LABELS, BOARD_STATUS_TONE, formatDue, groupBoard, isSafeHttpUrl } from './model';
import { PanelHeading, SourceLink } from './shared';
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
      <PanelHeading id="board-heading" title="Who has the next move" lede="Everything still open across you, your doctors and the places you chose." />
      {loading ? <Skeleton className="h-32 w-full rounded-lg" /> : null}
      {error ? <p role="alert" className="m-0 text-body text-danger">{error}</p> : null}
      {!loading && !error && groups.length === 0 ? <EmptyState title="Nothing open yet" description="As you check requirements and start requests, the next steps show up here." /> : null}
      {groups.map(g => (
        <div key={g.key} className="grid content-start gap-2">
          <h4 className="m-0 text-body font-semibold text-ink">{g.title}</h4>
          <List label={g.title}>
            {g.items.map(item => <BoardRow key={item.id} item={item} />)}
          </List>
        </div>
      ))}
    </section>
  );
}

function BoardRow({ item }: { item: BoardItem }) {
  const due = formatDue(item.due);
  const href = item.href && item.href.startsWith('/') ? item.href : undefined;
  const source = item.sourceUrl && isSafeHttpUrl(item.sourceUrl) ? item.sourceUrl : null;
  return (
    <ListRow
      title={item.title}
      href={href}
      meta={[item.owner.name, item.detail].filter(Boolean).join(' · ')}
      badges={<Badge tone={BOARD_STATUS_TONE[item.status]} dot>{BOARD_STATUS_LABELS[item.status]}</Badge>}
      trailing={due ? <span className="inline-flex items-center gap-1"><CalendarClock aria-hidden className="size-4" />{due}</span> : undefined}
    >
      {source ? <SourceLink url={source} /> : null}
    </ListRow>
  );
}
