import { devFormEnabled } from '@/lib/web-application/dev-form';

export const runtime = 'nodejs';
const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);

/** Accepts the synthetic form and echoes only the names of the fields received. Stores nothing. */
export async function POST(request: Request) {
  if (!devFormEnabled()) return new Response('Not found', { status: 404 });
  const form = await request.formData();
  const names = [...new Set([...form.keys()])];
  const body = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Application received (test)</title></head><body><main><h1>Application received</h1><p>This was a synthetic test form. Nothing was stored.</p><p data-testid="received-fields">Fields received: ${names.map(escapeHtml).join(', ')}</p></main></body></html>`;
  return new Response(body, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
}
