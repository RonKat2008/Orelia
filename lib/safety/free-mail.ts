import { normalizeAddress } from './allowlist';

/**
 * Consumer (free) email providers. A doctor approval from one of these domains can never mint the physician
 * exemption: anyone can open such an inbox under any name, so it says nothing about who approved the text.
 */
export const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.uk', 'ymail.com', 'rocketmail.com',
  'outlook.com', 'hotmail.com', 'hotmail.co.uk', 'live.com', 'msn.com', 'passport.com',
  'icloud.com', 'me.com', 'mac.com', 'aol.com', 'aim.com',
  'proton.me', 'protonmail.com', 'protonmail.ch', 'pm.me', 'tutanota.com', 'tuta.io',
  'gmx.com', 'gmx.net', 'gmx.de', 'web.de', 'mail.com', 'email.com', 'usa.com',
  'yandex.com', 'yandex.ru', 'mail.ru', 'zoho.com', 'zohomail.com', 'fastmail.com', 'fastmail.fm',
  'hushmail.com', 'inbox.com', 'mailinator.com', 'qq.com', '163.com', '126.com',
  'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'bellsouth.net', 'cox.net', 'charter.net', 'earthlink.net',
]);

/** True when the address is on a consumer mail domain (or is not a valid address at all). */
export function isFreeMailAddress(address: string): boolean {
  const a = normalizeAddress(address);
  if (!a || !a.includes('@')) return true;
  return FREE_MAIL_DOMAINS.has(a.slice(a.lastIndexOf('@') + 1));
}
