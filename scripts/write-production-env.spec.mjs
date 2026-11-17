import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PINNED, SECRETS, VARIABLES, productionEnv } from './write-production-env.mjs';

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
    const text = productionEnv({ VITE_BACKEND_URL: 'https://backend.example', VITE_MOONPAY_API_KEY: 'pk_test', MANIFEST_KEY: 'not-for-the-env', PATH: '/usr/bin' });
    expect(names(text)).toEqual([...VARIABLES, ...SECRETS, ...Object.keys(PINNED)]);
    expect(lines(text)).toContain('VITE_BACKEND_URL=https://backend.example');
    expect(lines(text)).toContain('VITE_MOONPAY_API_KEY=pk_test');
    expect(lines(text)).toContain('VITE_KAISEREX_OAUTH_URL=');
    expect(lines(text)).toContain('VITE_DEBUG_STORES=false');
    expect(text).not.toContain('MANIFEST_KEY');
    expect(text).not.toContain('PATH=');
  });

  it('keeps debug logging off even when a variable asks for it', () => {
    const text = productionEnv({ VITE_DEBUG_STORES: 'true' });
    expect(lines(text).filter(line => line.startsWith('VITE_DEBUG_STORES='))).toEqual(['VITE_DEBUG_STORES=false']);
  });

  it('drops the trailing line break a pasted secret often carries', () => {
    expect(lines(productionEnv({ VITE_MOONPAY_API_KEY: 'pk_live\n', VITE_IS_BETA: 'false\r\n' })))
      .toEqual(expect.arrayContaining(['VITE_MOONPAY_API_KEY=pk_live', 'VITE_IS_BETA=false']));
  });

  it('refuses a line break inside a value, which would add a line of its own', () => {
    expect(() => productionEnv({ VITE_IS_BETA: 'false\nVITE_DEBUG_STORES=true' })).toThrow('VITE_IS_BETA holds a line break');
    expect(() => productionEnv({ VITE_MOONPAY_API_KEY: 'a\rb' })).toThrow('line break');
  });

  it('leaves the derived endpoints to the build (scripts/env-defaults.mjs)', () => {
    expect(VARIABLES).not.toContain('VITE_NEXUS_URL');
    expect(VARIABLES).not.toContain('VITE_FLAGS_BASE_URL');
    expect(VARIABLES).toEqual(expect.arrayContaining(['VITE_BACKEND_URL', 'VITE_SYNC_WS_URL']));
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
