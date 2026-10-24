import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const app = join(process.cwd(), 'app');

describe('app icons', () => {
  it('ships an SVG icon so pages get <link rel="icon">', () => {
    const svg = readFileSync(join(app, 'icon.svg'), 'utf8');
    expect(svg).toMatch(/^<svg[^>]+viewBox="0 0 28 28"/);
  });

  it('ships /favicon.ico so the browser default request is not a 404', () => {
    const ico = readFileSync(join(app, 'favicon.ico'));
    // ICONDIR header: reserved 0, type 1 (icon), at least one image.
    expect(ico.readUInt16LE(0)).toBe(0);
    expect(ico.readUInt16LE(2)).toBe(1);
    expect(ico.readUInt16LE(4)).toBeGreaterThan(0);
  });

  it('has no public/favicon.ico that would conflict with the app route', () => {
    expect(existsSync(join(process.cwd(), 'public', 'favicon.ico'))).toBe(false);
  });
});
