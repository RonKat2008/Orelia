'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { Button, EmptyState, LoadingState, Skeleton } from '@/components/ui';
import { loadContacts, loadResources } from './client';
import { BoardPanel } from './BoardPanel';
import { ConsultPanel } from './ConsultPanel';
import { PacketPanel } from './PacketPanel';
import { RequirementsPanel } from './RequirementsPanel';
import { firstNeedingAction, type SectionKey } from './focus';
import type { ContactOption, Resource } from './types';

export function CoordinateView({ caseId }: { caseId: string }) {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [error, setError] = useState('');
  const [needs, setNeeds] = useState<Partial<Record<SectionKey, boolean>>>({});
  // The first section that needs action carries the page's one primary button; the rest show links.
  const focus = firstNeedingAction(needs);
  const reportNeeds = useCallback((key: SectionKey, value: boolean) => setNeeds(prev => (prev[key] === value ? prev : { ...prev, [key]: value })), []);
  const onNeeds = (key: SectionKey) => (value: boolean) => reportNeeds(key, value);

  useEffect(() => {
    let live = true;
    void Promise.all([loadResources(caseId), loadContacts(caseId)]).then(([r, c]) => {
      if (!live) return;
      if (r.ok) setResources(r.data);
      else {
        setResources([]);
        setError(r.status === 404 ? '' : r.message);
      }
      if (c.ok) setContacts(c.data);
    });
    return () => {
      live = false;
    };
  }, [caseId]);

  if (resources === null) {
    return (
      <LoadingState label="Loading your chosen specialists" className="gap-4">
        <Skeleton className="h-40 w-full rounded-lg" />
      </LoadingState>
    );
  }

  if (resources.length === 0) {
    return (
      <div className="grid min-w-0 gap-8">
        <BoardPanel caseId={caseId} />
        <EmptyState
          title="Choose who to contact first"
          description={error || 'The checklist, packet and doctor requests are built for the specialists you chose.'}
          action={<Button asChild><Link href={`/cases/${caseId}/shortlist`}>Open the shortlist</Link></Button>}
        />
      </div>
    );
  }

  return (
    <div className="grid min-w-0 gap-8 lg:grid-cols-2 lg:items-start lg:gap-x-10">
      <div className="grid min-w-0 gap-8">
        <BoardPanel caseId={caseId} />
        <RequirementsPanel caseId={caseId} resources={resources} primary={focus === 'requirements'} onNeeds={onNeeds('requirements')} />
      </div>
      <div className="grid min-w-0 gap-8">
        <PacketPanel caseId={caseId} resources={resources} contacts={contacts} primary={focus === 'packet'} onNeeds={onNeeds('packet')} />
        <ConsultPanel caseId={caseId} resources={resources} primary={focus === 'consult'} onNeeds={onNeeds('consult')} />
      </div>
    </div>
  );
}
