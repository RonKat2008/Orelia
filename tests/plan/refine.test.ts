import { describe, expect, it, vi } from 'vitest';
import { buildContactPlan, buildDeterministicPlan, refinePlan } from '@/lib/plan';
import { contactPlanSchema } from '@/lib/plan/contract';
import { emailEv, formEv, NOW, phoneEv, plainEv, resource } from './planner-fixtures';

const specialistE = emailEv('referral_coordinator', 'referrals@center.example.org');
const specialistP = phoneEv('referral_coordinator', '+16175550111');
const advocacyE = emailEv('org_contact', 'info@advocacy.example.org');
const aidF = formEv('application_form', 'https://aid.example.org/apply');
const aidE = emailEv('org_contact', 'info@aid.example.org');

const inputs = [
  resource('expert', 'e1', [specialistE, specialistP, plainEv('e1-specialty')]),
  resource('organization', 'o1', [advocacyE], 'advocacy'),
  resource('organization', 'o2', [aidF, aidE], 'financial_aid'),
];
const base = buildDeterministicPlan('case-1', inputs, { now: NOW });

/** The prompt hands the model aliases; read them back from the user message so tests use what the model would. */
function aliasesFrom(messages: { role: string; content: string }[]): Record<string, { ref: string; channel: string }[]> {
  const payload = JSON.parse(messages[messages.length - 1].content.split('\n').slice(1).join('\n')) as {
    resources: { resourceKey: string; contactPoints: { ref: string; channel: string }[] }[];
  };
  return Object.fromEntries(payload.resources.map(r => [r.resourceKey, r.contactPoints]));
}

type Reply = (aliases: ReturnType<typeof aliasesFrom>) => unknown;
const completer = (reply: Reply) => vi.fn(async (messages: { role: 'system' | 'user' | 'assistant'; content: string }[]) =>
  JSON.stringify(reply(aliasesFrom(messages))));

const step = (channel: string, ref: string, extra: Record<string, unknown> = {}) => ({
  channel, purpose: 'intro', targetRef: ref, waitFor: 'none', reason: 'A short, friendly first message.', evidenceIds: [ref], ...extra,
});

