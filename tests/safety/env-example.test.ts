import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { walk } from './fixture-emails';

const ROOT = path.resolve(__dirname, '../..');
const SCAN_DIRS = ['app', 'lib', 'scripts', 'db', 'config', 'components', 'tests'];
const SCAN_FILES = ['drizzle.config.ts', 'next.config.ts'];
/** Provided by the platform or toolchain, not configured by us. */
const PLATFORM_VARS = new Set(['NODE_ENV', 'NEXT_RUNTIME', 'CI', 'TMPDIR']);
// process.env.X, env.X (a local/parsed env object), env["X"] / env['X']
const ENV_READ = /\b(?:process\.)?env(?:\.([A-Z][A-Z0-9_]{2,})|\[\s*["']([A-Z][A-Z0-9_]{2,})["']\s*\])/g;

function sourceFiles(): string[] {
  const files = SCAN_FILES.map(f => path.join(ROOT, f));
  for (const dir of SCAN_DIRS) {
    for (const f of walk(path.join(ROOT, dir))) {
      if (/\.(ts|tsx|mjs)$/.test(f) && f !== __filename) files.push(f);
    }
  }
  return files;
}

function envVarsRead(): Map<string, string> {
  const found = new Map<string, string>();
  for (const file of sourceFiles()) {
    let text: string;
    try { text = readFileSync(file, 'utf8'); } catch { continue; }
    for (const m of text.matchAll(ENV_READ)) {
      const name = m[1] ?? m[2];
      if (!PLATFORM_VARS.has(name) && !found.has(name)) found.set(name, path.relative(ROOT, file));
    }
  }
  return found;
}

function documentedVars(): Set<string> {
  const text = readFileSync(path.join(ROOT, '.env.example'), 'utf8');
  return new Set([...text.matchAll(/^#?\s*([A-Z][A-Z0-9_]+)=/gm)].map(m => m[1]));
}

describe('.env.example (hard rule 8)', () => {
  it('lists every environment variable the code reads', () => {
    const documented = documentedVars();
    const missing = [...envVarsRead()].filter(([name]) => !documented.has(name)).map(([name, file]) => `${name} (read in ${file})`);
    expect(missing).toEqual([]);
  });

  it('detects the read patterns it claims to', () => {
    const names = [...'process.env.FOO_BAR + env.BAZ_QUX + env["ZED_ONE"]'.matchAll(ENV_READ)].map(m => m[1] ?? m[2]);
    expect(names).toEqual(['FOO_BAR', 'BAZ_QUX', 'ZED_ONE']);
  });
});
