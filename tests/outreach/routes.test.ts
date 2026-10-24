import { expect, it, vi } from 'vitest';
const handlers = vi.hoisted(() => ({ select: vi.fn(), consent: vi.fn(), draft: vi.fn(), approve: vi.fn() }));
vi.mock('../../lib/outreach/server', () => ({ getOutreachHandlers: () => handlers }));
import { POST as select } from '../../app/api/outreach/select/route';
import { PUT as consent } from '../../app/api/contacts/[id]/consent/route';
import { POST as draft } from '../../app/api/contacts/[id]/drafts/route';
import { POST as approve } from '../../app/api/contacts/[id]/approve/route';
it('App Router routes delegate the request and awaited contact ID to validated handlers', async () => {
  const request = new Request('http://localhost');
  const context = { params: Promise.resolve({ id: 'contact-id' }) };
  for (const fn of Object.values(handlers)) fn.mockResolvedValue(Response.json({ ok: true }));
  await select(request); expect(handlers.select).toHaveBeenCalledWith(request);
  await consent(request, context); expect(handlers.consent).toHaveBeenCalledWith(request, 'contact-id');
  await draft(request, context); expect(handlers.draft).toHaveBeenCalledWith(request, 'contact-id');
  await approve(request, context); expect(handlers.approve).toHaveBeenCalledWith(request, 'contact-id');
});
