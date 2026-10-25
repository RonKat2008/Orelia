/**
 * Kernel live view: while a cloud browser fills or submits a form, the judge console can watch it.
 * The live view URL is a session capability (anyone holding it can see the browser), so it is stored only for the
 * judge console, forced read-only, and expires with the session. Failures here never affect the fill or submit.
 */
import { AsyncLocalStorage } from 'node:async_hooks';

export type LiveViewPhase = 'filling' | 'submitting';

export interface LiveViewScope { caseId: string; contactId?: string | undefined; phase: LiveViewPhase }

export interface LiveViewStart extends LiveViewScope { url: string; host: string; expiresAt: Date }

/** Where launched sessions are recorded. end() is idempotent. */
export interface LiveViewSink {
  start(view: LiveViewStart): Promise<string>;
  end(id: string): Promise<void>;
}

/** How long a viewer sees the finished form before the browser closes (configurable). */
export const LIVE_VIEW_HOLD_MS = 7000;

const scopeStore = new AsyncLocalStorage<LiveViewScope>();

/** Launches inside `fn` are recorded against this case/contact/phase. */
export function withLiveViewScope<T>(scope: LiveViewScope, fn: () => Promise<T>): Promise<T> {
  return scopeStore.run(scope, fn);
}
export const currentLiveViewScope = (): LiveViewScope | undefined => scopeStore.getStore();

/** Forces the embedded view to be non-interactive (Kernel supports ?readOnly=true). Returns null for non-https input. */
export function readOnlyLiveViewUrl(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== 'https:') return null;
    u.searchParams.set('readOnly', 'true');
    return u.toString();
  } catch {
    return null;
  }
}

export const liveViewHost = (raw: string): string => {
  try { return new URL(raw).hostname; } catch { return 'Kernel'; }
};

let defaultSink: LiveViewSink | undefined;
/** Wiring point (and test seam). */
export function setDefaultLiveViewSink(sink: LiveViewSink | undefined): void { defaultSink = sink; }
export async function resolveLiveViewSink(): Promise<LiveViewSink | undefined> {
  if (defaultSink) return defaultSink;
  if (!process.env.DATABASE_URL) return undefined;
  const { PostgresLiveViewSink } = await import('./live-view-store');
  return (defaultSink = new PostgresLiveViewSink());
}

export interface LiveViewHandle { end(): Promise<void> }

/** Records a launched session if there is a scope, a sink and a usable URL. Never throws. */
export async function recordLiveView(
  rawUrl: string | undefined, timeoutSeconds: number, sink?: LiveViewSink, now: () => Date = () => new Date(),
): Promise<LiveViewHandle | undefined> {
  try {
    const scope = currentLiveViewScope();
    const url = rawUrl ? readOnlyLiveViewUrl(rawUrl) : null;
    if (!scope || !url) return undefined;
    const target = sink ?? await resolveLiveViewSink();
    if (!target) return undefined;
    const id = await target.start({ ...scope, url, host: liveViewHost(url), expiresAt: new Date(now().getTime() + timeoutSeconds * 1000) });
    return { end: async () => { try { await target.end(id); } catch { /* best effort */ } } };
  } catch {
    return undefined;
  }
}
