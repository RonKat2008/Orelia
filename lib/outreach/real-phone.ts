/**
 * DEMO DISPLAY ONLY. In demo mode a call contact's stored address is the presenter's allowlisted test phone (or the
 * sink), because that is what gets dialed. The UI should show the resource's REAL, evidence-backed number instead,
 * so this finds it from the resource's code-stamped contact_point.voice evidence. The result is never used to dial.
 */
import { and, eq } from 'drizzle-orm';
import { getDb } from '../../db/client';
import * as s from '../../db/schema';
import { parseContactPoints } from '../contact-finder/contact-points';
import { demoDestinationsEnabled } from './demo-destinations';

type Env = Record<string, string | undefined>;
interface Ref { id: string; caseId: string; targetId: string; targetKind: string; channel: string }

/** First real phone contact point among a resource's evidence rows, or null. */
export function pickRealPhone(evidence: readonly { claimType: string; claim: string; sourceUrl: string; sourceKind?: string }[]): string | null {
  return parseContactPoints(evidence).find(p => p.channel === 'voice')?.address ?? null;
}

/**
 * `{ displayAddress }` for a voice contact in demo mode (the real number, or null when the resource has none);
 * `{}` otherwise, so the client falls back to the stored address.
 */
export async function displayAddressFor(env: Env, contact: Ref): Promise<{ displayAddress?: string | null }> {
  if (!demoDestinationsEnabled(env) || contact.channel !== 'voice') return {};
  try {
    const rows = await getDb().select().from(s.evidence).where(and(eq(s.evidence.caseId, contact.caseId), eq(s.evidence.targetId, contact.targetId), eq(s.evidence.targetKind, contact.targetKind as 'expert')));
    return { displayAddress: pickRealPhone(rows) };
  } catch {
    return { displayAddress: null };
  }
}
