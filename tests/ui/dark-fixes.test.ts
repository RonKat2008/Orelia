import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { contactViewSchema } from '../../lib/cases/activity';
import { agentsEmptyCopy } from '../../components/agents/empty-copy';
import { SKIP_AHEAD_DAYS, SKIP_AHEAD_LABEL, SKIP_AHEAD_MS, skipAheadNote } from '../../lib/demo-live/skip-ahead-days';
import { resolveJourney } from '../../components/journey/model';

const base = {
  id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', targetKind: 'organization', targetId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  displayName: 'Online form clinic', channel: 'web', state: 'drafted', nextFollowUpAt: null, lastActivityAt: null, consented: true, approved: false,
};

describe('approval-tasks banner root cause', () => {
  it('accepts an online-application (web) contact, which used to fail the whole contacts route with a 500', () => {
    expect(contactViewSchema.safeParse(base).success).toBe(true);
  });
  it('no longer shows the banner when the task count is known', () => {
    expect(resolveJourney('c', { status: 'ready', selectedCount: 1, openTaskCount: 0, contacts: null }).notes).not.toContain('Approval tasks could not be loaded.');
  });
});

describe('tracker empty-agents copy', () => {
  it('only says agents start on approval when the plan is not approved', () => {
    expect(agentsEmptyCopy('draft')).toBe('Agents start when you approve the contact plan.');
    expect(agentsEmptyCopy(null)).toBe('Agents start when you approve the contact plan.');
    expect(agentsEmptyCopy('approved')).not.toContain('start when you approve');
  });
});

describe('demo skip-ahead label and message', () => {
  it('agree with the server shift', () => {
    expect(SKIP_AHEAD_MS).toBe(SKIP_AHEAD_DAYS * 86_400_000);
    expect(SKIP_AHEAD_LABEL).toBe(`Skip ahead ${SKIP_AHEAD_DAYS} days`);
    expect(skipAheadNote(2)).toContain(`${SKIP_AHEAD_DAYS} days ahead`);
    expect(SKIP_AHEAD_LABEL).not.toMatch(/business/);
  });
});

describe('demo controls use theme tokens', () => {
  it.each(['components/demo/LiveDemoControls.tsx', 'components/demo/DemoPanel.tsx', 'components/demo/RunFullDemo.tsx'])('%s has no hard-coded light fallbacks', (file) => {
    expect(readFileSync(file, 'utf8')).not.toMatch(/var\(--color-[a-z-]+,\s*#/);
  });
});
