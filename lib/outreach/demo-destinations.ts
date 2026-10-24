/**
 * Demo destinations (WAYFINDER_DEMO_COORDINATORS=1). DEMO ONLY.
 *
 * The planner always works from each resource's REAL, evidence-backed contact points, so the plan shows the true
 * adaptive mix (email, call, online form, or a combination). Demo mode only swaps WHERE each channel delivers:
 *   - email    -> a demo coordinator inbox (demo-coordinators.ts), as before.
 *   - call     -> an allowlisted test phone number from OUTBOUND_ALLOWLIST when one is configured; otherwise the
 *                 reserved never-dialed DEMO_CALL_SINK. A send to the sink is simulated (DemoCallSimulator): no
 *                 provider is called and a scripted transcript is fed through the normal transcript ingest.
 *   - web form -> Wayfinder's own demo intake form (/demo/intake-form/...), whose host is added to the web
 *                 allowlist only while the mode is on.
 * Nothing else changes: approval, checkOutbound (allowlist, ticked fields, disclosure, no medical advice, <=5 cap,
 * cadence) runs exactly as for a real destination. A real resource is never emailed, dialed or submitted to.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { parseAllowlist, normalizeAddress } from '../safety/allowlist';
import { parseWebAllowlist } from '../safety/web-allowlist';
import { demoCoordinatorsEnabled, demoCoordinatorInboxes, demoCoordinatorFor } from './demo-coordinators';
import { DEMO_CALL_SINK, DEMO_FORM_PATH, demoFormResourceSegment } from './demo-destinations-shared';

export { DEMO_CALL_SINK, DEMO_FORM_PATH, DEMO_CALL_SIMULATED_NOTE, isDemoFormUrl } from './demo-destinations-shared';

type Env = Record<string, string | undefined>;

/** On when demo coordinator mode is on AND at least one coordinator inbox is allowlisted (else the mode is inert). */
export const demoDestinationsEnabled = (env: Env): boolean => demoCoordinatorsEnabled(env) && demoCoordinatorInboxes(env).length > 0;

const isPhone = (a: string) => a.startsWith('+');

/** Allowlisted test phone numbers (E.164) in OUTBOUND_ALLOWLIST. */
export function allowlistedTestPhones(env: Env): string[] {
  return parseAllowlist(env.OUTBOUND_ALLOWLIST ?? '').filter(isPhone);
}

export function isDemoCallSink(address: string | null | undefined): boolean {
  return !!address && normalizeAddress(address) === DEMO_CALL_SINK;
}

/** Where a demo call to this resource goes: an allowlisted test number when configured, else the simulated sink. */
export function demoCallDestination(env: Env, targetKey: string): string {
  const phones = allowlistedTestPhones(env).filter(p => p !== DEMO_CALL_SINK);
  return demoCoordinatorFor(targetKey, phones) ?? DEMO_CALL_SINK;
}

/** The demo destination for a contact on this channel, or undefined when demo mode is off / nothing is configured. */
export function demoDestinationFor(env: Env, channel: 'email' | 'voice', targetKey: string): string | undefined {
  if (!demoDestinationsEnabled(env)) return undefined;
  if (channel === 'email') return demoCoordinatorFor(targetKey, demoCoordinatorInboxes(env));
  return demoCallDestination(env, targetKey);
}

/** Addresses several contacts on one case may share in demo mode (each resource still gets one contact). */
export function sharedDemoAddresses(env: Env): string[] {
  if (!demoDestinationsEnabled(env)) return [];
  return [...new Set([...demoCoordinatorInboxes(env), ...allowlistedTestPhones(env), DEMO_CALL_SINK])];
}

/**
 * The phone/email allowlist checkOutbound uses. In demo mode only, the reserved sink is on it: the sink is never
 * dialed (DemoCallSimulator intercepts it before any provider), so allowing it cannot reach anyone.
 */
export function outboundAllowlist(env: Env): string[] {
  const base = parseAllowlist(env.OUTBOUND_ALLOWLIST ?? '');
  return demoDestinationsEnabled(env) && !base.includes(DEMO_CALL_SINK) ? [...base, DEMO_CALL_SINK] : base;
}

/** Public base URL of this deployment (same variables the notify/review links use). */
export function appBaseUrl(env: Env): string {
  return (env.WAYFINDER_APP_BASE_URL?.trim() || env.WAYFINDER_APP_ORIGIN?.trim() || 'http://localhost:3000').replace(/\/$/, '');
}

function appHost(env: Env): string | null {
  try { return new URL(appBaseUrl(env)).host.toLowerCase(); } catch { return null; }
}

/** OUTBOUND_WEB_ALLOWLIST, plus this deployment's own host while demo mode is on (the demo form lives there). */
export function webAllowlist(env: Env): string[] {
  const base = parseWebAllowlist(env.OUTBOUND_WEB_ALLOWLIST ?? '');
  const host = demoDestinationsEnabled(env) ? appHost(env) : null;
  return host && !base.includes(host) ? [...base, ...parseWebAllowlist(host)] : base;
}

function formSecret(env: Env): string {
  return env.WAYFINDER_SESSION_SECRET?.trim() || env.WAYFINDER_SHARE_SECRET?.trim() || 'wayfinder-dev-demo-form';
}

/** MAC binding a demo form link to one case, application and resource, so its submissions cannot be forged. */
export function demoFormToken(env: Env, input: { caseId: string; applicationId: string; resource: string }): string {
  return createHmac('sha256', formSecret(env)).update(`wayfinder.demo-form.v1\n${input.caseId}\n${input.applicationId}\n${input.resource}`).digest('hex').slice(0, 32);
}

export function verifyDemoFormToken(env: Env, input: { caseId: string; applicationId: string; resource: string; token: string | null | undefined }): boolean {
  const expected = demoFormToken(env, input);
  const got = input.token ?? '';
  return got.length === expected.length && timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}

/** The demo intake form URL standing in for a resource's real online form (the real URL stays in the plan). */
export function demoFormUrl(env: Env, input: { caseId: string; applicationId: string; resourceKey: string; realUrl: string }): string {
  const resource = demoFormResourceSegment(input.resourceKey, input.realUrl);
  const q = new URLSearchParams({ case: input.caseId, app: input.applicationId, t: demoFormToken(env, { caseId: input.caseId, applicationId: input.applicationId, resource }) });
  return `${appBaseUrl(env)}${DEMO_FORM_PATH}/${resource}?${q.toString()}`;
}

/** What the UI may show about demo routing. Not secret. */
export interface DemoDestinationInfo {
  enabled: boolean;
  /** True when calls ring an allowlisted test number; false when they are simulated. */
  callsRingTestNumber: boolean;
}

export function demoDestinationInfo(env: Env): DemoDestinationInfo {
  return { enabled: demoDestinationsEnabled(env), callsRingTestNumber: allowlistedTestPhones(env).some(p => p !== DEMO_CALL_SINK) };
}
