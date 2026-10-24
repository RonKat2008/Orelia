import { currentAccount } from '../accounts/current';
import { readSession } from './session';

/**
 * Who is looking. A signed-in account wins (key `account:<id>`, the same id cases.account_id stores); otherwise the
 * signed anonymous owner session (wf_session, the key cases.owner_session_id stores). Everything in the calendar lane
 * keys feeds and Google connections on `viewer.key` and authorizes appointments through case ownership.
 */
export type Viewer = { kind: 'account'; key: string; accountId: string } | { kind: 'session'; key: string };

type Env = Record<string, string | undefined>;
export const ACCOUNT_KEY_PREFIX = 'account:';

/** The account id behind a viewer key, or null for a session key. */
export function accountIdFromKey(key: string): string | null {
  return key.startsWith(ACCOUNT_KEY_PREFIX) ? key.slice(ACCOUNT_KEY_PREFIX.length) || null : null;
}

export async function getViewer(req: Request, env: Env = process.env): Promise<Viewer | null> {
  const account = await currentAccount(req);
  if (account?.id) return { kind: 'account', key: `${ACCOUNT_KEY_PREFIX}${account.id}`, accountId: account.id };
  const id = readSession(req, env);
  return id ? { kind: 'session', key: id } : null;
}
