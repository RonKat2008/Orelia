import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

/** local@domain; the domain is captured as dot-separated labels (shared by the test and the rewrite). */
export const EMAIL_DOMAIN = /@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

const RESERVED_SUFFIXES = ['.example', '.test', '.invalid', 'example.com', 'example.org', 'example.net'];
/** Test inboxes we own; the only non-reserved domain allowed in fixtures. */
const ALLOWED_DOMAINS = ['example-test.agentmail.to'];

export function isAllowedDomain(domain: string): boolean {
  const d = domain.toLowerCase();
  return (
    ALLOWED_DOMAINS.includes(d) ||
    RESERVED_SUFFIXES.some(s => (s.startsWith('.') ? d.endsWith(s) : d === s || d.endsWith(`.${s}`)))
  );
}

export function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) yield* walk(full);
    else yield full;
  }
}

export function offendingEmails(root: string, dirs: string[]): string[] {
  const bad: string[] = [];
  for (const dir of dirs) {
    for (const file of walk(path.join(root, dir))) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(EMAIL_DOMAIN)) {
        if (!isAllowedDomain(m[1])) bad.push(`${path.relative(root, file)}: @${m[1]}`);
      }
    }
  }
  return bad;
}
