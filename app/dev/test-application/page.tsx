import { notFound } from 'next/navigation';
import { devFormEnabled } from '@/lib/web-application/dev-form';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Test application form (synthetic)', robots: { index: false, follow: false } };

const field = { display: 'grid', gap: 4, marginBlock: 14 } as const;
const input = { font: 'inherit', padding: '8px 10px', border: '1px solid currentColor', borderRadius: 4, background: 'transparent', color: 'inherit' } as const;

/** Synthetic application form for exercising the web_form channel. Collects nothing and is disabled in production. */
export default function TestApplicationPage() {
  if (!devFormEnabled()) notFound();
  return (
    <main style={{ maxWidth: 560, margin: '48px auto', padding: '0 16px', fontFamily: 'ui-sans-serif, system-ui, sans-serif' }}>
      <header>
        <p style={{ letterSpacing: '0.08em', textTransform: 'uppercase', fontSize: 12, margin: 0 }}>Synthetic test fixture</p>
        <h1 style={{ margin: '4px 0 8px' }}>Patient assistance application</h1>
        <p>This form exists only to test Wayfinder&apos;s web application channel. Nothing entered here is stored or sent anywhere.</p>
      </header>
      <form method="post" action="/dev/test-application/submit" encType="multipart/form-data" aria-label="Test application">
        <label style={field}>Full name<input style={input} name="fullName" type="text" required autoComplete="off" /></label>
        <label style={field}>Email address<input style={input} name="email" type="email" required autoComplete="off" /></label>
        <label style={field}>Phone number<input style={input} name="phone" type="tel" autoComplete="off" /></label>
        <label style={field}>City<input style={input} name="city" type="text" autoComplete="off" /></label>
        <label style={field}>State<input style={input} name="state" type="text" autoComplete="off" /></label>
        <label style={field}>Insurance provider<input style={input} name="insurer" type="text" autoComplete="off" /></label>
        <label style={field}>Diagnosis or condition name<input style={input} name="diagnosis" type="text" autoComplete="off" /></label>
        <label style={field}>Describe any medications you take<textarea style={input} name="medicalHistory" rows={3} /></label>
        <label style={field}>Anything else you want to tell us<textarea style={input} name="notes" rows={3} /></label>
        <label style={field}>Upload a supporting document<input style={input} name="documents" type="file" /></label>
        <label style={{ ...field, gridTemplateColumns: 'auto 1fr', alignItems: 'center', gap: 8 }}>
          <input name="consentConfirm" type="checkbox" required /> I authorize this application
        </label>
        <button type="submit" style={{ ...input, cursor: 'pointer', fontWeight: 600, padding: '10px 18px' }}>Submit application</button>
      </form>
    </main>
  );
}
