import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { PINNED, SECRETS, VARIABLES, productionEnv } from './write-production-env.mjs';

const lines = text => text.trim().split('\n');
const names = text => lines(text).map(line => line.slice(0, line.indexOf('=')));

describe('productionEnv', () => {
  it('writes every listed variable and secret, plus the pinned debug switch', () => {
    const text = productionEnv(JSON.stringify({ VITE_NEXUS_URL: 'https://nexus.example', MANIFEST_KEY: 'not-for-the-env' }), {
      VITE_MOONPAY_API_KEY: 'pk_test', PATH: '/usr/bin',
    });
    expect(names(text)).toEqual([...VARIABLES, ...SECRETS, ...Object.keys(PINNED)]);
    expect(lines(text)).toContain('VITE_NEXUS_URL=https://nexus.example');
    expect(lines(text)).toContain('VITE_MOONPAY_API_KEY=pk_test');
    expect(lines(text)).toContain('VITE_GUARDARIAN_API_KEY=');
    expect(lines(text)).toContain('VITE_DEBUG_STORES=false');
    expect(text).not.toContain('MANIFEST_KEY');
    expect(text).not.toContain('PATH=');
  });

  it('keeps debug logging off even when a variable asks for it', () => {
    const text = productionEnv(JSON.stringify({ VITE_DEBUG_STORES: 'true' }), {});
    expect(lines(text).filter(line => line.startsWith('VITE_DEBUG_STORES='))).toEqual(['VITE_DEBUG_STORES=false']);
  });

  it('refuses a value that would add a line of its own', () => {
    expect(() => productionEnv(JSON.stringify({ VITE_APP_NAME: 'Gero\nVITE_DEBUG_STORES=true' }), {})).toThrow('VITE_APP_NAME holds a line break');
    expect(() => productionEnv('{}', { VITE_GUARDARIAN_API_KEY: 'a\rb' })).toThrow('line break');
  });

  it('refuses variables that are not a JSON object', () => {
    expect(() => productionEnv('[]', {})).toThrow('JSON object');
  });

  it('is the list both release builds use', () => {
    const ciCd = readFileSync(resolve('.github/workflows/ci-cd.yml'), 'utf8');
    const store = readFileSync(resolve('.github/workflows/chrome-web-store.yml'), 'utf8');
    for (const workflow of [ciCd, store]) {
      expect(workflow).toMatch(/node (\.\.\/\.release-scripts\/)?scripts\/write-production-env\.mjs \.env\.production/);
      expect(workflow).toContain('PRODUCTION_VARS: ${{ toJSON(vars) }}');
      expect(workflow).not.toMatch(/echo "VITE_[A-Z_]+=/);
    }
  });
});
