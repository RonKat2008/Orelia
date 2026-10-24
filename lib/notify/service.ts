import { isAllowed, parseAllowlist } from '../safety/allowlist';
import { approvalNotice, noticeHasHealthDetails } from './compose';
import { approvalUrl, signApprovalToken } from './link';
import { isQuietHours, localParts, timezoneForHomeState } from './quiet-hours';

export interface NotifyMailer {
  send(input: { to: string; subject: string; text: string }): Promise<{ id: string }>;
}

export interface NotifyCaseState {
  optIn: boolean;
  patientEmail: string | null;
  homeState: string | null;
  lastSentAt: Date | null;
  /** Local YYYY-MM-DD of the last daily digest. */
  lastDigestOn: string | null;
}

export interface NotifyRequest {
  caseId: string;
  pendingCount: number;
  state: NotifyCaseState;
  now: Date;
  /** dev and demo always enforce OUTBOUND_ALLOWLIST. prod skips it only when outboundAllowReal is "true". */
  mode: 'dev' | 'demo' | 'prod';
  allowlist: readonly string[];
  outboundAllowReal?: string;
  appBaseUrl: string;
  linkSecret: string;
  kind: 'immediate' | 'digest';
  mailer: NotifyMailer;
}

export type NotifyResult =
  | { sent: true; id: string; text: string; lastSentAt: string; lastDigestOn: string | null }
  | { sent: false; reason: 'not_opted_in' | 'no_address' | 'not_allowlisted' | 'quiet_hours' | 'debounced' | 'nothing_pending' | 'digest_already_sent' | 'health_text' };

const HOUR_MS = 60 * 60 * 1000;

export function notifyMode(source: { WAYFINDER_DEMO?: string; NODE_ENV?: string }): 'dev' | 'demo' | 'prod' {
  if (source.WAYFINDER_DEMO === '1' || source.WAYFINDER_DEMO === 'true') return 'demo';
  if (source.NODE_ENV === 'production') return 'prod';
  return 'dev';
}

export function allowlistFrom(raw: string | undefined): string[] {
  return parseAllowlist(raw ?? '');
}

export async function notifyPending(req: NotifyRequest): Promise<NotifyResult> {
  if (req.pendingCount < 1) return { sent: false, reason: 'nothing_pending' };
  if (!req.state.optIn) return { sent: false, reason: 'not_opted_in' };
  const email = req.state.patientEmail?.trim() ?? '';
  if (!email) return { sent: false, reason: 'no_address' };
  const enforceAllowlist = !(req.mode === 'prod' && req.outboundAllowReal === 'true');
  if (enforceAllowlist && !isAllowed(email, req.allowlist)) return { sent: false, reason: 'not_allowlisted' };
  if (isQuietHours(req.now, req.state.homeState)) return { sent: false, reason: 'quiet_hours' };

  const zone = timezoneForHomeState(req.state.homeState);
  const today = localParts(req.now, zone).date;
  if (req.kind === 'digest') {
    if (req.state.lastDigestOn === today) return { sent: false, reason: 'digest_already_sent' };
  } else if (req.state.lastSentAt && req.now.getTime() - req.state.lastSentAt.getTime() < HOUR_MS) {
    return { sent: false, reason: 'debounced' };
  }

  const { token } = signApprovalToken(req.caseId, req.now, req.linkSecret);
  const notice = approvalNotice(req.pendingCount, approvalUrl(req.appBaseUrl, req.caseId, token));
  if (noticeHasHealthDetails(notice.text)) return { sent: false, reason: 'health_text' };

  const sent = await req.mailer.send({ to: email, subject: notice.subject, text: notice.text });
  return {
    sent: true,
    id: sent.id,
    text: notice.text,
    lastSentAt: req.now.toISOString(),
    lastDigestOn: req.kind === 'digest' ? today : req.state.lastDigestOn,
  };
}
