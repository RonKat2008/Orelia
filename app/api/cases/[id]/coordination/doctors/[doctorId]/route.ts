import { guardCase } from '@/lib/auth/ownership';
import { ConsultError, getConsultService } from '@/lib/coordination/consult';
import { jsonError, parseId } from '../../../../_lib/http';

export const runtime = 'nodejs';

type Ctx = { params: Promise<{ id: string; doctorId: string }> };

/** DELETE -> 204; 409 while an active consultation request uses this doctor. */
export async function DELETE(req: Request, { params }: Ctx) {
  const p = await params;
  const id = parseId(p.id);
  if (!id) return jsonError(400, 'Invalid case id');
  const denied = await guardCase(req, id);
  if (denied) return denied;
  const doctorId = parseId(p.doctorId);
  if (!doctorId) return jsonError(404, 'Doctor not found');
  try {
    await getConsultService().removeDoctor(id, doctorId);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof ConsultError) return jsonError(err.status, err.message);
    return jsonError(500, 'Unable to remove the doctor', err);
  }
}
