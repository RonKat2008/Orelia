'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Printer } from 'lucide-react';
import { Button, Skeleton } from '@/components/ui';
import { getPackets } from './client';
import { includedSections } from './model';
import { PacketSections } from './PacketSections';
import type { SpecialistPacket } from './types';

function safeDecode(v: string): string {
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** Printable packet: only ticked sections, black on white via tokens, app chrome hidden when printing. */
export function PacketPrint({ caseId, resourceKey }: { caseId: string; resourceKey: string }) {
  const key = safeDecode(resourceKey);
  const [packet, setPacket] = useState<SpecialistPacket | null | undefined>(undefined);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    void getPackets(caseId).then(res => {
      if (!live) return;
      if (res.ok) setPacket(res.data.find(p => p.resourceKey === key) ?? null);
      else {
        setError(res.message);
        setPacket(null);
      }
    });
    return () => {
      live = false;
    };
  }, [caseId, key]);

  return (
    <article className="ds-root mx-auto grid max-w-3xl gap-6 print:max-w-none print:gap-4 print:bg-white print:text-black">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Button asChild variant="ghost" size="sm">
          <Link href={`/cases/${encodeURIComponent(caseId)}/coordinate`}><ArrowLeft aria-hidden /> Back to coordinate</Link>
        </Button>
        <Button onClick={() => window.print()} disabled={!packet}><Printer aria-hidden /> Print</Button>
      </div>
      {packet === undefined ? (
        <div role="status" aria-busy="true"><Skeleton className="h-40 w-full rounded-lg" /></div>
      ) : packet === null ? (
        <p role="alert" className="m-0 text-body text-ink">{error || 'There is no packet for this specialist yet. Build one on the coordinate page.'}</p>
      ) : (
        <>
          <header className="grid gap-1 border-b border-line pb-4 print:border-black">
            <p className="m-0 text-micro font-semibold uppercase text-ink-3 print:text-black">Summary prepared by the patient for</p>
            <h1 className="m-0 font-display text-h2 font-light text-ink display-soft print:text-black">{packet.name}</h1>
            <p className="m-0 text-small text-ink-2 print:text-black">Only the parts the patient chose to share are included. Organized with Wayfinder; this is not medical advice.</p>
          </header>
          {includedSections(packet.sections).length === 0 ? (
            <p className="m-0 text-body text-ink-2">No sections are ticked, so this packet is empty.</p>
          ) : (
            <PacketSections sections={packet.sections} />
          )}
        </>
      )}
    </article>
  );
}
