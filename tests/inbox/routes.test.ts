import { describe, expect, it, vi } from 'vitest';
import { inboxHandlers } from '../../lib/inbox/http';
import { MemoryTaskStore } from '../../lib/inbox/task-store';
import type { OutreachStore } from '../../lib/outreach/types';

const handlers = vi.hoisted(() => ({ approve: vi.fn(), get: vi.fn() }));
vi.mock('../../lib/inbox/server', () => ({ getInboxHandlers: () => handlers }));
const guards = vi.hoisted(() => ({ guardTask: vi.fn(), requireTaskOwner: vi.fn() }));
vi.mock('../../lib/auth/ownership', () => guards);
import { POST } from '../../app/api/tasks/[id]/approve/route';
import { GET } from '../../app/api/tasks/[id]/route';

describe('task routes', () => {
  it('delegate with the awaited id', async () => {
    const req = new Request('http://localhost'); const context = { params: Promise.resolve({ id: 'x' }) };
    guards.guardTask.mockResolvedValue(null); guards.requireTaskOwner.mockResolvedValue({ ok: true, sessionId: 's' });
    handlers.approve.mockResolvedValue(Response.json({})); handlers.get.mockResolvedValue(Response.json({}));
    await POST(req, context); expect(guards.guardTask).toHaveBeenCalledWith(req, 'x'); expect(handlers.approve).toHaveBeenCalledWith(req, 'x');
    await GET(req, context); expect(guards.requireTaskOwner).toHaveBeenCalledWith(req, 'x'); expect(handlers.get).toHaveBeenCalledWith(req, 'x');
  });
  it('handlers: bad uuid 400, unknown 404', async () => {
    const api = inboxHandlers({ tasks: new MemoryTaskStore(), outreach: {} as OutreachStore });
    const req = new Request('http://localhost', { method: 'POST' });
    expect((await api.approve(req, 'nope')).status).toBe(400);
    const res = await api.approve(req, crypto.randomUUID());
    expect(res.status).toBe(404); expect((await res.json()).reasons).toEqual(['task_not_found']);
    expect((await api.get(req, crypto.randomUUID())).status).toBe(404);
  });
});
