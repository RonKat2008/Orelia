/**
 * Client-safe constants and pure helpers for demo destinations (see demo-destinations.ts). No secrets, no node APIs.
 */

/**
 * Reserved, never-dialed phone number for simulated demo calls. 555-0100..0199 is the NANP range set aside for
 * fictional use; DemoCallSimulator intercepts it before any provider, and AgentCall refuses it outright.
 */
export const DEMO_CALL_SINK = '+12025550199';

export const DEMO_FORM_PATH = '/demo/intake-form';

export const DEMO_CALL_SIMULATED_NOTE = 'demo: call simulated (no allowlisted number)';

export const DEMO_LABELS = {
  email: 'Demo: delivered to Orelia test inbox',
  emailPersonal: 'Demo: delivered to your own inbox (safe mode)',
  voice: 'Demo: call simulated (no real number is dialed)',
  voiceTestNumber: 'Demo: rings the Orelia test phone',
  web_form: 'Demo: delivered to Orelia test form',
} as const;

/** Small stable hash (FNV-1a, hex) usable on server and client. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** "<targetKind>-<targetId>-<hash of the real form URL>": names the resource and which of its forms is stood in for. */
export function demoFormResourceSegment(resourceKey: string, realUrl: string): string {
  const [kind = 'resource', ...rest] = resourceKey.split(':');
  const id = rest.join(':').replace(/[^A-Za-z0-9-]/g, '').slice(0, 64) || 'unknown';
  return `${kind.replace(/[^a-z]/g, '')}-${id}-${shortHash(realUrl)}`;
}

/** Parses a demo form segment back into target kind / id. */
export function parseDemoFormSegment(segment: string): { targetKind: string; targetId: string; formHash: string } | null {
  const m = /^(expert|institution|trial|organization)-([A-Za-z0-9-]+)-([0-9a-f]{8})$/.exec(segment);
  return m ? { targetKind: m[1]!, targetId: m[2]!, formHash: m[3]! } : null;
}

export function isDemoFormUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  try { return new URL(url).pathname.startsWith(`${DEMO_FORM_PATH}/`); } catch { return false; }
}

/** True when `appUrl` is the demo form standing in for the plan step's real form URL. */
export function isDemoFormFor(appUrl: string, resourceKey: string, realUrl: string): boolean {
  try {
    const u = new URL(appUrl);
    return u.pathname === `${DEMO_FORM_PATH}/${demoFormResourceSegment(resourceKey, realUrl)}`;
  } catch {
    return false;
  }
}
