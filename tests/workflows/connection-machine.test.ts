import { describe, expect, it } from 'vitest';
import {
  FOLLOW_UP_BUSINESS_DAYS,
  LEGAL_TRANSITIONS,
  STALL_AFTER_BUSINESS_DAYS,
  followUpDeadlines,
  initialContext,
  isActive,
  isTerminal,
  transition,
  type ConnectionEvent,
  type ContactContext,
  type ContactState,
} from '../../lib/workflows/connection-machine';
import { addBusinessDays } from '../../lib/workflows/business-days';

const STATES: ContactState[] = [
  'drafted', 'sent', 'replied', 'task_open', 'records_sent',
  'appointment_booked', 'connected', 'declined', 'stalled',
];
const EVENT_TYPES: ConnectionEvent['type'][] = [
  'APPROVED_SENT', 'REPLY_RECEIVED', 'TASK_CREATED', 'TASK_DONE', 'FOLLOW_UP_DUE', 'DECLINED', 'BOOKED',
];

// Mon 2026-11-02 10:00 EST
const T0 = new Date('2026-11-02T15:00:00Z');
const later = (days: number) => new Date(T0.getTime() + days * 86_400_000);

function ctx(state: ContactState, over: Partial<ContactContext> = {}): ContactContext {
  const base = { ...initialContext(), state };
  if (state !== 'drafted') {
    const d = followUpDeadlines(T0);
    Object.assign(base, {
      firstSentAt: T0,
      lastOutboundAt: T0,
      lastActivityAt: T0,
      nextFollowUpAt: state === 'sent' ? d.followUp1 : null,
    });
  }
  return { ...base, ...over };
}
function eventOf(type: ConnectionEvent['type']): ConnectionEvent {
  return type === 'BOOKED' ? { type: 'BOOKED' } : ({ type } as ConnectionEvent);
}
function ok(r: ReturnType<typeof transition>) {
  if (!r.ok) throw new Error(`expected ok, got: ${r.error}`);
  return r;
}

describe('constants and helpers', () => {
  it('constants', () => {
    expect([...FOLLOW_UP_BUSINESS_DAYS]).toEqual([3, 7]);
    expect(STALL_AFTER_BUSINESS_DAYS).toBe(10);
  });
  it('initialContext', () => {
    expect(initialContext()).toEqual({
      state: 'drafted', firstSentAt: null, lastOutboundAt: null, lastActivityAt: null,
      followUpsDue: 0, followUpsSent: 0, nextFollowUpAt: null,
    });
  });
  it('followUpDeadlines uses addBusinessDays', () => {
    const d = followUpDeadlines(T0);
    expect(d.followUp1.getTime()).toBe(addBusinessDays(T0, 3).getTime());
    expect(d.followUp2.getTime()).toBe(addBusinessDays(T0, 7).getTime());
    expect(d.stall.getTime()).toBe(addBusinessDays(T0, 10).getTime());
    expect(d.followUp1.toISOString()).toBe('2026-11-05T15:00:00.000Z');
  });
  it('isActive / isTerminal for all 9 states', () => {
    const active: Record<ContactState, boolean> = {
      drafted: true, sent: true, replied: true, task_open: true, records_sent: true,
      appointment_booked: false, connected: false, declined: false, stalled: false,
    };
    const terminal: Record<ContactState, boolean> = {
      drafted: false, sent: false, replied: false, task_open: false, records_sent: false,
      appointment_booked: false, connected: true, declined: true, stalled: false,
    };
    for (const s of STATES) {
      expect(isActive(s), `isActive ${s}`).toBe(active[s]);
      expect(isTerminal(s), `isTerminal ${s}`).toBe(terminal[s]);
    }
  });
});

