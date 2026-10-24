import { addBusinessDays } from './business-days';

export type ContactState =
  | 'drafted'
  | 'sent'
  | 'replied'
  | 'task_open'
  | 'records_sent'
  | 'appointment_booked'
  | 'connected'
  | 'declined'
  | 'stalled';

export type ConnectionEvent =
  | { type: 'APPROVED_SENT' }
  | { type: 'REPLY_RECEIVED' }
  | { type: 'TASK_CREATED' }
  | { type: 'TASK_DONE' }
  | { type: 'FOLLOW_UP_DUE' }
  | { type: 'DECLINED' }
  | { type: 'BOOKED'; outcome?: 'appointment_booked' | 'connected' };

export const FOLLOW_UP_BUSINESS_DAYS = [3, 7] as const;
export const STALL_AFTER_BUSINESS_DAYS = 10;

export interface ContactContext {
  state: ContactState;
  firstSentAt: Date | null;
  lastOutboundAt: Date | null;
  lastActivityAt: Date | null;
  followUpsDue: number;
  followUpsSent: number;
  nextFollowUpAt: Date | null;
}

export type Effect = { type: 'DRAFT_FOLLOW_UP'; followUpNumber: 1 | 2 } | { type: 'MARK_STALLED' };

export type TransitionResult =
  | { ok: true; context: ContactContext; effects: Effect[] }
  | { ok: false; error: string; from: ContactState; event: ConnectionEvent['type'] };

export const LEGAL_TRANSITIONS: Readonly<Record<ContactState, readonly ConnectionEvent['type'][]>> = {
  drafted: ['APPROVED_SENT', 'DECLINED'],
  sent: ['APPROVED_SENT', 'FOLLOW_UP_DUE', 'REPLY_RECEIVED', 'DECLINED'],
  replied: ['REPLY_RECEIVED', 'TASK_CREATED', 'BOOKED', 'DECLINED'],
  task_open: ['TASK_CREATED', 'TASK_DONE', 'BOOKED', 'DECLINED'],
  records_sent: ['REPLY_RECEIVED', 'TASK_CREATED', 'BOOKED', 'DECLINED'],
  appointment_booked: ['BOOKED', 'DECLINED'],
  connected: [],
  declined: [],
  stalled: ['REPLY_RECEIVED', 'DECLINED'],
};

export function initialContext(): ContactContext {
  return {
    state: 'drafted',
    firstSentAt: null,
    lastOutboundAt: null,
    lastActivityAt: null,
    followUpsDue: 0,
    followUpsSent: 0,
    nextFollowUpAt: null,
  };
}

export function isActive(state: ContactState): boolean {
  return !(
    state === 'declined' ||
    state === 'stalled' ||
    state === 'appointment_booked' ||
    state === 'connected'
  );
}

export function isTerminal(state: ContactState): boolean {
  return state === 'connected' || state === 'declined';
}

export function followUpDeadlines(
  firstSentAt: Date,
  tz?: string,
): { followUp1: Date; followUp2: Date; stall: Date } {
  return {
    followUp1: addBusinessDays(firstSentAt, FOLLOW_UP_BUSINESS_DAYS[0], tz),
    followUp2: addBusinessDays(firstSentAt, FOLLOW_UP_BUSINESS_DAYS[1], tz),
    stall: addBusinessDays(firstSentAt, STALL_AFTER_BUSINESS_DAYS, tz),
  };
}

export function transition(
  ctx: ContactContext,
  event: ConnectionEvent,
  now: Date,
  opts?: { tz?: string },
): TransitionResult {
  const tz = opts?.tz;
  const from = ctx.state;
  const fail = (error: string): TransitionResult => ({ ok: false, error, from, event: event.type });
  const done = (patch: Partial<ContactContext>, effects: Effect[] = []): TransitionResult => ({
    ok: true,
    context: { ...ctx, ...patch, lastActivityAt: new Date(now.getTime()) },
    effects,
  });

  if (!LEGAL_TRANSITIONS[from].includes(event.type)) {
    return fail(`illegal transition: ${event.type} is not allowed in state '${from}'`);
  }

  switch (event.type) {
    case 'APPROVED_SENT': {
      if (from === 'drafted') {
        const first = new Date(now.getTime());
        return done({
          state: 'sent',
          firstSentAt: first,
          lastOutboundAt: new Date(now.getTime()),
          nextFollowUpAt: followUpDeadlines(first, tz).followUp1,
        });
      }
      // sent: an approved follow-up went out
      if (ctx.followUpsSent + 1 > ctx.followUpsDue) {
        return fail('follow-up cannot be sent before it is due');
      }
      return done({
        followUpsSent: ctx.followUpsSent + 1,
        lastOutboundAt: new Date(now.getTime()),
      });
    }
    case 'FOLLOW_UP_DUE': {
      if (!ctx.firstSentAt) return fail('no first send recorded; cannot compute follow-up deadlines');
      if (ctx.nextFollowUpAt && now.getTime() < ctx.nextFollowUpAt.getTime()) {
        return fail(`follow-up not due yet (due ${ctx.nextFollowUpAt.toISOString()})`);
      }
      const d = followUpDeadlines(ctx.firstSentAt, tz);
      if (ctx.followUpsDue === 0) {
        return done(
          { followUpsDue: 1, nextFollowUpAt: d.followUp2 },
          [{ type: 'DRAFT_FOLLOW_UP', followUpNumber: 1 }],
        );
      }
      if (ctx.followUpsDue === 1) {
        return done(
          { followUpsDue: 2, nextFollowUpAt: d.stall },
          [{ type: 'DRAFT_FOLLOW_UP', followUpNumber: 2 }],
        );
      }
      return done({ state: 'stalled', nextFollowUpAt: null }, [{ type: 'MARK_STALLED' }]);
    }
    case 'REPLY_RECEIVED':
      return done({ state: 'replied', nextFollowUpAt: null });
    case 'TASK_CREATED':
      return done({ state: 'task_open' });
    case 'TASK_DONE':
      return done({ state: 'records_sent' });
    case 'DECLINED':
      return done({ state: 'declined', nextFollowUpAt: null });
    case 'BOOKED': {
      const outcome = event.outcome ?? 'appointment_booked';
      if (from === 'appointment_booked' && outcome !== 'connected') {
        return fail("appointment_booked + BOOKED requires outcome 'connected'");
      }
      return done({ state: outcome });
    }
  }
}
