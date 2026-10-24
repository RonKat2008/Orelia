import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PlanBoard } from '@/components/plan/PlanBoard';
import { buildPlan, getPlan, patchPlan } from '@/components/plan/client';
import { MotionPreference } from '@/lib/motion/MotionPreference';
import { enabledStepCount, isHttpUrl, movedIds, toggleEdit, waitText, withOrder, withToggle } from '@/components/plan/model';
import type { ContactPlan } from '@/lib/plan/contract';

const caseId = '11111111-1111-4111-8111-111111111111';
const now = '2026-10-24T10:00:00.000Z';

function step(id: string, order: number, over: Record<string, unknown> = {}) {
  return {
    id, order, channel: 'email', purpose: 'intro', targetRef: 'ev-email-1', reason: 'Coordinator listed this address.',
    evidenceIds: ['ev-email-1'], waitFor: 'none', enabled: true, ...over,
  };
}

const plan = {
  caseId, version: 3, status: 'draft', source: 'rules', summary: 'Email first, then call if no reply.',
  createdAt: now, updatedAt: now, approvedAt: null,
  resources: [
    {
      resourceKey: 'expert:e1', targetKind: 'expert', targetId: 'e1', name: 'Dr. Synthetic Example', contactId: 'c1',
      rule: 'specialist', unavailableReason: null,
      steps: [
        step('s1', 1),
        step('s2', 2, { channel: 'voice', purpose: 'follow_up', targetRef: 'ev-phone-1', evidenceIds: ['ev-phone-1'], waitFor: 'business_days:3' }),
        step('s3', 3, { channel: 'web_form', purpose: 'apply', targetRef: 'https://example.org/apply', evidenceIds: ['ev-form-1'], enabled: false }),
      ],
    },
    {
      resourceKey: 'organization:o1', targetKind: 'organization', targetId: 'o1', name: 'Synthetic Aid Fund', contactId: null,
      rule: 'none', steps: [], unavailableReason: 'No tool-sourced contact channel was found.',
    },
  ],
} as unknown as ContactPlan;

const noop = () => {};
function render(p: ContactPlan, reduced = false) {
  return renderToStaticMarkup(
    createElement(MotionPreference, { reducedMotion: reduced },
      createElement(PlanBoard, { plan: p, onToggle: noop, onMove: noop, onApprove: noop, onRebuild: noop })),
  );
}

describe('plan model', () => {
  it('words waitFor plainly', () => {
    expect(waitText('business_days:3', false)).toBe('If no reply after 3 business days');
    expect(waitText('business_days:1', false)).toBe('If no reply after 1 business day');
    expect(waitText('none', true)).toBe('Start here');
  });
  it('only links http(s) urls', () => {
    expect(isHttpUrl('https://example.org/x')).toBe(true);
    expect(isHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isHttpUrl('ev-email-1')).toBe(false);
  });
  it('builds optimistic toggle and reorder without mutating', () => {
    const toggled = withToggle(plan, 'expert:e1', 's1', false);
    expect(toggled.resources[0].steps[0].enabled).toBe(false);
    expect(plan.resources[0].steps[0].enabled).toBe(true);
    const ids = movedIds(plan.resources[0], 's1', 1);
    expect(ids).toEqual(['s2', 's1', 's3']);
    expect(movedIds(plan.resources[0], 's1', -1)).toBeNull();
    expect(withOrder(plan, 'expert:e1', ids!).resources[0].steps.find(s => s.id === 's1')?.order).toBe(2);
    expect(enabledStepCount(plan)).toBe(2);
    expect(toggleEdit('expert:e1', 's1', false)).toEqual({ type: 'toggle', resourceKey: 'expert:e1', stepId: 's1', enabled: false });
  });
});

describe('PlanBoard render', () => {
  it('renders summary, steps, reasons, chips, switches and move buttons', () => {
    const html = render(plan);
    expect(html).toContain('Email first, then call if no reply.');
    expect(html).toContain('Dr. Synthetic Example');
    expect(html.match(/data-testid="plan-step"/g)).toHaveLength(3);
    expect(html).toContain('If no reply after 3 business days');
    expect(html).toContain('Coordinator listed this address.');
    expect(html).toContain('role="switch"');
    expect(html).toContain('Move step 1 later for Dr. Synthetic Example');
    expect(html).toContain('href="https://example.org/apply"');
    expect(html).toContain('No tool-sourced contact channel was found.');
    expect(html).toContain('Approve plan &amp; draft messages');
  });
  it('renders without animation under reduced motion', () => {
    const html = render(plan, true);
    expect(html).not.toContain('transform:scaleY(0)');
    expect(html).toContain('plan-connector');
  });
  it('disables approve when no step is enabled', () => {
    const off = { ...plan, resources: plan.resources.map(r => ({ ...r, steps: r.steps.map(s => ({ ...s, enabled: false })) })) };
    const approveTag = (html: string) => /<button\b[^>]*>(?=Approve plan)/.exec(html)?.[0] ?? '';
    expect(approveTag(render(off))).toContain('disabled=""');
    expect(approveTag(render(plan))).not.toContain('disabled=""');
  });
});

describe('plan client', () => {
  const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
  it('GET returns 404 as a failure to trigger a build', async () => {
    const f = vi.fn(async () => ok({ error: 'No contact plan yet' }, 404));
    const res = await getPlan(caseId, f as unknown as typeof fetch);
    expect(res).toMatchObject({ ok: false, status: 404 });
  });
  it('PATCH sends version and edits, and returns the plan', async () => {
    const f = vi.fn(async (_u: string, init?: RequestInit) => {
      expect(init?.method).toBe('PATCH');
      expect(JSON.parse(String(init?.body))).toEqual({ version: 3, edits: [toggleEdit('expert:e1', 's1', false)] });
      return ok({ plan: { ...plan, version: 4 } });
    });
    const res = await patchPlan(caseId, 3, [toggleEdit('expert:e1', 's1', false)], f as unknown as typeof fetch);
    expect(res.ok && res.plan.version).toBe(4);
  });
  it('maps 409 and network errors', async () => {
    const conflict = vi.fn(async () => ok({ error: 'The contact plan changed; reload and try again' }, 409));
    expect(await patchPlan(caseId, 1, [{ type: 'approve' }], conflict as unknown as typeof fetch)).toMatchObject({ ok: false, status: 409 });
    const boom = vi.fn(async () => { throw new Error('offline'); });
    expect(await buildPlan(caseId, boom as unknown as typeof fetch)).toMatchObject({ ok: false, status: 0 });
  });
});
