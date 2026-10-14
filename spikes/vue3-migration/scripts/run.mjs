import { cp, mkdir, readFile, writeFile, rm, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [target, command] = process.argv.slice(2);
if (!['vuetify3', 'vuetify4'].includes(target) || !['install', 'ci', 'build', 'typecheck'].includes(command)) {
  throw new Error('Usage: node scripts/run.mjs <vuetify3|vuetify4> <install|ci|build|typecheck>');
}
if (process.versions.node !== '24.19.0') throw new Error('Use the pinned Node 24.19.0 runtime.');
const targetRoot = join(root, 'targets', target);
if (['install', 'ci'].includes(command)) {
  // npm_execpath is supplied by npm scripts. Direct callers can set NPM_CLI_PATH.
  const npmCli = process.env.NPM_CLI_PATH || process.env.npm_execpath;
  if (!npmCli) throw new Error('Set NPM_CLI_PATH to npm/bin/npm-cli.js, or invoke using npm scripts.');
  const result = spawnSync(process.execPath, [npmCli, command, '--ignore-scripts', '--no-fund'], {
    cwd: targetRoot, stdio: 'inherit', env: process.env,
  });
  process.exit(result.status ?? 1);
}
const requireTarget = createRequire(join(targetRoot, 'package.json'));
const load = async (name) => import(pathToFileURL(requireTarget.resolve(name)).href);
const { build } = await load('vite');
const { default: vue } = await load('@vitejs/plugin-vue');
const { baseCompile } = await load('@intlify/message-compiler');
const stage = join(targetRoot, '.stage');
const realTarget = await realpath(targetRoot);
if (resolve(stage) !== join(realTarget, '.stage')) throw new Error('Refusing to clear a stage outside the selected target.');
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
await cp(join(root, 'src'), join(stage, 'src'), { recursive: true, force: true });
await cp(join(root, 'public'), join(stage, 'public'), { recursive: true, force: true });
await cp(join(root, 'tsconfig.json'), join(stage, 'tsconfig.json'), { force: true });
if (command === 'typecheck') {
  const compiler = requireTarget.resolve('vue-tsc/bin/vue-tsc.js');
  const result = spawnSync(process.execPath, [compiler, '--noEmit', '--project', join(stage, 'tsconfig.json')], { cwd: targetRoot, stdio: 'inherit' });
  process.exit(result.status ?? 1);
}
const compiledLocales = new Map();
const localeCoverage = {};
for (const locale of ['us', 'de', 'es']) {
  const messages = JSON.parse(await readFile(join(stage, 'src/locales', `${locale}.json`), 'utf8'));
  let count = 0;
  function compile(value, key) {
    if (typeof value === 'string') {
      count += 1;
      return baseCompile(value, { mode: 'arrow', onError: (error) => { throw new Error(`${locale}:${key}: ${error.message}`); } }).code;
    }
    return `{${Object.entries(value).map(([name, message]) => `${JSON.stringify(name)}:${compile(message, `${key}.${name}`)}`).join(',')}}`;
  }
  const generated = join(stage, 'src/locales', `${locale}.generated.js`);
  await writeFile(generated, `// Generated at build time using the pinned production message compiler.\nexport default ${compile(messages, locale)};\n`);
  compiledLocales.set(`./locales/${locale}.json`, generated);
  localeCoverage[locale] = count;
}
for (const app of ['options', 'sidepanel']) {
  const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Gero migration pilot: ${app}</title></head><body><div id="app"></div><script type="module" src="/src/${app}.ts"></script></body></html>`;
  await writeFile(join(stage, `${app}.html`), html);
}
await build({
  configFile: false,
  root: stage,
  base: './',
  plugins: [
    vue({ template: { compilerOptions: { isCustomElement: (tag) => tag === 'gero-swap' } } }),
    { name: 'pilot-precompiled-locales', enforce: 'pre', resolveId: (source) => compiledLocales.get(source) },
  ],
  resolve: { alias: { 'vue-i18n': requireTarget.resolve('vue-i18n/dist/vue-i18n.runtime.esm-bundler.js') } },
  define: { __PILOT_TARGET__: JSON.stringify(target), __VUE_PROD_DEVTOOLS__: false, __VUE_PROD_HYDRATION_MISMATCH_DETAILS__: false, __VUE_I18N_FULL_INSTALL__: false, __VUE_I18N_LEGACY_API__: false, __INTLIFY_DROP_MESSAGE_COMPILER__: true },
  build: {
    target: 'chrome120', outDir: join(targetRoot, 'dist'), emptyOutDir: true,
    rollupOptions: { input: { options: join(stage, 'options.html'), sidepanel: join(stage, 'sidepanel.html') } },
  },
});
await writeFile(join(targetRoot, 'dist/locale-coverage.json'), JSON.stringify({ compiler: '11.4.14', messages: localeCoverage }, null, 2) + '\n');
const manifest = JSON.parse(await readFile(join(targetRoot, 'dist/manifest.json'), 'utf8'));
if (!manifest.content_security_policy.extension_pages.split('; ').includes("script-src 'self' 'wasm-unsafe-eval'")) {
  throw new Error('Production extension CSP changed.');
}
