import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import Vue from '@vitejs/plugin-vue';
import { parse } from '@vue/compiler-sfc';
import { localeMessagesPlugin } from '../../scripts/i18n-compiler.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixtureStyles = 'virtual:gero-visual-styles';

// Read the real entrypoint on every run: copied CSS/defaults would miss the
// cascade regressions this fixture is intended to catch. Style-only SFC queries
// exercise app-wide CSS without executing wallet startup, stores, or services.
function productionStyles(): Plugin {
  return {
    name: 'gero-visual-production-styles',
    resolveId(id) { if (id === fixtureStyles) return `\0${id}`; },
    load(id) {
      if (id !== `\0${fixtureStyles}`) return;
      const entry = resolve(root, 'src/options/main.ts');
      this.addWatchFile(entry);
      const imports = [...readFileSync(entry, 'utf8').matchAll(/^import ['"]([^'"]+)['"];?/gm)]
        .map(match => match[1])
        .filter(specifier => specifier.endsWith('.css') || specifier.startsWith('@fontsource') || specifier === 'vuetify/styles')
        .map(specifier => specifier.startsWith('.') ? `/src/options/${specifier}` : specifier);
      for (const component of ['src/options/App.vue', 'src/modules/dashboard/dialogs/SettingsDialog.vue']) {
        const filename = resolve(root, component);
        this.addWatchFile(filename);
        const { descriptor } = parse(readFileSync(filename, 'utf8'));
        descriptor.styles.forEach((style, index) => {
          if (!style.scoped) imports.push(`/${component}?vue&type=style&index=${index}&lang.${style.lang || 'css'}`);
        });
      }
      return imports.map(specifier => `import ${JSON.stringify(specifier)};`).join('\n');
    },
    transformIndexHtml(html) {
      const source = readFileSync(resolve(root, 'src/options/index.html'), 'utf8');
      const head = source.match(/<head>([\s\S]*?)<\/head>/i)?.[1] || '';
      const headStyles = [...head.matchAll(/<style[^>]*>[\s\S]*?<\/style>|<link\b[^>]*>/gi)]
        .map(match => match[0])
        .filter(tag => tag.startsWith('<style') || /rel=["']stylesheet["']/.test(tag))
        .map(tag => tag.replace(/href=(["'])([^"']+)\1/, (_, quote, href) => {
          const sourcePath = href.startsWith('.') ? `/src/options/${href}` : href.replace(/^\/vendor\//, '/src/vendor/');
          return `href=${quote}${sourcePath}${quote}`;
        })).join('\n');
      const tailStyles = source.slice(source.indexOf('</body>')).match(/<style[^>]*>[\s\S]*?<\/style>/gi)?.join('\n') || '';
      return html.replace('<head>', `<head>\n${headStyles}`).replace('</body>', `</body>\n${tailStyles}`);
    },
  };
}

export default defineConfig({
  root,
  envDir: resolve(root, 'test/visual-parity'),
  cacheDir: 'node_modules/.vite-visual-parity',
  plugins: [productionStyles(), Vue(), localeMessagesPlugin()],
  define: { __VUE_OPTIONS_API__: true, __VUE_PROD_DEVTOOLS__: false, __VUE_I18N_FULL_INSTALL__: true, __VUE_I18N_LEGACY_API__: false, __INTLIFY_DROP_MESSAGE_COMPILER__: true },
  // Do not scan style-only App.vue queries as application entrypoints: that
  // would unnecessarily prebundle the wallet's complete business dependency tree.
  optimizeDeps: { noDiscovery: true, include: ['vue', 'vue-i18n', 'vuetify', 'vuetify/components', 'vuetify/directives', 'vuetify/iconsets/mdi', 'vuetify/locale'] },
  css: { preprocessorOptions: { scss: { additionalData: `@import "${resolve(root, 'src/shared/styles/_tokens.scss').replace(/\\/g, '/')}";\n`, quietDeps: true, silenceDeprecations: ['import'] } } },
  resolve: { alias: [
    { find: /^vue$/, replacement: 'vue/dist/vue.runtime.esm-bundler.js' },
    { find: /^vue-i18n$/, replacement: 'vue-i18n/dist/vue-i18n.runtime.esm-bundler.js' },
    { find: '@', replacement: resolve(root, 'src') },
  ] },
  server: { host: '127.0.0.1', port: 0, watch: null, hmr: false },
});
