// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { watch } from 'rollup';
import { localeMessagesPlugin } from './i18n-compiler.mjs';

vi.mock('node:fs/promises', async importOriginal => {
  const original = await importOriginal();
  return { ...original, readFile: vi.fn(original.readFile) };
});

const locales = ['us', 'de', 'es'];
let root;
const catalogPath = locale => resolve(root, 'src/plugins/i18n', `${locale}.ts`);
const virtualId = locale => `\0virtual:gero-locales/${locale}`;
const context = () => ({ addWatchFile: vi.fn() });
const writeCatalog = (locale, title) => writeFile(catalogPath(locale), `export default ${JSON.stringify({ title })};`);
const writePush = title => writeFile(catalogPath('push'), `export const pushStrings = ${JSON.stringify(Object.fromEntries(locales.map(locale => [locale, { pushTitle: `${locale} ${title}` }])))};`);
const reads = () => vi.mocked(readFile).mock.calls.map(([path]) => path);

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'gero-locale-cache-'));
  await mkdir(resolve(root, 'src/plugins/i18n'), { recursive: true });
  await Promise.all(locales.map(locale => writeCatalog(locale, `${locale} original`)));
  await writePush('push original');
  vi.mocked(readFile).mockClear();
});

afterEach(async () => {
  // Only remove this test's freshly allocated temporary catalog directory.
  if (!root.startsWith(resolve(tmpdir(), 'gero-locale-cache-'))) throw new Error('Unexpected fixture directory');
  await rm(root, { recursive: true, force: true });
});

