/**
 * Demo coordinator mode (WAYFINDER_DEMO_COORDINATORS=1). DEMO ONLY.
 *
 * For a live demo, every selected resource is routed to one of our own AgentMail test inboxes, which play a
 * synthetic "intake coordinator" (scripts/demo-coordinators.ts sends the scripted reply). That lets the full
 * approve -> send -> reply -> task loop run in production without ever contacting a real hospital, trial or charity.
 *
 * Why this is safe:
 *   - Off unless WAYFINDER_DEMO_COORDINATORS is exactly "1".
 *   - A coordinator address is used only if it is ALSO on OUTBOUND_ALLOWLIST, so the outbound gate still passes
 *     and nothing outside the allowlist can be reached. checkOutbound is unchanged and still runs on every send.
 *   - While the mode is on, a resource's real contact point is never used: every new contact goes to a demo inbox.
 *   - The UI labels these contacts "Demo coordinator" (isDemoCoordinatorAddress).
 *
 * Coordinator inboxes: DEMO_COORDINATOR_INBOXES (comma-separated emails) when set, otherwise every email on
 * OUTBOUND_ALLOWLIST except the sender inbox (AGENTMAIL_SENDER_INBOX_ID).
 */
import { normalizeAddress, parseAllowlist } from '../safety/allowlist';

type Env = Record<string, string | undefined>;

export const DEMO_COORDINATOR_LABEL = 'Demo coordinator';

export function demoCoordinatorsEnabled(env: Env): boolean {
  return (env.WAYFINDER_DEMO_COORDINATORS ?? '').trim() === '1';
}

const isEmail = (a: string) => a.includes('@');

/** Coordinator inbox addresses in effect (normalized, allowlisted, deduped). Empty when the mode is off. */
export function demoCoordinatorInboxes(env: Env): string[] {
  if (!demoCoordinatorsEnabled(env)) return [];
  const allow = parseAllowlist(env.OUTBOUND_ALLOWLIST ?? '').filter(isEmail);
  const sender = normalizeAddress(env.AGENTMAIL_SENDER_INBOX_ID ?? '');
  const explicit = parseAllowlist(env.DEMO_COORDINATOR_INBOXES ?? '').filter(isEmail);
  const wanted = explicit.length > 0 ? explicit : allow.filter(a => a !== sender);
  return wanted.filter(a => allow.includes(a) && a !== sender);
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

/** The demo inbox that plays this resource's intake coordinator (stable per resource), or undefined. */
export function demoCoordinatorFor(targetKey: string, inboxes: readonly string[]): string | undefined {
  if (inboxes.length === 0) return undefined;
  return inboxes[hash(targetKey) % inboxes.length];
}

export function isDemoCoordinatorAddress(address: string | null | undefined, env: Env): boolean {
  if (!address) return false;
  const normalized = normalizeAddress(address);
  return normalized !== null && demoCoordinatorInboxes(env).includes(normalized);
}
