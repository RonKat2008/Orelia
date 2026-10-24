'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Skeleton, Tabs, TabsContent, TabsList, TabsTrigger, EmptyState, Button } from '@/components/ui';
import { loadContacts, loadResources } from './client';
import { BoardPanel } from './BoardPanel';
import { ConsultPanel } from './ConsultPanel';
import { PacketPanel } from './PacketPanel';
import { RequirementsPanel } from './RequirementsPanel';
import type { ContactOption, Resource } from './types';

export function CoordinateView({ caseId }: { caseId: string }) {
  const [resources, setResources] = useState<Resource[] | null>(null);
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [error, setError] = useState('');

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
      <div role="status" aria-busy="true" className="grid gap-4">
        <p className="m-0 text-lead text-ink-2">Loading your chosen specialists…</p>
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    );
  }

  return (
    <Tabs defaultValue="board">
      <TabsList aria-label="Coordination">
        <TabsTrigger value="board">Next steps</TabsTrigger>
        <TabsTrigger value="requirements">Referral checklist</TabsTrigger>
        <TabsTrigger value="packet">Specialist packet</TabsTrigger>
        <TabsTrigger value="consult">Doctor to expert</TabsTrigger>
      </TabsList>
      <TabsContent value="board"><BoardPanel caseId={caseId} /></TabsContent>
      {resources.length === 0 ? (
        ['requirements', 'packet', 'consult'].map(v => (
          <TabsContent key={v} value={v}>
            <EmptyState
              title="Choose who to contact first"
              description={error || 'The checklist, packet and doctor requests are built for the specialists you chose.'}
              action={<Button asChild variant="secondary"><Link href={`/cases/${caseId}/shortlist`}>Open the shortlist</Link></Button>}
            />
          </TabsContent>
        ))
      ) : (
        <>
          <TabsContent value="requirements"><RequirementsPanel caseId={caseId} resources={resources} /></TabsContent>
          <TabsContent value="packet"><PacketPanel caseId={caseId} resources={resources} contacts={contacts} /></TabsContent>
          <TabsContent value="consult"><ConsultPanel caseId={caseId} resources={resources} /></TabsContent>
        </>
      )}
    </Tabs>
  );
}
