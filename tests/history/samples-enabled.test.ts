import { describe, expect, it } from 'vitest';
import { historySamplesEnabled } from '@/lib/history/samples-enabled';

describe('historySamplesEnabled', () => {
  it('is on only in the demo control panel or offline mode', () => {
    expect(historySamplesEnabled({ WAYFINDER_DEMO: '1' })).toBe(true);
    expect(historySamplesEnabled({ WAYFINDER_OFFLINE: '1' })).toBe(true);
  });
  it('is off in production, so the page never offers a loader whose endpoint 404s', () => {
    expect(historySamplesEnabled({})).toBe(false);
    expect(historySamplesEnabled({ WAYFINDER_DEMO: 'true', WAYFINDER_OFFLINE: '0' })).toBe(false);
  });
});