describe('refinePlan', () => {
  it('applies a valid reorder (call first, email if no reply) and marks source rules+llm', async () => {
    const complete = completer(a => {
      const email = a['expert:e1'].find(c => c.channel === 'email')!.ref;
      const voice = a['expert:e1'].find(c => c.channel === 'voice')!.ref;
      return { resources: [{ resourceKey: 'expert:e1', steps: [
        step('voice', voice, { reason: 'Their office prefers phone calls.' }),
        step('email', email, { purpose: 'follow_up', waitFor: 'business_days:2' }),
      ] }] };
    });
    const out = await refinePlan(base, inputs, { complete });
    expect(complete).toHaveBeenCalledOnce();
    expect(out.source).toBe('rules+llm');
    const e1 = out.resources[0];
    // The code-owned (disabled) verification step stays first; the model's steps follow it.
    expect(e1.steps.map(s => [s.id, s.order, s.channel, s.targetRef, s.waitFor])).toEqual([
      ['s1', 1, 'voice', specialistP.id, 'none'],
      ['s2', 2, 'voice', specialistP.id, 'none'],
      ['s3', 3, 'email', specialistE.id, 'business_days:2'],
    ]);
    expect(e1.steps[0]).toMatchObject({ purpose: 'verify', enabled: false });
    expect(e1.steps[1].evidenceIds).toEqual([specialistP.id]);
    expect(e1.steps[1].reason).toBe('Their office prefers phone calls.');
    expect(out.resources.slice(1)).toEqual(base.resources.slice(1));
    expect(out.summary).toBe('3 resources: 1 email, 1 online application, 1 call, 1 email if no reply, 1 email if no reply.');
    expect(contactPlanSchema.safeParse(out).success).toBe(true);
  });

  it('rejects a model proposal that adds a verify step (verification calls are code-owned and opt-in)', async () => {
    const complete = completer(a => {
      const voice = a['expert:e1'].find(c => c.channel === 'voice')!.ref;
      return { resources: [{ resourceKey: 'expert:e1', steps: [step('voice', voice, { purpose: 'verify' })] }] };
    });
    const out = await refinePlan(base, inputs, { complete });
    expect(out.resources[0].steps).toEqual(base.resources[0].steps);
  });

  it('never puts raw addresses or source URLs into the prompt', async () => {
    let prompt = '';
    await refinePlan(base, inputs, { complete: async m => { prompt = m.map(x => x.content).join('\n'); return '{}'; } });
    expect(prompt).not.toContain('referrals@center.example.org');
    expect(prompt).not.toContain('+16175550111');
    expect(prompt).not.toContain('https://aid.example.org/apply');
    expect(prompt).toContain('untrusted');
  });

  it('cannot invent a channel the resource does not have (voice for email-only advocacy)', async () => {
    const complete = completer(a => ({ resources: [{ resourceKey: 'organization:o1', steps: [
      step('voice', a['organization:o1'][0].ref),
    ] }] }));
    const out = await refinePlan(base, inputs, { complete });
    expect(out).toEqual(base);
  });

  it('cannot cite evidence of another resource', async () => {
    const complete = completer(a => {
      const own = a['organization:o1'][0].ref;
      const foreign = a['expert:e1'][0].ref;
      return { resources: [{ resourceKey: 'organization:o1', steps: [step('email', own, { evidenceIds: [own, foreign] })] }] };
    });
    expect(await refinePlan(base, inputs, { complete })).toEqual(base);
  });

  it('cannot target another resource contact point or a made-up address', async () => {
    const complete = completer(a => ({ resources: [
      { resourceKey: 'organization:o1', steps: [step('email', a['expert:e1'][0].ref)] },
      { resourceKey: 'expert:e1', steps: [step('email', 'attacker@evil.example.com')] },
    ] }));
    expect(await refinePlan(base, inputs, { complete })).toEqual(base);
  });

  it('cannot add resources, empty a resource, or skip citing the target', async () => {
    const complete = completer(a => ({ resources: [
      { resourceKey: 'expert:e99', steps: [step('email', 'c1')] },
      { resourceKey: 'organization:o1', steps: [] },
      { resourceKey: 'organization:o2', steps: [step('web_form', a['organization:o2'][0].ref, { evidenceIds: [a['organization:o2'][1].ref] })] },
    ] }));
    const out = await refinePlan(base, inputs, { complete });
    expect(out).toEqual(base);
    expect(out.resources).toHaveLength(3);
  });

  it('keeps deterministic steps for an invalid resource but applies a valid one', async () => {
    const complete = completer(a => ({ resources: [
      { resourceKey: 'organization:o1', steps: [step('voice', a['organization:o1'][0].ref)] },
      { resourceKey: 'organization:o2', steps: [step('web_form', a['organization:o2'].find(c => c.channel === 'web_form')!.ref, { purpose: 'apply' })] },
    ] }));
    const out = await refinePlan(base, inputs, { complete });
    expect(out.source).toBe('rules+llm');
    expect(out.resources[1]).toEqual(base.resources[1]);
    expect(out.resources[2].steps).toHaveLength(1);
    expect(out.resources[2].steps[0].targetRef).toBe('https://aid.example.org/apply');
  });

  it('rejects medical advice and strips control characters from reasons', async () => {
    const advice = completer(a => ({ resources: [{ resourceKey: 'organization:o1', steps: [
      step('email', a['organization:o1'][0].ref, { reason: 'You should stop taking your chemo first.' }),
    ] }] }));
    expect(await refinePlan(base, inputs, { complete: advice })).toEqual(base);

    const ctrl = completer(a => ({ resources: [{ resourceKey: 'organization:o1', steps: [
      step('email', a['organization:o1'][0].ref, { reason: `Say hello\u0000‮ politely.${'x'.repeat(600)}` }),
    ] }] }));
    const out = await refinePlan(base, inputs, { complete: ctrl });
    const reason = out.resources[1].steps[0].reason;
    expect(reason.startsWith('Say hello politely.')).toBe(true);
    expect(reason.length).toBeLessThanOrEqual(400);
  });

  it('a first step must not wait', async () => {
    const complete = completer(a => ({ resources: [{ resourceKey: 'organization:o1', steps: [
      step('email', a['organization:o1'][0].ref, { waitFor: 'business_days:3' }),
    ] }] }));
    expect(await refinePlan(base, inputs, { complete })).toEqual(base);
  });

  it('identical refinement keeps source rules', async () => {
    const complete = vi.fn(async () => JSON.stringify({ resources: base.resources.map(r => ({ resourceKey: r.resourceKey, steps: [] })) }));
    expect((await refinePlan(base, inputs, { complete })).source).toBe('rules');
  });

  it.each([
    ['malformed JSON', async () => 'not json {'],
    ['schema mismatch', async () => JSON.stringify({ resources: 'nope' })],
    ['throwing completer', async () => { throw new Error('gateway down'); }],
  ])('%s falls back to the deterministic plan', async (_name, complete) => {
    expect(await refinePlan(base, inputs, { complete })).toEqual(base);
  });

  it('accepts fenced JSON', async () => {
    const complete = async (m: { role: 'system' | 'user' | 'assistant'; content: string }[]) => {
      const a = aliasesFrom(m);
      return '```json\n' + JSON.stringify({ resources: [{ resourceKey: 'organization:o1', steps: [step('email', a['organization:o1'][0].ref, { reason: 'Different words.' })] }] }) + '\n```';
    };
    expect((await refinePlan(base, inputs, { complete })).resources[1].steps[0].reason).toBe('Different words.');
  });

  it('times out a hanging completer', async () => {
    vi.useFakeTimers();
    try {
      const pending = refinePlan(base, inputs, { complete: () => new Promise<string>(() => {}) });
      await vi.advanceTimersByTimeAsync(31_000);
      expect(await pending).toEqual(base);
    } finally {
      vi.useRealTimers();
    }
  });

  it('honours an already-aborted signal without calling the model', async () => {
    const complete = vi.fn(async () => '{}');
    const ac = new AbortController();
    ac.abort();
    expect(await refinePlan(base, inputs, { complete, signal: ac.signal })).toEqual(base);
    expect(complete).not.toHaveBeenCalled();
  });

  it('buildContactPlan with llm uses the completer and never throws', async () => {
    const plan = await buildContactPlan('case-1', inputs, { now: NOW, llm: true, complete: async () => { throw new Error('x'); } });
    expect(plan).toEqual(base);
  });
});