describe('locale compilation cache', () => {
  it('compiles all shipped locales once at build start and reuses them for concurrent loads', async () => {
    const plugin = localeMessagesPlugin(root);
    const build = context();
    await plugin.buildStart.call(build);
    expect(reads().sort()).toEqual([...locales, 'push'].map(catalogPath).sort());
    expect(build.addWatchFile.mock.calls.flat().sort()).toEqual([...locales, 'push'].map(catalogPath).sort());

    const loaded = await Promise.all([...locales, ...locales].map(async locale => {
      const loadContext = context();
      const result = await plugin.load.call(loadContext, virtualId(locale));
      expect(loadContext.addWatchFile.mock.calls.flat()).toEqual([catalogPath(locale), catalogPath('push')]);
      expect(result.code).toContain(`${locale} original`);
      expect(result.code).toContain(`${locale} push original`);
      return result;
    }));
    expect(loaded).toHaveLength(6);
    expect(reads()).toHaveLength(4);
  });

  it('deduplicates concurrent cold loads and compiles only requested locales', async () => {
    const plugin = localeMessagesPlugin(root);
    const loadContext = context();
    const results = await Promise.all(Array.from({ length: 5 }, () => plugin.load.call(loadContext, virtualId('us'))));
    expect(new Set(results.map(result => result.code)).size).toBe(1);
    expect(reads().sort()).toEqual(['us', 'push'].map(catalogPath).sort());
    await plugin.load.call(loadContext, virtualId('de'));
    expect(reads().sort()).toEqual(['us', 'de', 'push'].map(catalogPath).sort());
  });

  it('invalidates catalog and shared push changes while ignoring unrelated files', async () => {
    const plugin = localeMessagesPlugin(root);
    await plugin.buildStart.call(context());
    plugin.watchChange(resolve(root, 'unrelated.ts'));
    await plugin.load.call(context(), virtualId('us'));
    expect(reads()).toHaveLength(4);

    await writeCatalog('us', 'Changed English');
    // Vite normalizes Windows file paths to slashes before invoking hooks.
    plugin.watchChange(catalogPath('us').replace(/\\/g, '/'));
    const updated = await plugin.load.call(context(), virtualId('us'));
    expect(updated.code).toContain('Changed English');
    expect(updated.code).not.toContain('us original');
    expect(reads()).toHaveLength(6);

    await writePush('changed push');
    plugin.watchChange(catalogPath('push'));
    const all = await Promise.all(locales.map(locale => plugin.load.call(context(), virtualId(locale))));
    all.forEach((result, index) => expect(result.code).toContain(`${locales[index]} changed push`));
    expect(reads()).toHaveLength(10);
  });

  it('rejects a broken unimported locale, watches every catalog, and recovers after correction', async () => {
    await writeCatalog('es', 'broken {name');
    const plugin = localeMessagesPlugin(root);
    const build = context();
    await expect(plugin.buildStart.call(build)).rejects.toThrow('es:title');
    expect(build.addWatchFile.mock.calls.flat().sort()).toEqual([...locales, 'push'].map(catalogPath).sort());
    await expect(plugin.load.call(context(), virtualId('es'))).rejects.toThrow('es:title');

    await writeCatalog('es', 'Recovered Spanish');
    plugin.watchChange(catalogPath('es'));
    await expect(plugin.buildStart.call(context())).resolves.toBeUndefined();
    expect((await plugin.load.call(context(), virtualId('es'))).code).toContain('Recovered Spanish');
  });

  it('starts a fresh exhaustive cache on a new build even without a watch event', async () => {
    const plugin = localeMessagesPlugin(root);
    await plugin.buildStart.call(context());
    await writeCatalog('de', 'New build German');
    await plugin.buildStart.call(context());
    expect(reads()).toHaveLength(8);
    expect((await plugin.load.call(context(), virtualId('de'))).code).toContain('New build German');
    expect(reads()).toHaveLength(8);
  });

  it('rejects unsupported virtual locales without reading or compiling catalogs', async () => {
    const plugin = localeMessagesPlugin(root);
    await expect(plugin.load.call(context(), virtualId('fr'))).rejects.toThrow('Unsupported shipped locale: fr');
    expect(await plugin.load.call(context(), 'unrelated-module')).toBeUndefined();
    expect(reads()).toEqual([]);
  });

  it('rebuilds real virtual modules and rejects then recovers an unimported catalog in watch mode', async () => {
    const entry = resolve(root, 'entry.js');
    await writeFile(entry, "export { default } from 'virtual:gero-locales/us';");
    const events = [];
    let waiting;
    const watcher = watch({
      input: entry,
      plugins: [localeMessagesPlugin(root)],
      output: { format: 'es' },
      // Chokidar coalesces same-file changes for 50 ms. Let each rebuild
      // settle before the test's next write, as separate editor saves would.
      watch: { skipWrite: true, buildDelay: 100 },
    });
    watcher.on('event', event => {
      if (event.code !== 'BUNDLE_END' && event.code !== 'ERROR') return;
      if (waiting) {
        const receive = waiting;
        waiting = undefined;
        receive(event);
      } else events.push(event);
    });
    async function nextBuild(step) {
      let timeout;
      const event = events.shift() ?? await new Promise((accept, reject) => {
        waiting = accept;
        timeout = setTimeout(() => reject(new Error(`Catalog watch build timed out: ${step}`)), 10000);
      }).finally(() => clearTimeout(timeout));
      if (event.code === 'ERROR') throw event.error;
      try {
        const result = await event.result.generate({ format: 'es' });
        return result.output[0].code;
      } finally {
        await event.result.close();
      }
    }
    try {
      expect(await nextBuild('initial build')).toContain('us original');
      await writeCatalog('us', 'Watch English changed');
      expect(await nextBuild('locale edit')).toContain('Watch English changed');
      await writePush('watch push changed');
      expect(await nextBuild('push edit')).toContain('us watch push changed');
      await writeCatalog('es', 'broken {message');
      await expect(nextBuild('broken catalog')).rejects.toThrow('es:title');
      await writeCatalog('es', 'Recovered unimported Spanish');
      expect(await nextBuild('recovery')).toContain('Watch English changed');
    } finally {
      await watcher.close();
    }
  });
});
