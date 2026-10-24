import { describe, expect, it } from 'vitest';
import { parseTimeScale, scaleDeadline, systemClock } from '../../lib/workflows/clock';

describe('parseTimeScale', () => {
  it('defaults to 1 for undefined, empty, garbage, <1, non-finite', () => {
    for (const raw of [undefined, '', '  ', 'abc', '12abc', '0', '0.5', '-5', 'NaN', 'Infinity']) {
      expect(parseTimeScale(raw)).toBe(1);
    }
  });
  it('parses valid scales', () => {
    expect(parseTimeScale('1')).toBe(1);
    expect(parseTimeScale('1440')).toBe(1440);
    expect(parseTimeScale(' 60 ')).toBe(60);
    expect(parseTimeScale('2.5')).toBe(2.5);
  });
});

describe('scaleDeadline', () => {
  const anchor = new Date('2026-03-02T15:00:00Z');
  const deadline = new Date('2026-03-05T15:00:00Z');
  it('is identity at scale 1', () => {
    expect(scaleDeadline(anchor, deadline, 1).getTime()).toBe(deadline.getTime());
  });
  it('compresses by the scale', () => {
    // 3 days / 1440 = 3 minutes
    expect(scaleDeadline(anchor, deadline, 1440).getTime()).toBe(anchor.getTime() + 3 * 60_000);
  });
  it('treats invalid scale as 1', () => {
    expect(scaleDeadline(anchor, deadline, 0).getTime()).toBe(deadline.getTime());
    expect(scaleDeadline(anchor, deadline, NaN).getTime()).toBe(deadline.getTime());
  });
});

describe('systemClock', () => {
  it('reads scale from env and returns real time', () => {
    const c = systemClock({ WAYFINDER_SIM_TIME_SCALE: '1440' });
    expect(c.scale).toBe(1440);
    expect(Math.abs(c.now().getTime() - Date.now())).toBeLessThan(1000);
  });
  it('defaults to scale 1', () => {
    expect(systemClock({}).scale).toBe(1);
    expect(systemClock({ WAYFINDER_SIM_TIME_SCALE: 'oops' }).scale).toBe(1);
  });
});
