import type { PlanChannel, PlanStep, ResourcePlan } from './contract';

const CHANNEL_ORDER: readonly PlanChannel[] = ['email', 'web_form', 'voice'];
const NOUN: Record<PlanChannel, [singular: string, plural: string]> = {
  email: ['email', 'emails'],
  web_form: ['online application', 'online applications'],
  voice: ['call', 'calls'],
};

interface Bucket { channel: PlanChannel; conditional: boolean; count: number; firstSeen: number }

const bucketKey = (s: PlanStep): string => (s.waitFor === 'none' ? s.channel : `${s.channel}|${s.waitFor}`);

/**
 * One-line, plain-language summary of a plan, counting enabled steps only. Steps that run straight away are grouped
 * by channel; steps that wait for a reply are grouped by channel and wait, and read "... if no reply".
 */
export function summarizePlan(resources: readonly ResourcePlan[]): string {
  if (resources.length === 0) return 'No resources selected yet.';
  const buckets = new Map<string, Bucket>();
  let seen = 0;
  for (const step of resources.flatMap(r => r.steps).filter(s => s.enabled)) {
    const key = bucketKey(step);
    const prev = buckets.get(key);
    buckets.set(key, prev ? { ...prev, count: prev.count + 1 } : { channel: step.channel, conditional: step.waitFor !== 'none', count: 1, firstSeen: seen++ });
  }
  const ordered = [...buckets.values()].sort((a, b) =>
    Number(a.conditional) - Number(b.conditional)
    || CHANNEL_ORDER.indexOf(a.channel) - CHANNEL_ORDER.indexOf(b.channel)
    || a.firstSeen - b.firstSeen);
  const parts = ordered.map(b => `${b.count} ${NOUN[b.channel][b.count === 1 ? 0 : 1]}${b.conditional ? ' if no reply' : ''}`);
  const head = `${resources.length} ${resources.length === 1 ? 'resource' : 'resources'}`;
  const noChannel = resources.filter(r => r.steps.length === 0).length;
  const tail = noChannel === 0 ? '' : ` ${noChannel} ${noChannel === 1 ? 'has' : 'have'} no contact channel yet.`;
  return `${head}${parts.length ? `: ${parts.join(', ')}` : ''}.${tail}`;
}
