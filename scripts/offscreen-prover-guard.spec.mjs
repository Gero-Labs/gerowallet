// @vitest-environment node
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { build } from 'vite';
import { describe, expect, it } from 'vitest';
import { OFFSCREEN_PROVER_PAGE, offscreenProverImports, offscreenProverStandsAlone } from './offscreen-prover-guard.mjs';

const APP_PAGE = 'src/options/index.html';
const MODULE_SCRIPT = '<script type="module" src="./main.js"></script>';

/**
 * Runs a real Vite build with only the guard installed: the app page and, unless
 * `withProver` is false, the prover page, each with its own `main.js`.
 */
async function buildPages({ proverJs = 'document.title = "prover";\n', appJs = 'document.title = "app";\n', withProver = true, polyfill } = {}) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), 'offscreen-prover-guard-')));
  const pages = { [APP_PAGE]: appJs, ...(withProver ? { [OFFSCREEN_PROVER_PAGE]: proverJs } : {}) };
  for (const [page, js] of Object.entries(pages)) {
    mkdirSync(join(root, dirname(page)), { recursive: true });
    writeFileSync(join(root, page), MODULE_SCRIPT);
    writeFileSync(join(root, dirname(page), 'main.js'), js);
  }
  writeFileSync(join(root, 'src/shared.js'), 'export const shared = "shared";\n');
  try {
    return await build({
      root,
      configFile: false,
      logLevel: 'silent',
      plugins: [offscreenProverStandsAlone],
      build: {
        write: false,
        ...(polyfill === undefined ? {} : { modulePreload: { polyfill } }),
        rollupOptions: { input: Object.keys(pages).map((page) => join(root, page)) },
      },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const USES_SHARED = 'import { shared } from "../shared.js";\ndocument.title = shared;\n';

describe('offscreenProverStandsAlone plugin', () => {
  // The regression itself: with Vite's default, the polyfill is a module both
  // pages import, so the prover page's entry imports a shared chunk.
  it('fails the build while the modulepreload polyfill is on', async () => {
    await expect(buildPages()).rejects.toThrow(/offscreen prover page \(src\/offscreen\/midnight-prover\.html\) imports .*modulepreload-polyfill/);
  });

  it('passes with the polyfill off, as vite.config.mts builds it', async () => {
    await expect(buildPages({ polyfill: false })).resolves.toBeDefined();
  });

  it('fails the build when the prover page shares any module with the app', async () => {
    await expect(buildPages({ polyfill: false, proverJs: USES_SHARED, appJs: USES_SHARED }))
      .rejects.toThrow(/It must import no other chunk/);
  });

  it('ignores a build without the prover page', async () => {
    await expect(buildPages({ withProver: false })).resolves.toBeDefined();
  });
});

describe('offscreenProverImports', () => {
  const chunk = (facadeModuleId, imports, isEntry = true) => ({ type: 'chunk', isEntry, facadeModuleId, imports });

  it('finds the page by its path on Windows and POSIX', () => {
    expect(offscreenProverImports({ a: chunk('D:\\repo\\src\\offscreen\\midnight-prover.html', ['js/walletStore.js']) }))
      .toEqual(['js/walletStore.js']);
    expect(offscreenProverImports({ a: chunk('/repo/src/offscreen/midnight-prover.html', []) })).toEqual([]);
  });

  it('returns undefined when no entry is the prover page', () => {
    expect(offscreenProverImports({
      a: chunk('/repo/src/options/index.html', ['js/walletStore.js']),
      b: chunk('/repo/src/offscreen/midnight-prover.html', ['js/x.js'], false),
      c: { type: 'asset', fileName: 'offscreen/midnight-prover.html', source: '' },
    })).toBeUndefined();
  });
});
