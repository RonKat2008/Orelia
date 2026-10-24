/** Only well-known video-visit hosts become a join link; any other URL in an untrusted reply is ignored. */
const TELEHEALTH_HOSTS = [/(^|\.)zoom\.us$/, /^teams\.microsoft\.com$/, /^teams\.live\.com$/, /^meet\.google\.com$/, /(^|\.)doxy\.me$/, /(^|\.)webex\.com$/, /(^|\.)amwell\.com$/, /(^|\.)vsee\.com$/];

export function isTelehealthUrl(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' && !u.username && !u.password && TELEHEALTH_HOSTS.some(re => re.test(u.hostname.toLowerCase()));
  } catch { return false; }
}

