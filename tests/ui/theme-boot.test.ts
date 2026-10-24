import { describe, expect, it } from 'vitest';
import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from '@/components/shell/theme-script';

type Attrs = Record<string, string>;

function boot(stored: string | null): Attrs {
  const attrs: Attrs = { 'data-theme': 'light' };
  const documentElement = {
    setAttribute: (k: string, v: string) => { attrs[k] = v; },
    removeAttribute: (k: string) => { delete attrs[k]; },
  };
  const localStorage = { getItem: (k: string) => (k === THEME_STORAGE_KEY ? stored : null) };
  new Function('document', 'localStorage', THEME_BOOT_SCRIPT)({ documentElement }, localStorage);
  return attrs;
}

describe('THEME_BOOT_SCRIPT', () => {
  it('keeps the white theme when nothing is stored, even on a dark-mode device', () => {
    expect(boot(null)['data-theme']).toBe('light');
  });

  it('applies dark only when the viewer picked it', () => {
    expect(boot('dark')['data-theme']).toBe('dark');
  });

  it('follows the device only when the viewer picked "Match device"', () => {
    expect(boot('system')['data-theme']).toBeUndefined();
  });

  it('ignores junk values', () => {
    expect(boot('purple')['data-theme']).toBe('light');
  });
});
