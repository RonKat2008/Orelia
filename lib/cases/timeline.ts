/**
 * Threads timeline membership. Only things that actually happened belong on the timeline:
 * sent outbound email, received replies, and calls that started and produced a transcript.
 * Unsent drafts (including call scripts) live in the outbox only.
 */
export function isMailEvent(row: { direction: string; sentAt: Date | null; receivedAt: Date | null }): boolean {
  return row.direction === "inbound" ? row.receivedAt !== null : row.sentAt !== null;
}

export function isCallEvent(row: { transcript: string | null; startedAt: Date | null }): boolean {
  return row.startedAt !== null && !!row.transcript?.trim();
}
