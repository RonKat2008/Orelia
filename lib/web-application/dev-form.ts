import { resolveMode } from '@/lib/env';

/** The synthetic test form is a dev/demo fixture and must never be reachable in production. */
export function devFormEnabled(source: Record<string, string | undefined> = process.env): boolean {
  return resolveMode(source) !== 'prod';
}
