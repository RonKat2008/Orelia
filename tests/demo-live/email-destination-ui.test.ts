import { describe, expect, it } from 'vitest';
import { disabledReason, EMAIL_DEST_OPTIONS, nextChoice } from '@/lib/demo-live/email-destination-ui';
import { destinationLabel } from '@/lib/activity/sources/contacts';
import { demoDestinationLabel, shortDemoLabel } from '@/components/outreach/DemoCoordinators';

const BOTH = { scripted: true, personal: true };

describe('email destination switch logic', () => {
  it('offers exactly the two choices, with the agreed labels', () => {
    expect(EMAIL_DEST_OPTIONS.map(o => o.value)).toEqual(['scripted', 'personal']);
    expect(EMAIL_DEST_OPTIONS[0]!.label).toBe('Scripted test inbox · auto-replies');
    expect(EMAIL_DEST_OPTIONS[1]!.label).toBe('My inbox');
  });
  it('arrow keys move between enabled options only', () => {
    expect(nextChoice('scripted', 'ArrowRight', BOTH)).toBe('personal');
    expect(nextChoice('personal', 'ArrowLeft', BOTH)).toBe('scripted');
    expect(nextChoice('scripted', 'ArrowRight', { scripted: true, personal: false })).toBeNull();
    expect(nextChoice('scripted', 'Tab', BOTH)).toBeNull();
  });
  it('gives a short reason for a disabled option', () => {
    expect(disabledReason('personal')).toMatch(/personal inbox/);
    expect(disabledReason('scripted')).toMatch(/scripted/);
  });
});

describe('contact row destination labels', () => {
  it('labels the scripted inbox "Test inbox (safe mode)" and a personal inbox "Your inbox (safe mode)"', () => {
    const demo = ['coord@agentmail.to', 'me@gmail.com'];
    expect(destinationLabel('coord@agentmail.to', 'email', demo)).toBe('Test inbox (safe mode)');
    expect(destinationLabel('Me@Gmail.com', 'email', demo)).toBe('Your inbox (safe mode)');
    expect(destinationLabel('+14155550123', 'voice', ['+14155550123'])).toBe('Test line (safe mode)');
  });
  it('never renders the address in either label', () => {
    expect(destinationLabel('me@gmail.com', 'email', ['me@gmail.com'])).not.toMatch(/gmail/);
  });
  it('badge labels distinguish the personal inbox', () => {
    const demo = { enabled: true, addresses: ['coord@agentmail.to', 'me@gmail.com'], callsRingTestNumber: false };
    expect(shortDemoLabel(demoDestinationLabel('coord@agentmail.to', demo)!)).toBe('Test inbox');
    expect(shortDemoLabel(demoDestinationLabel('me@gmail.com', demo)!)).toBe('Your inbox');
  });
});
