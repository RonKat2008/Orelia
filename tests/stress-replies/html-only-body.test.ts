import { describe, expect, it } from 'vitest';
import { mailBody, mailDeps } from './_shared';

describe('HTML-only reply', () => {
  it('keeps the reply text when AgentMail sends html but no text/extracted_text', async () => {
    const seen: string[] = [];
    const { handle, stored } = mailDeps(async e => { seen.push(e.body); return {}; });
    const res = await handle(mailBody({ html: '<p>Please send the pathology <b>slides</b> to our lab.</p>' }));
    expect(res.status).toBe(200);
    // Today body = String(undefined ?? undefined ?? '') = '' : stored, classified and kept as an empty reply.
    expect(stored[0]!.body).toContain('slides');
    expect(seen[0]).toContain('slides');
  });
});
