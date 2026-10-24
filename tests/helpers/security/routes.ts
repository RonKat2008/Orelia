import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../../../', import.meta.url));
export const methods = ['GET', 'HEAD', 'OPTIONS', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type Method = typeof methods[number];
export type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> | Response;

/** Filesystem discovery, not a maintained list: new routes and new methods join the matrix. */
export function routeFiles(dir = path.join(root, 'app/api')): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? routeFiles(file) : entry.name === 'route.ts' ? [file] : [];
  }).sort();
}
export function routePath(file: string): string {
  return '/' + path.relative(path.join(root, 'app'), path.dirname(file)).split(path.sep).join('/');
}
export const mutates = (method: string) => !['GET', 'HEAD', 'OPTIONS'].includes(method);
export const CASE_ID = '11111111-1111-4111-8111-111111111111';
export const CONTACT_ID = '22222222-2222-4222-8222-222222222222';
export const TASK_ID = '33333333-3333-4333-8333-333333333333';
export const TARGET_ID = '44444444-4444-4444-8444-444444444444';
export const ORIGIN = 'https://wayfinder.test';
export const SECRET = 'synthetic-route-security-secret';
export const PRIVATE_MARKER = 'SYNTHETIC_PRIVATE_CASE_MARKER';
export const FAILURE = 'provider_error_synthetic: SELECT * FROM cases; DATABASE_URL ANTHROPIC_API_KEY\n    at provider (/private/server.ts:42:9)';

export function resourceId(route: string): string {
  return route.startsWith('/api/contacts/') ? CONTACT_ID : route.startsWith('/api/tasks/') ? TASK_ID : CASE_ID;
}
export function bodyFor(route: string): Record<string, unknown> {
  if (route === '/api/cases') return { reportText: 'Synthetic adult case report for a rare disease, for testing only.' };
  if (route === '/api/reviews') return { caseId: CASE_ID, targetId: TARGET_ID, targetKind: 'expert', reviewer: 'Synthetic reviewer', verdict: 'correct' };
  if (route === '/api/ranking/preview') return { caseId: CASE_ID, weights: { subtypeExpertise: 50, institutionalFit: 25, access: 15, contactability: 10 } };
  if (route.endsWith('/documents')) return { title: 'Synthetic note', text: 'Synthetic note for the route security test.' };
  if (route.endsWith('/consent')) return { sharedFields: ['diseaseName'] };
  if (route.startsWith('/api/contacts/') && route.endsWith('/approve')) return { draftId: TARGET_ID };
  if (route === '/api/outreach/select') return { caseId: CASE_ID, candidateIds: [TARGET_ID] };
  return { caseId: CASE_ID, fields: {} };
}
export function requestFor(route: string, method: Method, cookie?: string, origin: string | null = ORIGIN): Request {
  const url = new URL(route.replace('[id]', resourceId(route)), ORIGIN);
  url.searchParams.set('caseId', CASE_ID);
  return new Request(url, {
    method,
    headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}), ...(origin !== null ? { origin } : {}) },
    ...(mutates(method) ? { body: JSON.stringify(bodyFor(route)) } : {}),
  });
}
export const contextFor = (route: string) => ({ params: Promise.resolve({ id: resourceId(route) }) });
