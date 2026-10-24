import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { isAllowedDomain, offendingEmails } from './fixture-emails';

const ROOT = path.resolve(__dirname, '../..');

describe('fixtures contain no real email domains (hard rule 4)', () => {
  it('has only .example / reserved / owned-test domains in fixtures/** and data/**', () => {
    expect(offendingEmails(ROOT, ['fixtures', 'data'])).toEqual([]);
  });

  it('classifies domains correctly', () => {
    for (const ok of ['mdanderson.example', 'x.example.org', 'example.com', 'agentmail.test', 'example-test.agentmail.to']) {
      expect(isAllowedDomain(ok)).toBe(true);
    }
    for (const bad of ['mdanderson.org', 'gmail.com', 'notexample.com', 'mayo.edu']) {
      expect(isAllowedDomain(bad)).toBe(false);
    }
  });
});
