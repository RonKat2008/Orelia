import { notFound } from 'next/navigation';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { experts, institutions, organizations, trials } from '@/db/schema';
import { demoDestinationsEnabled } from '@/lib/outreach/demo-destinations';
import { parseDemoFormSegment } from '@/lib/outreach/demo-destinations-shared';
import { DemoBanner, demoPageStyles } from './demo-chrome';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'New patient request (Wayfinder demo form)',
  robots: { index: false, follow: false },
};

type Target = { targetKind: string; targetId: string };

async function resourceName(t: Target): Promise<string> {
  try {
    const db = getDb();
    if (t.targetKind === 'organization') return (await db.select({ n: organizations.name }).from(organizations).where(eq(organizations.id, t.targetId)))[0]?.n ?? 'Demo clinic';
    if (t.targetKind === 'institution') return (await db.select({ n: institutions.name }).from(institutions).where(eq(institutions.id, t.targetId)))[0]?.n ?? 'Demo clinic';
    if (t.targetKind === 'expert') return (await db.select({ n: experts.name }).from(experts).where(eq(experts.id, t.targetId)))[0]?.n ?? 'Demo clinic';
    return (await db.select({ n: trials.title }).from(trials).where(eq(trials.id, t.targetId)))[0]?.n ?? 'Demo clinic';
  } catch {
    return 'Demo clinic';
  }
}

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

interface FieldProps { id: string; label: string; type?: string; autoComplete?: string }

function Field({ id, label, type = 'text', autoComplete }: FieldProps) {
  return (
    <div style={demoPageStyles.field}>
      <label htmlFor={id} style={demoPageStyles.label}>{label}</label>
      <input id={id} name={id} type={type} autoComplete={autoComplete} style={demoPageStyles.input} />
    </div>
  );
}

function TextArea({ id, label }: { id: string; label: string }) {
  return (
    <div style={demoPageStyles.field}>
      <label htmlFor={id} style={demoPageStyles.label}>{label}</label>
      <textarea id={id} name={id} rows={4} style={{ ...demoPageStyles.input, resize: 'vertical' }} />
    </div>
  );
}

export default async function DemoIntakeFormPage({ params, searchParams }: {
  params: Promise<{ resource: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { resource } = await params;
  const parsed = parseDemoFormSegment(resource);
  if (!demoDestinationsEnabled(process.env) || !parsed) notFound();
  const sp = await searchParams;
  const name = await resourceName(parsed);
  const q = new URLSearchParams({ case: one(sp.case), app: one(sp.app), t: one(sp.t) });
  const action = `/api/demo-intake/${encodeURIComponent(resource)}?${q.toString()}`;
  const s = demoPageStyles;

  return (
    <div style={s.page}>
      <DemoBanner name={name} />
      <main style={s.main}>
        <h1 style={s.h1}>{name}</h1>
        <p style={s.sub}>New patient appointment request</p>
        <p style={s.intro}>Tell us a little about yourself and our scheduling team will be in touch to arrange a first visit.</p>
        <form method="post" action={action} style={s.form}>
          <fieldset style={s.fieldset}>
            <legend style={s.legend}>About you</legend>
            <div style={s.row}>
              <Field id="first_name" label="First name *" autoComplete="given-name" />
              <Field id="last_name" label="Last name *" autoComplete="family-name" />
            </div>
            <Field id="date_of_birth" label="Date of birth *" type="date" autoComplete="bday" />
            <Field id="email" label="Email *" type="email" autoComplete="email" />
            <Field id="phone" label="Phone *" type="tel" autoComplete="tel" />
            <Field id="city" label="City" autoComplete="address-level2" />
            <div style={s.row}>
              <Field id="state" label="State" autoComplete="address-level1" />
              <Field id="zip_code" label="ZIP code" autoComplete="postal-code" />
            </div>
          </fieldset>
          <fieldset style={s.fieldset}>
            <legend style={s.legend}>Insurance</legend>
            <Field id="insurance_provider" label="Insurance provider" />
            <Field id="insurance_plan" label="Insurance plan" />
          </fieldset>
          <fieldset style={s.fieldset}>
            <legend style={s.legend}>Your visit</legend>
            <Field id="diagnosis" label="Diagnosis or condition *" />
            <Field id="referring_physician" label="Referring physician (optional)" />
            <div style={s.field}>
              <label htmlFor="preferred_contact_method" style={s.label}>Preferred contact method</label>
              <select id="preferred_contact_method" name="preferred_contact_method" defaultValue="Email" style={s.input}>
                <option value="Email">Email</option>
                <option value="Phone">Phone</option>
                <option value="Either">Either</option>
              </select>
            </div>
            <TextArea id="reason_for_visit" label="Reason for visit *" />
            <TextArea id="additional_information" label="Anything else we should know" />
          </fieldset>
          <div style={s.confirm}>
            <input id="confirm_accurate" name="confirm_accurate" type="checkbox" value="yes" style={{ width: 18, height: 18, flex: 'none' }} />
            <label htmlFor="confirm_accurate" style={{ fontSize: 15 }}>I confirm the information is accurate</label>
          </div>
          <button type="submit" style={s.button}>Submit request</button>
        </form>
      </main>
    </div>
  );
}
