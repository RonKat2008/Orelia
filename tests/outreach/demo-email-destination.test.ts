import { describe, expect, it } from 'vitest';
import {
  choiceOfAddress, demoEmailAddressFor, emailDestinationAvailability, emailDestinationGroups, emailInboxesFor, parseEmailChoice,
} from '../../lib/outreach/demo-email-destination';
import { demoDestinationFor } from '../../lib/outreach/demo-destinations';

const BASE = { WAYFINDER_DEMO_COORDINATORS: '1', AGENTMAIL_SENDER_INBOX_ID: 'sender@agentmail.to', NODE_ENV: 'test' };
const BOTH = { ...BASE, OUTBOUND_ALLOWLIST: 'a@agentmail.to,b@agentmail.to,me@gmail.com,sender@agentmail.to,+14155550123', DEMO_COORDINATOR_INBOXES: 'a@agentmail.to,b@agentmail.to,me@gmail.com' };
const ONLY_SCRIPTED = { ...BASE, OUTBOUND_ALLOWLIST: 'a@agentmail.to', DEMO_COORDINATOR_INBOXES: 'a@agentmail.to' };
const ONLY_PERSONAL = { ...BASE, OUTBOUND_ALLOWLIST: 'me@gmail.com', DEMO_COORDINATOR_INBOXES: 'me@gmail.com' };

describe('email destination groups', () => {
  it('splits configured inboxes by @agentmail.to', () => {
    expect(emailDestinationGroups(BOTH)).toEqual({ scripted: ['a@agentmail.to', 'b@agentmail.to'], personal: ['me@gmail.com'] });
    expect(emailDestinationAvailability(BOTH)).toEqual({ scripted: true, personal: true });
  });
  it('reports an empty group as unavailable', () => {
    expect(emailDestinationAvailability(ONLY_SCRIPTED)).toEqual({ scripted: true, personal: false });
    expect(emailDestinationAvailability(ONLY_PERSONAL)).toEqual({ scripted: false, personal: true });
  });
  it('is empty when demo mode is off', () => {
    expect(emailDestinationAvailability({ ...BOTH, WAYFINDER_DEMO_COORDINATORS: '' })).toEqual({ scripted: false, personal: false });
  });
  it('never includes an address that is configured but not allowlisted', () => {
    const env = { ...BOTH, DEMO_COORDINATOR_INBOXES: 'a@agentmail.to,evil@elsewhere.com' };
    expect(emailDestinationGroups(env).personal).toEqual([]);
  });
});

describe('routing by choice', () => {
  it('defaults to scripted when there is no choice', () => {
    expect(emailInboxesFor(BOTH, undefined)).toEqual(['a@agentmail.to', 'b@agentmail.to']);
    expect(demoDestinationFor(BOTH, 'email', 'trial:1')).toMatch(/@agentmail\.to$/);
  });
  it('falls back to every configured inbox by default when no scripted inbox exists', () => {
    expect(emailInboxesFor(ONLY_PERSONAL, undefined)).toEqual(['me@gmail.com']);
  });
  it('an explicit choice only ever picks from its own group', () => {
    for (let i = 0; i < 40; i++) {
      expect(demoEmailAddressFor(BOTH, 'personal', `trial:${i}`)).toBe('me@gmail.com');
      expect(['a@agentmail.to', 'b@agentmail.to']).toContain(demoEmailAddressFor(BOTH, 'scripted', `trial:${i}`));
    }
  });
  it('an explicit choice with an empty group yields no address (never the other group)', () => {
    expect(demoEmailAddressFor(ONLY_SCRIPTED, 'personal', 'trial:1')).toBeUndefined();
    expect(demoEmailAddressFor(ONLY_PERSONAL, 'scripted', 'trial:1')).toBeUndefined();
  });
  it('is stable per resource', () => {
    expect(demoEmailAddressFor(BOTH, 'scripted', 'org:7')).toBe(demoEmailAddressFor(BOTH, 'scripted', 'org:7'));
  });
  it('never returns a phone or an address outside the env', () => {
    const all = new Set(['a@agentmail.to', 'b@agentmail.to', 'me@gmail.com']);
    for (const c of ['scripted', 'personal', undefined] as const) {
      for (let i = 0; i < 20; i++) {
        const a = demoEmailAddressFor(BOTH, c, `x:${i}`);
        if (a) expect(all.has(a)).toBe(true);
      }
    }
  });
});

describe('parsing and labels', () => {
  it('parses only the two words', () => {
    expect(parseEmailChoice('personal')).toBe('personal');
    expect(parseEmailChoice('scripted')).toBe('scripted');
    expect(parseEmailChoice('me@gmail.com')).toBeUndefined();
    expect(parseEmailChoice(null)).toBeUndefined();
  });
  it('classifies an address', () => {
    expect(choiceOfAddress('A@AgentMail.to')).toBe('scripted');
    expect(choiceOfAddress('me@gmail.com')).toBe('personal');
  });
});