describe('legal transitions', () => {
  it('drafted + APPROVED_SENT -> sent', () => {
    const r = ok(transition(initialContext(), { type: 'APPROVED_SENT' }, T0));
    expect(r.context.state).toBe('sent');
    expect(r.context.firstSentAt).toEqual(T0);
    expect(r.context.lastOutboundAt).toEqual(T0);
    expect(r.context.lastActivityAt).toEqual(T0);
    expect(r.context.nextFollowUpAt).toEqual(followUpDeadlines(T0).followUp1);
    expect(r.effects).toEqual([]);
  });
  it('sent + FOLLOW_UP_DUE (first) -> sent with DRAFT_FOLLOW_UP 1', () => {
    const c = ctx('sent');
    const now = followUpDeadlines(T0).followUp1;
    const r = ok(transition(c, { type: 'FOLLOW_UP_DUE' }, now));
    expect(r.context.state).toBe('sent');
    expect(r.context.followUpsDue).toBe(1);
    expect(r.context.nextFollowUpAt).toEqual(followUpDeadlines(T0).followUp2);
    expect(r.context.lastActivityAt).toEqual(now);
    expect(r.effects).toEqual([{ type: 'DRAFT_FOLLOW_UP', followUpNumber: 1 }]);
  });
  it('sent + FOLLOW_UP_DUE (second) -> DRAFT_FOLLOW_UP 2, next = stall', () => {
    const d = followUpDeadlines(T0);
    const c = ctx('sent', { followUpsDue: 1, followUpsSent: 1, nextFollowUpAt: d.followUp2 });
    const r = ok(transition(c, { type: 'FOLLOW_UP_DUE' }, d.followUp2));
    expect(r.context.followUpsDue).toBe(2);
    expect(r.context.nextFollowUpAt).toEqual(d.stall);
    expect(r.effects).toEqual([{ type: 'DRAFT_FOLLOW_UP', followUpNumber: 2 }]);
  });
  it('sent + FOLLOW_UP_DUE (third) -> stalled', () => {
    const d = followUpDeadlines(T0);
    const c = ctx('sent', { followUpsDue: 2, followUpsSent: 2, nextFollowUpAt: d.stall });
    const r = ok(transition(c, { type: 'FOLLOW_UP_DUE' }, d.stall));
    expect(r.context.state).toBe('stalled');
    expect(r.context.nextFollowUpAt).toBeNull();
    expect(r.effects).toEqual([{ type: 'MARK_STALLED' }]);
  });
  it('sent + APPROVED_SENT (follow-up) increments followUpsSent, deadlines fixed', () => {
    const d = followUpDeadlines(T0);
    const c = ctx('sent', { followUpsDue: 1, nextFollowUpAt: d.followUp2 });
    const now = later(4);
    const r = ok(transition(c, { type: 'APPROVED_SENT' }, now));
    expect(r.context.state).toBe('sent');
    expect(r.context.followUpsSent).toBe(1);
    expect(r.context.lastOutboundAt).toEqual(now);
    expect(r.context.lastActivityAt).toEqual(now);
    expect(r.context.firstSentAt).toEqual(T0);
    expect(r.context.nextFollowUpAt).toEqual(d.followUp2);
  });
  it.each(['sent', 'stalled', 'replied', 'records_sent'] as const)('%s + REPLY_RECEIVED -> replied', (s) => {
    const r = ok(transition(ctx(s), { type: 'REPLY_RECEIVED' }, later(1)));
    expect(r.context.state).toBe('replied');
    expect(r.context.nextFollowUpAt).toBeNull();
    expect(r.context.lastActivityAt).toEqual(later(1));
  });
  it.each(['replied', 'task_open', 'records_sent'] as const)('%s + TASK_CREATED -> task_open', (s) => {
    expect(ok(transition(ctx(s), { type: 'TASK_CREATED' }, later(1))).context.state).toBe('task_open');
  });
  it('task_open + TASK_DONE -> records_sent', () => {
    expect(ok(transition(ctx('task_open'), { type: 'TASK_DONE' }, later(1))).context.state).toBe('records_sent');
  });
  it.each(['replied', 'task_open', 'records_sent'] as const)('%s + BOOKED', (s) => {
    expect(ok(transition(ctx(s), { type: 'BOOKED' }, later(1))).context.state).toBe('appointment_booked');
    expect(ok(transition(ctx(s), { type: 'BOOKED', outcome: 'connected' }, later(1))).context.state).toBe('connected');
    expect(ok(transition(ctx(s), { type: 'BOOKED', outcome: 'appointment_booked' }, later(1))).context.state).toBe('appointment_booked');
  });
  it('appointment_booked + BOOKED connected -> connected; default is illegal', () => {
    expect(ok(transition(ctx('appointment_booked'), { type: 'BOOKED', outcome: 'connected' }, later(1))).context.state).toBe('connected');
    expect(transition(ctx('appointment_booked'), { type: 'BOOKED' }, later(1)).ok).toBe(false);
  });
  it.each(['drafted', 'sent', 'replied', 'task_open', 'records_sent', 'appointment_booked', 'stalled'] as const)(
    '%s + DECLINED -> declined', (s) => {
      const r = ok(transition(ctx(s), { type: 'DECLINED' }, later(1)));
      expect(r.context.state).toBe('declined');
      expect(r.context.nextFollowUpAt).toBeNull();
      expect(r.context.lastActivityAt).toEqual(later(1));
    });
});

