import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { browserLiveViews } from '@/db/schema';
import type { LiveViewSink, LiveViewStart } from './live-view';

export class PostgresLiveViewSink implements LiveViewSink {
  async start(v: LiveViewStart): Promise<string> {
    const [row] = await getDb().insert(browserLiveViews).values({
      caseId: v.caseId, contactId: v.contactId ?? null, url: v.url, host: v.host, phase: v.phase, expiresAt: v.expiresAt,
    }).returning({ id: browserLiveViews.id });
    return row!.id;
  }
  async end(id: string): Promise<void> {
    await getDb().update(browserLiveViews).set({ endedAt: new Date() }).where(eq(browserLiveViews.id, id));
  }
}
