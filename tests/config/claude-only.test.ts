import { afterEach, describe, expect, it, vi } from 'vitest';
import { modelFor, ROLES } from '@/config/models';

afterEach(() => vi.unstubAllEnvs());

describe('every language model is Claude', () => {
  it('maps every role except the embedding index to a Claude model', () => {
    for (const role of ROLES.filter((r) => r !== 'embedding')) expect(modelFor(role)).toMatch(/^claude-/);
  });

  it('ignores an env override that would swap a role to a non-Claude model', () => {
    vi.stubEnv('WAYFINDER_MODEL_JUDGE', 'gpt-5');
    expect(modelFor('judge')).toMatch(/^claude-/);
  });

  it('still honours a Claude override', () => {
    vi.stubEnv('WAYFINDER_MODEL_JUDGE', 'claude-sonnet-5-5');
    expect(modelFor('judge')).toBe('claude-sonnet-5-5');
  });
});
