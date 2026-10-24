import { describe, expect, it } from 'vitest';
import { footerColumns } from '@/components/shell/SiteFooter';

const hrefs = (env: Record<string, string | undefined>) => footerColumns(env).flatMap(c => c.links.map(l => l.href));

describe('footerColumns', () => {
  it('hides "See a demo" when the demo panel is off (it would be a 404)', () => {
    expect(hrefs({})).not.toContain('/demo');
    expect(hrefs({})).toContain('/start');
  });
  it('shows "See a demo" when the demo panel is on', () => {
    expect(hrefs({ WAYFINDER_DEMO: '1' })).toContain('/demo');
  });
});
