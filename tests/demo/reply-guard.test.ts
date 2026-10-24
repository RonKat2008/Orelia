import { describe, expect, it, vi } from 'vitest';
import type { DemoMail, DemoMessage } from '../../scripts/demo/mail';
import { DemoSendRefused, guardDemoMail } from '../../scripts/demo/reply-guard';

const COORD = 'intake@mdanderson.example';

function stubMail(from: string) {
  const message: DemoMessage = {
    messageId: 'm1', threadId: 't1', inboxId: 'i1', from, to: [COORD],
    subject: 's', text: 't', receivedAt: new Date(0).toISOString(),
  };
  const reply = vi.fn(async () => ({ messageId: 'r1' }));
  const mail: DemoMail = {
    mode: 'dry-run',
    createInbox: vi.fn(), listInboxes: vi.fn(), deleteInbox: vi.fn(),
    listReceived: async () => [message],
    reply,
  } as unknown as DemoMail;
  return { mail, reply };
}

describe('guardDemoMail', () => {
  it('refuses a reply to a target outside DEMO_REPLY_ALLOWLIST', async () => {
    const { mail, reply } = stubMail('stranger@hospital.example');
    const guarded = guardDemoMail(mail, { DEMO_REPLY_ALLOWLIST: 'case@agentmail.test' }, [COORD]);
    await expect(guarded.reply('i1', 'm1', 'hi')).rejects.toBeInstanceOf(DemoSendRefused);
    expect(reply).not.toHaveBeenCalled();
  });

  it('refuses everything when no allowlist is configured', async () => {
    const { mail, reply } = stubMail('case@agentmail.test');
    await expect(guardDemoMail(mail, {}, [COORD]).reply('i1', 'm1', 'hi')).rejects.toBeInstanceOf(DemoSendRefused);
    expect(reply).not.toHaveBeenCalled();
  });

  it('refuses an unknown message id', async () => {
    const { mail } = stubMail('case@agentmail.test');
    const guarded = guardDemoMail(mail, { DEMO_REPLY_ALLOWLIST: 'case@agentmail.test' }, [COORD]);
    await expect(guarded.reply('i1', 'nope', 'hi')).rejects.toBeInstanceOf(DemoSendRefused);
  });

  it('allows an allowlisted target, case-insensitively', async () => {
    const { mail, reply } = stubMail('Case <CASE@agentmail.test>');
    const guarded = guardDemoMail(mail, { DEMO_REPLY_ALLOWLIST: 'case@agentmail.test' }, [COORD]);
    await expect(guarded.reply('i1', 'm1', 'hi')).resolves.toEqual({ messageId: 'r1' });
    expect(reply).toHaveBeenCalledOnce();
  });
});
