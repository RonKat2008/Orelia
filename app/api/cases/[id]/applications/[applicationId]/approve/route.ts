import { after, NextResponse } from 'next/server';
import { wakeAgentForApplication } from '@/lib/agents/factory';
import { z } from 'zod';
import { guardCase } from '@/lib/auth/ownership';
import { approveApplication } from '@/lib/web-application/approve';
import { defaultApproveDeps } from '@/lib/web-application/server';
import { getApplicationStore } from '@/lib/web-application/store';
import { jsonError, parseBody, parseId } from '../../../../_lib/http';
import { getServices } from '../../../../_lib/services';

export const runtime = 'nodejs';
type Ctx = { params: Promise<{ id: string; applicationId?: string }> };

const body = z.object({ sharedDocIds: z.array(z.string().min(1).max(200)).max(20).optional() }).strict();

/**
 * POST /api/cases/[id]/applications/[applicationId]/approve { sharedDocIds? }
 * The patient approves the reviewed application; the outbound gate runs, then it is submitted once.
 */
export async function POST(req: Request, { params }: Ctx) {
  const p = await params;
  const id = parseId(p.id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const applicationId = parseId(p.applicationId ?? '');
  if (!applicationId) return jsonError(400, 'Invalid application id');
  const parsed = await parseBody(req, body);
  if (!parsed.ok) return parsed.response;
  try {
    if (!await getServices().cases.get(id)) return jsonError(404, 'Case not found');
    const app = await getApplicationStore().get(applicationId);
    if (!app || app.caseId !== id) return NextResponse.json({ reasons: ['application_not_found'] }, { status: 404 });
    const res = await approveApplication(applicationId, parsed.data, defaultApproveDeps());
    // Kernel completion: the owning resource agent records the submission and plans its next step.
    if (res.ok) after(() => wakeAgentForApplication(id, app.contactId ?? null));
    return res.ok ? NextResponse.json(res) : NextResponse.json({ reasons: res.reasons }, { status: res.status });
  } catch (err) {
    return jsonError(500, 'Unable to approve the application', err);
  }
}
