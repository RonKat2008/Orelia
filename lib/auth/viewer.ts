import { readSession } from './session';

/**
 * Who is looking. Today a viewer is the signed owner session (wf_session cookie), the same key cases.owner_session_id
 * stores. When accounts land, swap `resolveViewer` for the account lookup: everything in the calendar lane keys on
 * `viewer.key` and authorizes through case ownership, so nothing else changes.
 */
export interface Viewer { kind: 'session'; key: string }

type Env = Record<string, string | undefined>;

export function resolveViewer(req: Request, env: Env = process.env): Viewer | null {
  const id = readSession(req, env);
  return id ? { kind: 'session', key: id } : null;
}

export function getViewer(req: Request, env: Env = process.env): Viewer | null {
  return resolveViewer(req, env);
}
