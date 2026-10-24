import { isTelehealthUrl } from './telehealth';
import type { Appointment } from './schema';

/** Google Maps search link for an address (a link only; no API key, nothing is fetched). */
export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;
}

/** tel: link with only dialable characters, or null when there is no plausible number. */
export function telLink(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const ext = phone.match(/(?:x|ext\.?)\s*(\d{1,6})\s*$/i)?.[1];
  const main = phone.replace(/(?:x|ext\.?)\s*\d{1,6}\s*$/i, '');
  let digits = main.replace(/\D/g, '');
  if (digits.length === 10) digits = `1${digits}`;
  if (digits.length < 11 || digits.length > 15) return null;
  return `tel:+${digits}${ext ? `,${ext}` : ''}`;
}

/** Join link only for a known https video host (the same rule as capture). */
export function safeJoinUrl(url: string | null | undefined): string | null {
  return url && isTelehealthUrl(url) ? url : null;
}

const compact = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

/** "Add to Google Calendar" template link (no OAuth needed). */
export function googleTemplateUrl(appt: Pick<Appointment, 'title' | 'startsAt' | 'endsAt' | 'location' | 'telehealthUrl'>, details: string): string | null {
  if (!appt.startsAt) return null;
  const end = appt.endsAt ?? new Date(new Date(appt.startsAt).getTime() + 3600000).toISOString();
  const q = new URLSearchParams({ action: 'TEMPLATE', text: appt.title, dates: `${compact(appt.startsAt)}/${compact(end)}`, details: details.slice(0, 1500) });
  const where = appt.location ?? appt.telehealthUrl;
  if (where) q.set('location', where);
  return `https://calendar.google.com/calendar/render?${q.toString()}`;
}

/** "Add to Outlook" deeplink (outlook.live.com compose). */
export function outlookUrl(appt: Pick<Appointment, 'title' | 'startsAt' | 'endsAt' | 'location' | 'telehealthUrl'>, details: string): string | null {
  if (!appt.startsAt) return null;
  const end = appt.endsAt ?? new Date(new Date(appt.startsAt).getTime() + 3600000).toISOString();
  const q = new URLSearchParams({ path: '/calendar/action/compose', rru: 'addevent', subject: appt.title, startdt: new Date(appt.startsAt).toISOString(), enddt: new Date(end).toISOString(), body: details.slice(0, 1500) });
  const where = appt.location ?? appt.telehealthUrl;
  if (where) q.set('location', where);
  return `https://outlook.live.com/calendar/0/deeplink/compose?${q.toString()}`;
}
