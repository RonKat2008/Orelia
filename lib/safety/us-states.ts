/** US state/territory codes and names, for the unshared-field scan (two-letter codes collide with English words). */
export const US_STATES: Readonly<Record<string, string>> = {
  AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut',
  DE: 'delaware', DC: 'district of columbia', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois',
  IN: 'indiana', IA: 'iowa', KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland',
  MA: 'massachusetts', MI: 'michigan', MN: 'minnesota', MS: 'mississippi', MO: 'missouri', MT: 'montana',
  NE: 'nebraska', NV: 'nevada', NH: 'new hampshire', NJ: 'new jersey', NM: 'new mexico', NY: 'new york',
  NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon', PA: 'pennsylvania',
  RI: 'rhode island', SC: 'south carolina', SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah',
  VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming',
  PR: 'puerto rico', GU: 'guam', VI: 'virgin islands',
};

/** A value that is exactly a two-letter US state code (any case). Returns the uppercase code or null. */
export function stateCodeOf(value: string): string | null {
  const code = value.trim().toUpperCase();
  return /^[A-Za-z]{2}$/.test(value.trim()) && Object.hasOwn(US_STATES, code) ? code : null;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Match spans of a state in text for a home-state code. Only an UPPERCASE isolated token counts, and only in a
 * location context: after a comma (", IN 46202", ", IN"), before a ZIP code, or right after in/from/of/near
 * ("lives in IN"). The full state name ("Indiana") always counts. The words in/or/me/ok/hi/oh... never match.
 * `text` must be case-preserving (whitespace-normalised) text.
 */
export function stateSpans(text: string, code: string): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  const token = `(?<![\\p{L}\\p{N}])${code}(?![\\p{L}\\p{N}])`;
  const contexts = [
    new RegExp(`,\\s*(${token})`, 'gu'),
    new RegExp(`(${token})\\s+\\d{5}(?:-\\d{4})?(?!\\d)`, 'gu'),
    new RegExp(`\\b(?:in|from|of|near|to)\\s+(${token})`, 'giu'),
    new RegExp(`\\bstate\\s*[:=]\\s*(${token})`, 'giu'),
  ];
  for (const re of contexts) {
    for (const m of text.matchAll(re)) {
      const start = m[0].lastIndexOf(m[1]) + (m.index ?? 0);
      // Case-sensitivity: the 'i' flag on the preposition context must not make the code case-insensitive.
      if (text.slice(start, start + code.length) === code) spans.push({ start, end: start + code.length });
    }
  }
  const name = new RegExp(`(?<![\\p{L}\\p{N}])${escape(US_STATES[code])}(?![\\p{L}\\p{N}])`, 'giu');
  for (const m of text.matchAll(name)) spans.push({ start: m.index ?? 0, end: (m.index ?? 0) + m[0].length });
  return spans;
}
