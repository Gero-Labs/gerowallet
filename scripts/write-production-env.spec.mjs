import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PINNED, REQUIRED, SECRETS, VARIABLES, productionEnv } from './write-production-env.mjs';
import { DERIVED } from './derived-env.mjs';

/** The two a release cannot do without; each case adds what it checks. */
const BASE = { VITE_BACKEND_URL: 'https://backend.example', VITE_SYNC_WS_URL: 'wss://sync.example' };

const lines = text => text.trim().split('\n');
const names = text => lines(text).map(line => line.slice(0, line.indexOf('=')));

/** The `env:` block of each "Write production env" step in a workflow file. */
function envBlocks(workflow) {
  // Line by line, not one regex over the file: a nested repetition there backtracks
  // exponentially on whitespace-heavy input (CodeQL js/redos).
  const blocks = [];
  let block = null;
  for (const line of workflow.split(/\r?\n/)) {
    if (line.trim() === '- name: Write production env') block = [];
    else if (block && line.trimStart().startsWith('run: ')) { blocks.push(block.join('\n')); block = null; }
    else if (block) block.push(line);
  }
  return blocks;
}

describe('productionEnv', () => {
  it('writes every listed variable and secret, plus the pinned debug switch, and nothing else', () => {
    const text = productionEnv({ ...BASE, VITE_BACKEND_URL: 'https://backend.example', VITE_MOONPAY_API_KEY: 'pk_test', MANIFEST_KEY: 'not-for-the-env', PATH: '/usr/bin' });
    expect(names(text)).toEqual([...VARIABLES, ...SECRETS, ...DERIVED, ...Object.keys(PINNED)]);
    expect(lines(text)).toContain('VITE_BACKEND_URL=https://backend.example');
    expect(lines(text)).toContain('VITE_MOONPAY_API_KEY=pk_test');
    expect(lines(text)).toContain('VITE_KAISEREX_OAUTH_URL=');
    expect(lines(text)).toContain('VITE_DEBUG_STORES=false');
    expect(text).not.toContain('MANIFEST_KEY');
    expect(text).not.toContain('PATH=');
  });

  it('keeps debug logging off even when a variable asks for it', () => {
    const text = productionEnv({ ...BASE, VITE_DEBUG_STORES: 'true' });
    expect(lines(text).filter(line => line.startsWith('VITE_DEBUG_STORES='))).toEqual(['VITE_DEBUG_STORES=false']);
  });

  it('drops the trailing line break a pasted secret often carries', () => {
    expect(lines(productionEnv({ ...BASE, VITE_MOONPAY_API_KEY: 'pk_live\n', VITE_IS_BETA: 'false\r\n' })))
      .toEqual(expect.arrayContaining(['VITE_MOONPAY_API_KEY=pk_live', 'VITE_IS_BETA=false']));
  });

  it('refuses a line break inside a value, which would add a line of its own', () => {
    expect(() => productionEnv({ ...BASE, VITE_IS_BETA: 'false\nVITE_DEBUG_STORES=true' })).toThrow('VITE_IS_BETA holds a line break');
    expect(() => productionEnv({ ...BASE, VITE_MOONPAY_API_KEY: 'a\rb' })).toThrow('line break');
  });

  it('refuses a release without the backend or Gero Sync URL, which the derived endpoints need', () => {
    expect(REQUIRED).toEqual(['VITE_BACKEND_URL', 'VITE_SYNC_WS_URL']);
    expect(() => productionEnv({})).toThrow('VITE_BACKEND_URL, VITE_SYNC_WS_URL must be set');
    expect(() => productionEnv({ ...BASE, VITE_SYNC_WS_URL: '  ' })).toThrow('VITE_SYNC_WS_URL must be set');
  });

  it('writes the derived endpoints, so an older release rebuilt with this script gets them too', () => {
    // Not asked of the workflow: derived from the backend and Gero Sync URLs.
    expect(VARIABLES).not.toContain('VITE_NEXUS_URL');
    expect(VARIABLES).not.toContain('VITE_FLAGS_BASE_URL');
    const text = lines(productionEnv({ VITE_BACKEND_URL: 'https://api.gerowallet.io', VITE_SYNC_WS_URL: 'wss://sync.gerowallet.io' }));
    expect(text).toContain('VITE_NEXUS_URL=https://api.gerowallet.io/api/nexus');
    expect(text).toContain('VITE_FLAGS_BASE_URL=https://sync.gerowallet.io');
  });

  it('derives only from the release names, never from a stray value in the step env', () => {
    const text = lines(productionEnv({ ...BASE, VITE_NEXUS_URL: 'https://evil.example' }));
    expect(text).toContain('VITE_NEXUS_URL=https://backend.example/api/nexus');
    expect(text.join('\n')).not.toContain('evil');
  });

  it('refuses a Gero Sync URL that is not a WebSocket URL: no flag service could be derived', () => {
    expect(() => productionEnv({ ...BASE, VITE_SYNC_WS_URL: 'https://sync.example' })).toThrow('ws:// or wss://');
  });

  it.each([
    ['ci-cd.yml', 1],
    ['chrome-web-store.yml', 1],
  ])('%s passes exactly these names, one by one, to each production env step', (file, steps) => {
    const workflow = readFileSync(resolve('.github/workflows', file), 'utf8');
    const blocks = envBlocks(workflow);
    expect(blocks).toHaveLength(steps);
    for (const block of blocks) {
      const passed = [...block.matchAll(/^\s+([A-Z0-9_]+): \$\{\{ (vars|secrets)\.([A-Z0-9_]+) \}\}$/gm)];
      expect(passed.map(([, name]) => name).sort()).toEqual([...VARIABLES, ...SECRETS].sort());
      for (const [, name, kind, source] of passed) {
        expect(source).toBe(name);
        expect(kind).toBe(SECRETS.includes(name) ? 'secrets' : 'vars');
      }
    }
    expect(workflow).not.toContain('toJSON(vars)');
    expect(workflow).not.toMatch(/echo "VITE_[A-Z_]+=/);
  });
});
