import { and, eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import * as s from '../../db/schema';

export interface InboundMessage { id: string; contactId: string; body: string }
export interface InboundMessageStore { get(messageId: string): Promise<InboundMessage | undefined> }

export class MemoryInboundMessageStore implements InboundMessageStore {
  rows = new Map<string, InboundMessage>();
  add(m: InboundMessage) { this.rows.set(m.id, m); return m; }
  async get(messageId: string) { const r = this.rows.get(messageId); return r ? { ...r } : undefined; }
}

export class PostgresInboundMessageStore implements InboundMessageStore {
  async get(messageId: string) {
    const [row] = await getDb().select({ id: s.messages.id, contactId: s.messages.contactId, body: s.messages.body })
      .from(s.messages).where(and(eq(s.messages.id, messageId), eq(s.messages.direction, 'inbound')));
    return row;
  }
}
