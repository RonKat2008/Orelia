import { describe, expect, it } from 'vitest';
import { MockCaller } from '../../lib/channels/mock-caller';
import { MockMailer } from '../../lib/channels/mock-mailer';
import { ChannelError } from '../../lib/channels/types';
import { forged, gatedCall, gatedEmail, guard, TEST_EMAIL, TEST_PHONE } from './helpers';

describe('MockMailer', () => {
  it('records a gated email and returns provider ids', async () => {
    const mailer = new MockMailer(guard);
    const ref = await mailer.send(gatedEmail());
    expect(ref).toMatchObject({ provider: 'mock-mailer', channel: 'email', threadId: 'mock-thread-1', messageId: 'mock-message-1' });
    expect(mailer.sent).toHaveLength(1);
    expect(mailer.sent[0]).toMatchObject({ to: TEST_EMAIL, subject: 'Second opinion request' });
  });
  it('keeps follow-ups to the same contact in one thread', async () => {
    const mailer = new MockMailer(guard);
    const first = await mailer.send(gatedEmail({ contactId: 'c1' }));
    const second = await mailer.send(gatedEmail({ contactId: 'c1' }));
    expect(second.threadId).toBe(first.threadId);
    expect(second.messageId).not.toBe(first.messageId);
  });
  it('refuses forged payloads, wrong channel and non-allowlisted addresses', async () => {
    const mailer = new MockMailer(guard);
    await expect(mailer.send(forged())).rejects.toBeInstanceOf(ChannelError);
    await expect(mailer.send(gatedCall())).rejects.toThrow(/voice payload on email/);
    await expect(new MockMailer({ allowlist: [] }).send(gatedEmail())).rejects.toThrow(/OUTBOUND_ALLOWLIST/);
    expect(mailer.sent).toHaveLength(0);
  });
});

describe('MockCaller', () => {
  it('records a call and completes it with a transcript', async () => {
    const caller = new MockCaller(guard);
    const ref = await caller.send(gatedCall());
    expect(ref).toMatchObject({ provider: 'mock-caller', channel: 'voice', status: 'queued' });
    expect(ref.callId).toMatch(/^mock-call-[0-9a-f-]{36}$/);
    expect(caller.calls[0]!.to).toBe(TEST_PHONE);
    expect(caller.complete(ref.callId!, 'Please fax the referral.')).toMatchObject({ status: 'completed', transcript: 'Please fax the referral.' });
    expect(() => caller.complete('nope', '')).toThrow(ChannelError);
  });
  it('call ids do not repeat across instances (process restarts vs the call_id unique index)', async () => {
    const a = await new MockCaller(guard).send(gatedCall());
    const b = await new MockCaller(guard).send(gatedCall());
    expect(a.callId).not.toBe(b.callId);
  });
  it('refuses email payloads and non-allowlisted numbers', async () => {
    await expect(new MockCaller(guard).send(gatedEmail())).rejects.toThrow(/email payload on voice/);
    await expect(new MockCaller({ allowlist: [] }).send(gatedCall())).rejects.toThrow(/OUTBOUND_ALLOWLIST/);
  });
});