describe('illegal transitions', () => {
  it('every (state, event) pair not in LEGAL_TRANSITIONS is rejected', () => {
    let checked = 0;
    for (const s of STATES) {
      for (const e of EVENT_TYPES) {
        if (LEGAL_TRANSITIONS[s].includes(e)) continue;
        const r = transition(ctx(s), eventOf(e), later(30));
        expect(r.ok, `${s} + ${e} should be rejected`).toBe(false);
        if (!r.ok) {
          expect(r.from).toBe(s);
          expect(r.event).toBe(e);
          expect(r.error.length).toBeGreaterThan(0);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(20);
  });
  it('LEGAL_TRANSITIONS lists terminal states with no outgoing events except documented', () => {
    expect(LEGAL_TRANSITIONS.declined).toEqual([]);
    expect(LEGAL_TRANSITIONS.connected).toEqual([]);
  });
  it('FOLLOW_UP_DUE before the deadline is rejected', () => {
    const d = followUpDeadlines(T0);
    const r = transition(ctx('sent'), { type: 'FOLLOW_UP_DUE' }, new Date(d.followUp1.getTime() - 1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not due yet/);
  });
  it('follow-up sent before due is rejected', () => {
    // initial send done, no follow-up due yet -> another APPROVED_SENT is illegal
    const r = transition(ctx('sent'), { type: 'APPROVED_SENT' }, later(1));
    expect(r.ok).toBe(false);
    // after 1 due and 1 sent, a second send is illegal
    const r2 = transition(ctx('sent', { followUpsDue: 1, followUpsSent: 1 }), { type: 'APPROVED_SENT' }, later(5));
    expect(r2.ok).toBe(false);
  });
});

describe('immutability', () => {
  it('never mutates the input context', () => {
    for (const s of STATES) {
      for (const e of EVENT_TYPES) {
        const c = ctx(s);
        const snapshot = JSON.stringify(c);
        const dates = [c.firstSentAt, c.lastOutboundAt, c.lastActivityAt, c.nextFollowUpAt].map((x) => x?.getTime());
        transition(c, eventOf(e), later(30));
        transition(c, { type: 'BOOKED', outcome: 'connected' }, later(30));
        expect(JSON.stringify(c)).toBe(snapshot);
        expect([c.firstSentAt, c.lastOutboundAt, c.lastActivityAt, c.nextFollowUpAt].map((x) => x?.getTime())).toEqual(dates);
      }
    }
  });
});

describe('full no-reply path with a fake clock', () => {
  it('drafted -> sent -> day 3 -> day 7 -> stalled at day 10', () => {
    const d = followUpDeadlines(T0);
    let c = initialContext();

    c = ok(transition(c, { type: 'APPROVED_SENT' }, T0)).context;
    expect(c.state).toBe('sent');
    expect(c.nextFollowUpAt).toEqual(d.followUp1);

    // day 3 deadline
    let r = ok(transition(c, { type: 'FOLLOW_UP_DUE' }, d.followUp1));
    expect(r.effects).toEqual([{ type: 'DRAFT_FOLLOW_UP', followUpNumber: 1 }]);
    c = r.context;
    // approved follow-up goes out a bit later
    c = ok(transition(c, { type: 'APPROVED_SENT' }, new Date(d.followUp1.getTime() + 3_600_000))).context;
    expect(c.followUpsSent).toBe(1);
    expect(c.nextFollowUpAt).toEqual(d.followUp2);

    // day 7 deadline
    r = ok(transition(c, { type: 'FOLLOW_UP_DUE' }, d.followUp2));
    expect(r.effects).toEqual([{ type: 'DRAFT_FOLLOW_UP', followUpNumber: 2 }]);
    c = r.context;
    c = ok(transition(c, { type: 'APPROVED_SENT' }, new Date(d.followUp2.getTime() + 3_600_000))).context;
    expect(c.followUpsSent).toBe(2);
    expect(c.nextFollowUpAt).toEqual(d.stall);

    // too early to stall
    expect(transition(c, { type: 'FOLLOW_UP_DUE' }, new Date(d.stall.getTime() - 1)).ok).toBe(false);

    // day 10 stall
    r = ok(transition(c, { type: 'FOLLOW_UP_DUE' }, d.stall));
    expect(r.effects).toEqual([{ type: 'MARK_STALLED' }]);
    expect(r.context.state).toBe('stalled');
    expect(isActive(r.context.state)).toBe(false);
    expect(r.context.firstSentAt).toEqual(T0);

    // a late reply revives it
    const revived = ok(transition(r.context, { type: 'REPLY_RECEIVED' }, later(20)));
    expect(revived.context.state).toBe('replied');
  });
});
