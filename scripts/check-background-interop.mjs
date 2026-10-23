/**
 * Guard: a CommonJS dependency in the background bundle that requires `assert`
 * gets a callable assert.
 *
 * The background build replaces `assert` with a small ESM stub
 * (vite.config.background.mts, `\0virtual:assert-stub`). A CommonJS dependency
 * reaches it through `require('assert')`, and Rollup's CommonJS interop decides
 * what that returns. After the Vite 7 migration it returned the stub's module
 * namespace (the stub has named exports too), which `@subsquid/scale-codec`
 * wraps once more with TypeScript's `__importDefault`. Every `assert(...)` in
 * the codec then threw "(0 , r.default) is not a function". The Midnight
 * address codecs encode through it, so the worker could derive no Midnight key:
 * no Midnight send, dApp signature, private sync or fee payment worked.
 *
 * Nothing caught that. Unit tests import Node's own `assert`, and CI builds the
 * bundle without running it. So this builds a tiny entry with the background
 * config itself (its plugins and CommonJS options; only the TDZ guard is left
 * out, since it analyses the real entry) and runs the output: the codec must
 * encode, and its own assertion must still throw.
 */
import vm from 'node:vm';
import { realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, loadConfigFromFile } from 'vite';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'virtual:background-interop-check';
const RESOLVED_ENTRY = `\0${ENTRY}`;
const RESULT = '__backgroundInteropCheck';

/** The entry: one SCALE compact encode through the codec, and one it must refuse. */
const ENTRY_CODE = `
import { ByteSink } from '@subsquid/scale-codec';
const sink = new ByteSink();
sink.compact(1);
let refused = '';
try { new ByteSink().compact(-1); } catch (error) { refused = String(error && error.message); }
globalThis.${RESULT} = { encoded: Array.from(sink.toBytes()), refused };
`;

const entryPlugin = {
  name: 'background-interop-check-entry',
  enforce: 'pre',
  resolveId: (id) => (id === ENTRY ? RESOLVED_ENTRY : null),
  load: (id) => (id === RESOLVED_ENTRY ? ENTRY_CODE : null),
};

/** Builds the entry with the background config and runs it. */
export async function runBackgroundInteropCheck() {
  const loaded = await loadConfigFromFile({ command: 'build', mode: 'production' }, resolve(ROOT, 'vite.config.background.mts'), ROOT, 'silent');
  if (!loaded) throw new Error('Could not load vite.config.background.mts');
  const { config } = loaded;
  const plugins = [entryPlugin, ...[config.plugins ?? []].flat(Infinity).filter((plugin) => plugin && plugin.name !== 'gero-bundle-tdz-guard')];
  const output = await build({
    ...config,
    configFile: false,
    logLevel: 'silent',
    plugins,
    build: {
      ...config.build,
      write: false,
      watch: null,
      minify: false,
      rollupOptions: { ...config.build?.rollupOptions, input: ENTRY },
    },
  });
  const chunk = [output].flat().flatMap((result) => result.output).find((file) => file.type === 'chunk' && file.isEntry);
  if (!chunk) throw new Error('The check build produced no entry chunk');
  const sandbox = { console, TextEncoder, TextDecoder };
  sandbox.self = sandbox;
  vm.runInNewContext(chunk.code, sandbox, { filename: 'background-interop-check.js' });
  return sandbox[RESULT];
}

/** What is wrong with a check result, or '' when the codec behaved. */
export function describeInteropFailure(result) {
  if (!result) return 'the check entry never ran';
  if (JSON.stringify(result.encoded) !== JSON.stringify([4])) return `compact(1) encoded ${JSON.stringify(result.encoded)}, expected [4]`;
  if (result.refused !== 'invalid compact') return `compact(-1) was not refused by the codec's assert (got: ${result.refused || 'no error'})`;
  return '';
}

const isMain = (() => {
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
})();

if (isMain) {
  let failure;
  try {
    failure = describeInteropFailure(await runBackgroundInteropCheck());
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  if (failure) {
    console.error(`check-background-interop: FAILED — ${failure}`);
    process.exit(1);
  }
  console.log('check-background-interop: OK — require(\'assert\') is callable in the background bundle');
}
