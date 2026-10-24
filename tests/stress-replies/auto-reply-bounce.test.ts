import { describe, expect, it } from 'vitest';
import { mailBody, mailDeps } from './_shared';

describe('automated mail on the thread', () => {
  it('a bounce from MAILER-DAEMON does not count as the contact replying', async () => {
    const { handle, events } = mailDeps(async () => ({}));
    const res = await handle(mailBody({
      from: 'MAILER-DAEMON@mx.site.test', subject: 'Undeliverable: New patient question',
      text: 'Delivery has failed to these recipients: intake@site.test. The mailbox is full.',
    }));
    expect(res.status).toBe(200);
    // Today a contact/reply event fires: contact -> replied and pre-approved follow-ups are cancelled.
    expect(events.map(e => e.name)).not.toContain('contact/reply');
  });
  it('an out-of-office auto-reply does not stop follow-ups', async () => {
    const { handle, events } = mailDeps(async () => ({}));
    await handle(mailBody({ subject: 'Automatic reply: New patient question', text: 'I am out of the office until Monday with limited access to email.' }));
    expect(events.map(e => e.name)).not.toContain('contact/reply');
  });
});
