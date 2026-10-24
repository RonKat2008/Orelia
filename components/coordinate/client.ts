import type { Board, ConsultRequest, Doctor, RequirementsChecklist, Resource, SpecialistPacket, ContactOption, RequirementStatus } from './types';
import { encodeKey } from './model';

export type ApiResult<T> = { ok: true; data: T } | { ok: false; status: number; message: string; reasons?: string[] };

const GENERIC = 'Something went wrong. Nothing was sent.';

async function call<T>(url: string, init: RequestInit | undefined, pick: (body: Record<string, unknown>) => T | undefined): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, init);
    let body: Record<string, unknown> = {};
    try { body = (await res.json()) as Record<string, unknown>; } catch { body = {}; }
    if (res.ok) {
      const data = pick(body);
      return data === undefined ? { ok: false, status: 502, message: 'The answer came back in an unexpected shape.' } : { ok: true, data };
    }
    const err = body.error;
    const message = typeof err === 'string' ? err : typeof (err as { message?: unknown } | undefined)?.message === 'string' ? (err as { message: string }).message : GENERIC;
    const reasons = Array.isArray(body.reasons) ? (body.reasons as unknown[]).filter((r): r is string => typeof r === 'string') : undefined;
    return { ok: false, status: res.status, message, reasons };
  } catch {
    return { ok: false, status: 0, message: 'Could not reach the server. Nothing was sent.' };
  }
}

const base = (caseId: string) => `/api/cases/${encodeURIComponent(caseId)}/coordination`;
const send = (method: string, body?: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
const arr = <T,>(key: string) => (b: Record<string, unknown>) => (Array.isArray(b[key]) ? (b[key] as T[]) : undefined);
const one = <T,>(key: string) => (b: Record<string, unknown>) => (b[key] && typeof b[key] === 'object' ? (b[key] as T) : undefined);

export const loadResources = (caseId: string) =>
  call<Resource[]>(`/api/cases/${encodeURIComponent(caseId)}/plan?optional=1`, undefined, b => {
    if (b.plan === null) return [];
    const plan = b.plan as { resources?: Resource[] } | undefined;
    return plan && Array.isArray(plan.resources) ? plan.resources.map(r => ({ resourceKey: r.resourceKey, name: r.name, contactId: r.contactId ?? null })) : undefined;
  });
export const loadContacts = (caseId: string) =>
  call<ContactOption[]>(`/api/cases/${encodeURIComponent(caseId)}/contacts`, undefined, arr<ContactOption>('contacts'));

export const getChecklists = (c: string) => call<RequirementsChecklist[]>(`${base(c)}/requirements`, undefined, arr('checklists'));
export const checkRequirements = (c: string, resourceKey?: string) => call<RequirementsChecklist[]>(`${base(c)}/requirements`, send('POST', resourceKey ? { resourceKey } : {}), arr('checklists'));
export const setRequirement = (c: string, resourceKey: string, version: number, requirementId: string, status: RequirementStatus, note?: string) =>
  call<RequirementsChecklist>(`${base(c)}/requirements`, send('PATCH', { resourceKey, version, requirementId, status, ...(note !== undefined ? { note } : {}) }), one('checklist'));

export const getPackets = (c: string) => call<SpecialistPacket[]>(`${base(c)}/packets`, undefined, arr('packets'));
export const buildPacket = (c: string, resourceKey: string) => call<SpecialistPacket>(`${base(c)}/packets`, send('POST', { resourceKey }), one('packet'));
export const patchPacket = (c: string, resourceKey: string, version: number, patch: { included?: Record<string, boolean>; questions?: string[] }) =>
  call<SpecialistPacket>(`${base(c)}/packets`, send('PATCH', { resourceKey, version, ...patch }), one('packet'));
export const attachPacket = (c: string, resourceKey: string, contactId: string) =>
  call<string>(`${base(c)}/packets/attach`, send('POST', { resourceKey, contactId }), b => (typeof b.draftId === 'string' ? b.draftId : undefined));

export const getBoard = (c: string) => call<Board>(`${base(c)}/board`, undefined, one('board'));

export const getDoctors = (c: string) => call<Doctor[]>(`${base(c)}/doctors`, undefined, arr('doctors'));
export const addDoctor = (c: string, d: { name: string; practice?: string; email: string; npi?: string }) => call<Doctor>(`${base(c)}/doctors`, send('POST', d), one('doctor'));
export const removeDoctor = (c: string, id: string) => call<true>(`${base(c)}/doctors/${encodeURIComponent(id)}`, send('DELETE'), () => true);

export const getConsults = (c: string) => call<ConsultRequest[]>(`${base(c)}/consults`, undefined, arr('consults'));
export const startConsult = (c: string, b: { resourceKey: string; doctorId: string; packetId?: string; sharedFields: string[] }) => call<ConsultRequest>(`${base(c)}/consults`, send('POST', b), one('consult'));
export const patchConsult = (c: string, id: string, b: { version: number; action: 'edit' | 'send_to_doctor' | 'consent' | 'send' | 'cancel'; subject?: string; body?: string }) =>
  call<ConsultRequest>(`${base(c)}/consults/${encodeURIComponent(id)}`, send('PATCH', b), one('consult'));

export const packetPrintHref = (caseId: string, resourceKey: string) => `/cases/${encodeURIComponent(caseId)}/coordinate/packet/${encodeKey(resourceKey)}`;
