import { demoEnabled } from '@/app/api/demo/lib/guard';

/** Synthetic sample records can be loaded only in demo or offline mode (the sample route 404s otherwise). */
export function historySamplesEnabled(env: Record<string, string | undefined>): boolean {
  return demoEnabled(env) || env.WAYFINDER_OFFLINE === '1';
}
