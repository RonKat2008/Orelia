import { notFound } from 'next/navigation';
import { demoDestinationsEnabled } from '@/lib/outreach/demo-destinations';
import { parseDemoFormSegment } from '@/lib/outreach/demo-destinations-shared';
import { DemoBanner, demoPageStyles } from '../demo-chrome';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Request received (Orelia demo form)',
  robots: { index: false, follow: false },
};

export default async function DemoIntakeSubmittedPage({ params, searchParams }: {
  params: Promise<{ resource: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { resource } = await params;
  if (!demoDestinationsEnabled(process.env) || !parseDemoFormSegment(resource)) notFound();
  const sp = await searchParams;
  const raw = Array.isArray(sp.ref) ? sp.ref[0] : sp.ref;
  const ref = (raw ?? '').replace(/[^A-Za-z0-9-]/g, '').slice(0, 8).toUpperCase();
  const s = demoPageStyles;
  return (
    <div style={s.page}>
      <DemoBanner name="the clinic" />
      <main style={s.main}>
        <h1 style={s.h1}>Thank you. Your request was received.</h1>
        <p style={s.intro}>Our scheduling team will review it and contact you about a first visit.</p>
        {ref ? <p style={{ fontWeight: 700 }}>Reference: WF-DEMO-{ref}</p> : null}
      </main>
    </div>
  );
}
