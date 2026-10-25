import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { tasks, webApplications } from '@/db/schema';
import { demoDestinationsEnabled, verifyDemoFormToken, DEMO_FORM_PATH } from '@/lib/outreach/demo-destinations';
import { parseDemoFormSegment } from '@/lib/outreach/demo-destinations-shared';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Fields marked * on the demo form page. */
const REQUIRED_FIELDS = ['first_name', 'last_name', 'date_of_birth', 'email', 'phone', 'diagnosis', 'reason_for_visit'] as const;
const KNOWN_FIELDS = new Set<string>([
  ...REQUIRED_FIELDS, 'city', 'state', 'zip_code', 'insurance_provider', 'insurance_plan', 'referring_physician',
  'preferred_contact_method', 'additional_information', 'confirm_accurate',
]);

const ACCEPTING = new Set(['approved', 'submitting', 'submitted']);

const page = (status: number, message: string) =>
  new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="robots" content="noindex,nofollow"><title>Orelia demo form</title></head><body><p>${message}</p></body></html>`, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

export async function POST(req: Request, ctx: { params: Promise<{ resource: string }> }): Promise<Response> {
  const { resource } = await ctx.params;
  if (!demoDestinationsEnabled(process.env) || !parseDemoFormSegment(resource)) return new Response('Not found', { status: 404 });

  const url = new URL(req.url);
  const caseId = url.searchParams.get('case') ?? '';
  const applicationId = url.searchParams.get('app') ?? '';
  const token = url.searchParams.get('t');
  if (!verifyDemoFormToken(process.env, { caseId, applicationId, resource, token })) return page(403, 'This demo form link is not valid.');

  const db = getDb();
  const [row] = await db.select().from(webApplications).where(eq(webApplications.id, applicationId)).limit(1);
  if (!row || row.caseId !== caseId || !ACCEPTING.has(row.status)) return page(409, 'This demo form is not accepting a submission right now.');

  let fieldsReceived: string[] = [];
  try {
    const form = await req.formData();
    fieldsReceived = [...new Set([...form.keys()])].filter(k => KNOWN_FIELDS.has(k)).filter(k => {
      const vals = form.getAll(k);
      return vals.some(v => (typeof v === 'string' ? v.trim() !== '' : v.size > 0));
    });
  } catch {
    // An unreadable body is treated as an empty submission; values are never logged either way.
  }

  const missing = REQUIRED_FIELDS.filter(k => !fieldsReceived.includes(k));
  if (missing.length > 0) return page(422, 'Please fill in all required fields (marked *) and submit again.');

  const sourceId = `demo_form:${applicationId}`;
  if (row.contactId) {
    const existing = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.caseId, caseId), eq(tasks.sourceId, sourceId))).limit(1);
    if (existing.length === 0) {
      await db.insert(tasks).values({
        contactId: row.contactId,
        caseId,
        kind: 'application',
        status: 'done',
        title: 'Demo intake form received the application (Orelia test form)',
        details: { demo: true, applicationId, receivedAt: new Date().toISOString(), fieldsReceived, resource },
        sourceId,
      });
    }
  }

  const ref = applicationId.slice(0, 8);
  return new Response(null, { status: 303, headers: { location: `${DEMO_FORM_PATH}/${resource}/submitted?ref=${encodeURIComponent(ref)}` } });
}
