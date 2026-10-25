import type { CSSProperties } from 'react';

/** Neutral, light clinic look shared by the demo intake form and its confirmation page (deliberately not Orelia-branded). */
const base: CSSProperties = { boxSizing: 'border-box', width: '100%', maxWidth: '100%' };

export const demoPageStyles = {
  page: { minHeight: '100vh', background: '#f4f7f9', color: '#1b2733', fontFamily: 'Arial, Helvetica, sans-serif', colorScheme: 'light', overflowX: 'hidden' } as CSSProperties,
  banner: { background: '#fff4d6', borderBottom: '2px solid #e0a800', color: '#4a3800', padding: '10px 16px', fontSize: 14, lineHeight: 1.4, textAlign: 'center' } as CSSProperties,
  main: { maxWidth: 640, margin: '0 auto', padding: '24px 16px 48px' } as CSSProperties,
  h1: { fontSize: 26, margin: '0 0 4px', color: '#0f4c5c', overflowWrap: 'anywhere' } as CSSProperties,
  sub: { fontSize: 18, margin: '0 0 12px', fontWeight: 600 } as CSSProperties,
  intro: { margin: '0 0 20px', color: '#44525f', lineHeight: 1.5 } as CSSProperties,
  form: { display: 'flex', flexDirection: 'column', gap: 16 } as CSSProperties,
  fieldset: { background: '#fff', border: '1px solid #d5dde3', borderRadius: 6, padding: '12px 16px 16px', margin: 0, minWidth: 0 } as CSSProperties,
  legend: { fontWeight: 700, fontSize: 15, padding: '0 6px', color: '#0f4c5c' } as CSSProperties,
  row: { display: 'flex', gap: 12, flexWrap: 'wrap' } as CSSProperties,
  field: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10, flex: '1 1 200px', minWidth: 0 } as CSSProperties,
  label: { fontSize: 14, fontWeight: 600 } as CSSProperties,
  input: { ...base, font: 'inherit', fontSize: 16, padding: '9px 10px', border: '1px solid #9aa9b5', borderRadius: 4, background: '#fff', color: '#1b2733' } as CSSProperties,
  confirm: { display: 'flex', alignItems: 'center', gap: 10 } as CSSProperties,
  button: { font: 'inherit', fontSize: 16, fontWeight: 700, padding: '12px 20px', background: '#0f4c5c', color: '#fff', border: 0, borderRadius: 4, cursor: 'pointer', alignSelf: 'flex-start' } as CSSProperties,
};

export function DemoBanner({ name }: { name: string }) {
  return (
    <div role="note" style={demoPageStyles.banner}>
      Demo form hosted by Orelia — stands in for {name}&rsquo;s online form. Nothing here reaches a real clinic.
    </div>
  );
}
