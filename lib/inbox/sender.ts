import type { Party } from './drafts';

const ADDRESS = /^[^\s<>@,;"]+@[^\s<>@,;"]+\.[^\s<>@,;"]+$/;

/** The sender of an inbound email ("Name <a@b.org>" or "a@b.org") as a Party, or undefined if it holds no single valid address. */
export function parseSender(from: string | undefined): Party | undefined {
  if (!from) return undefined;
  const angle = from.match(/^\s*(?:"?([^"<]*?)"?\s*)?<([^<>]+)>\s*$/);
  const email = (angle ? angle[2]! : from).trim();
  if (!ADDRESS.test(email)) return undefined;
  const name = angle?.[1]?.trim();
  return { name: name && !name.includes('@') ? name : '', email };
}
