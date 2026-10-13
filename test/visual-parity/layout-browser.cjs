// Native layout geometry proof. Runs in a fresh loopback browser with synthetic
// content; derives the shell, drawer props/state, and scoped CSS from app source.
// Run: node test/visual-parity/layout-browser.cjs
// Optional LAYOUT_BEFORE_DIRECTORY contains before-ContentLayout.vue,
// before-NavigationDrawer.vue, before-vuetify.ts for comparison evidence.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { parse: parseSfc } = require('@vue/compiler-sfc');
const { parse: parseTemplate } = require('@vue/compiler-dom');
const ts = require('typescript');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

const root = path.resolve(__dirname, '../..');
const output = process.env.LAYOUT_PARITY_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'gero-layout-parity-'));
const files = {
  content: 'src/modules/navigation/layouts/ContentLayout.vue',
  nav: 'src/modules/navigation/components/NavigationDrawer.vue',
  plugin: 'src/plugins/vuetify.ts',
};
const report = { passed: false, checks: 0, scope: 'Native layout skeleton and drawer model read from source; synthetic route content and navigation links. Production styles, plugin, fonts, and original scoped component CSS.', variants: {} };
const check = (actual, expected, label) => { assert.deepEqual(actual, expected, label); report.checks++; };
const near = (actual, expected, label) => { assert.ok(Math.abs(actual - expected) <= 1, `${label}: ${actual} != ${expected}`); report.checks++; };
const attr = (node, name) => node.props?.some(prop => prop.type === 6 && prop.name === name);
const contains = (node, predicate) => predicate(node) || (node.children || []).some(child => contains(child, predicate));
const find = (node, predicate) => predicate(node) ? node : (node.children || []).map(child => find(child, predicate)).find(Boolean);
const openTag = node => node.loc.source.match(/^<[\s\S]*?>/)[0];
const styles = descriptor => descriptor.styles.map(style => `<style${style.scoped ? ' scoped' : ''}${style.lang ? ` lang="${style.lang}"` : ''}>${style.content}</style>`).join('\n');

function contentFixture(source) {
  const { descriptor } = parseSfc(source);
  const ast = parseTemplate(descriptor.template.content);
  const navButton = find(ast, node => node.tag === 'v-app-bar-nav-icon');
  const toolbar = find(ast, node => node.tag === 'v-toolbar');
  assert.ok(navButton && toolbar, 'Read actual mobile navigation toggle');
  const target = node => node.tag === 'NavigationDrawer' || (node.tag === 'v-sheet' && attr(node, 'data-help-scroll'));
  function skeleton(node) {
    if (node.tag === 'NavigationDrawer') return node.loc.source;
    if (node.tag === 'v-sheet' && attr(node, 'data-help-scroll')) {
      return `${openTag(node)}<div class="px-4">${openTag(toolbar)}${navButton.loc.source}<v-toolbar-title>Dashboard layout fixture</v-toolbar-title></v-toolbar>
        <router-view />
        <section v-for="index in 40" :key="index" class="pa-4 mb-2 glass-liquid" :data-content-row="index"><h2>Sample content {{ index }}</h2><p>Synthetic display content for independent scrolling and viewport checks.</p></section>
      </div></v-sheet>`;
    }
    if (!node.tag || !contains(node, target)) return '';
    const children = (node.children || []).map(child => {
      // Preserve the viewport-wide dashboard background: excluding it would
      // conceal overflow regressions caused by centering a capped container.
      if (child.tag === 'div' && child.loc.source.includes('background-dashboard') && !contains(child, target)) return child.loc.source;
      return skeleton(child);
    }).join('\n');
    return `${openTag(node)}${children}</${node.tag}>`;
  }
  const template = ast.children.map(skeleton).join('\n');
  const script = descriptor.scriptSetup.content;
  const state = script.match(/const drawer = ref<boolean>\([^;]+;/)?.[0];
  assert.ok(state, 'Read actual parent drawer initial state');
  return `<template>${template}</template><script setup lang="ts">
    import { ref } from 'vue';
    import NavigationDrawer from 'virtual:layout-navigation.vue';
    ${state}
    const scrollContainer = ref(); const navBarRef = ref(); const onSheetScroll = () => {};
    const loggedWallet = { chain: 'Cardano' };
    const Blockchain = { APEX_PRIME:'Prime', APEX_VECTOR:'Vector', BITCOIN:'Bitcoin', MIDNIGHT:'Midnight' };
    const assets = { cardanoBg: '/src/assets/svg/gero_dashboard.svg' };
  </script>${styles(descriptor)}`;
}

function drawerFixture(source) {
  const { descriptor } = parseSfc(source);
  const ast = parseTemplate(descriptor.template.content);
  const drawer = find(ast, node => node.tag === 'v-navigation-drawer');
  const script = descriptor.scriptSetup.content;
  const tree = ts.createSourceFile('NavigationDrawer.ts', script, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const state = tree.statements.filter(statement => {
    if (ts.isVariableStatement(statement)) return statement.declarationList.declarations.some(declaration => declaration.name.getText(tree) === 'drawer');
    return ts.isExpressionStatement(statement) && ts.isCallExpression(statement.expression) && statement.expression.expression.getText(tree) === 'watch' && statement.expression.arguments[0]?.getText(tree) === 'mobile';
  }).map(statement => statement.getText(tree)).join('\n');
  assert.ok(state.includes('props.modelValue') && state.includes('watch(mobile'), 'Read real computed drawer model and breakpoint watcher');
  return `<template>${openTag(drawer)}
    <template #prepend><div class="pa-4"><strong>Gero navigation</strong></div></template>
    <v-list nav density="compact"><v-list-item v-for="index in 40" :key="index" :to="'/route/' + index" class="menuItem" active-class="activePageDark" style="height:34px" :title="'Page ' + index" /></v-list>
    <template #append><div class="pa-4">Synthetic wallet</div></template>
  </v-navigation-drawer></template><script setup lang="ts">
    import { computed, watch } from 'vue'; import { useDisplay } from 'vuetify';
    const props = defineProps<{ modelValue: boolean }>(); const emit = defineEmits(['update:modelValue']);
    const { mobile } = useDisplay();
    ${state}
  </script>${styles(descriptor)}`;
}

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const { createServer, loadConfigFromFile, mergeConfig } = await import('vite');
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  try {
    for (const variant of process.env.LAYOUT_BEFORE_DIRECTORY ? ['before', 'after'] : ['after']) {
      const source = Object.fromEntries(Object.entries(files).map(([name, file]) => [name, fs.readFileSync(variant === 'before' ? path.join(process.env.LAYOUT_BEFORE_DIRECTORY, `before-${path.basename(file)}`) : path.join(root, file), 'utf8')]));
      const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, path.join(__dirname, 'vite.config.mts'));
      const result = report.variants[variant] = { widths: {}, sourceHashes: Object.fromEntries(Object.entries(source).map(([name, value]) => [name, createHash('sha256').update(value).digest('hex')])), pageErrors: [], externalRequests: [], httpErrors: [] };
      const modules = {
        'virtual:layout-content.vue': contentFixture(source.content),
        'virtual:layout-navigation.vue': drawerFixture(source.nav),
        'virtual:layout-main': `import 'virtual:gero-visual-styles'; import { createApp, h } from 'vue'; import * as components from 'vuetify/components'; import { createRouter, createMemoryHistory } from 'vue-router'; import vuetify from '@/plugins/vuetify'; import { i18nPlugin } from '@/plugins/i18n'; import Layout from 'virtual:layout-content.vue';
          const router = createRouter({ history: createMemoryHistory(), routes: [{ path:'/:pathMatch(.*)*', component: { render:()=>h('h1', { class:'pa-4', 'data-route-heading':'' }, 'Synthetic page') } }] });
          const app = createApp(Layout).use(vuetify).use(i18nPlugin).use(router); for (const [name,component] of Object.entries(components)) app.component(name,component); router.isReady().then(()=>app.mount('#app'));`,
      };
      const ids = Object.fromEntries(Object.keys(modules).map(id => [id, id.endsWith('.vue') ? `/__layout_fixture__/${id.slice(8)}` : `\0${id}`]));
      const plugin = {
        name: 'gero-source-layout-fixture', enforce: 'pre',
        resolveId(id) { return ids[id]; },
        load(id) { const key = Object.keys(ids).find(key => ids[key] === id); if (key) return modules[key]; },
        transform(code, id) { if (variant === 'before' && id.split('?')[0].replaceAll('\\', '/').endsWith('/src/plugins/vuetify.ts')) return source.plugin; },
        configureServer(server) { server.middlewares.use('/layout-proof', async (_req, res) => {
          try { res.setHeader('Content-Type', 'text/html'); res.end(await server.transformIndexHtml('/layout-proof', '<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><div id="app"></div><script type="module" src="/@id/__x00__virtual:layout-main"></script></body></html>')); }
          catch (error) { res.statusCode = 500; res.end(error.stack); }
        }); },
      };
      const server = await createServer(mergeConfig(loaded.config, { configFile: false, plugins: [plugin], optimizeDeps: { include: ['vue-router'] }, cacheDir: path.join(output, '.vite-cache'), logLevel: 'error' }));
      let context;
      try {
        await server.listen();
        const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
        context = await browser.newContext({ viewport: { width: 1920, height: 900 }, reducedMotion: 'reduce', serviceWorkers: 'block' });
        await context.route('**/*', route => { const url = new URL(route.request().url()); if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue(); result.externalRequests.push(url.origin); return route.abort(); });
        const page = await context.newPage();
        page.on('pageerror', error => result.pageErrors.push(error.message));
        page.on('response', response => { if (response.status() >= 400) result.httpErrors.push({ url: response.url(), status: response.status() }); });
        await page.goto(origin + '/layout-proof', { timeout: 60000 });
        await page.locator('[data-help-scroll]').waitFor();
        await page.evaluate(() => document.fonts.ready);
        const settle = () => page.waitForTimeout(400);
        const geometry = () => page.evaluate(() => {
          const measure = selector => { const element = document.querySelector(selector); const box = element.getBoundingClientRect(); const css = getComputedStyle(element); return { x:box.x, y:box.y, width:box.width, height:box.height, right:box.right, paddingLeft:parseFloat(css.paddingLeft), position:css.position, scrollTop:element.scrollTop, scrollWidth:element.scrollWidth, clientWidth:element.clientWidth }; };
          return { viewport:innerWidth, frame:measure('.v-container'), drawer:measure('.v-navigation-drawer'), sheet:measure('[data-help-scroll]'), outerMain:measure('main.v-main'), navScroll:measure('.v-navigation-drawer__content'), toggle:!!document.querySelector('.v-app-bar-nav-icon'), docWidth:document.documentElement.scrollWidth, docScroll:document.documentElement.scrollTop, route:location.pathname };
        });
        for (const width of [1920, 2560, 3440, 1784, 1440, 1280, 1264, 1263, 960, 600, 390]) {
          await page.setViewportSize({ width, height: 900 }); await settle();
          const data = result.widths[width] = await geometry();
          if (variant === 'after') {
            const frameWidth = Math.min(width, 1785); const frameX = (width - frameWidth) / 2; const desktop = width >= 1264;
            near(data.frame.width, frameWidth, `Frame width at ${width}`); near(data.frame.x, frameX, `Frame centered at ${width}`);
            near(data.sheet.x, frameX + (desktop ? 270 : 0), `Sheet starts after drawer at ${width}`);
            near(data.sheet.width, frameWidth - (desktop ? 270 : 0), `Sheet fills remainder at ${width}`);
            near(data.sheet.height, 900, `Sheet viewport height at ${width}`);
            near(data.outerMain.paddingLeft, 0, `Outer layout does not reserve drawer twice at ${width}`);
            check(data.toggle, !desktop, `Mobile toggle boundary at ${width}`);
            near(data.docWidth, width, `No document horizontal overflow at ${width}`);
            check(data.sheet.scrollWidth <= data.sheet.clientWidth, true, `No sheet content clipping at ${width}`);
            if (desktop) { near(data.drawer.x, frameX, `Drawer shares frame left edge at ${width}`); near(data.drawer.right, data.sheet.x, `No drawer/content overlap at ${width}`); }
            else { check(data.drawer.right <= 1, true, `Mobile drawer initially closed at ${width}`); }
          }
          if ([1920, 3440, 1264, 1263, 390].includes(width)) await page.screenshot({ path: path.join(output, `${variant}-${width}.png`) });
        }
        if (variant === 'after') {
          await page.locator('.v-app-bar-nav-icon').click(); await settle();
          let data = result.mobileOpen = await geometry(); near(data.drawer.x, 0, 'Mobile drawer opens at viewport edge'); near(data.sheet.x, 0, 'Temporary drawer does not shift content');
          check(await page.locator('.v-navigation-drawer__scrim').count(), 1, 'Mobile scrim visible');
          await page.screenshot({ path: path.join(output, 'after-mobile-open.png') });
          await page.locator('.v-navigation-drawer__scrim').click({ position: { x: 350, y: 150 } }); await settle();
          data = result.mobileClosed = await geometry(); check(data.drawer.right <= 1, true, 'Scrim closes mobile drawer');
          await page.setViewportSize({ width: 1440, height: 900 }); await settle();
          data = await geometry(); near(data.drawer.x, 0, 'Resize restores desktop drawer'); near(data.sheet.x, 270, 'Resize restores exactly one content offset');
          await page.locator('[data-help-scroll]').hover({ position: { x:500, y:500 } }); await page.mouse.wheel(0, 600); await settle();
          const contentScrolled = await geometry(); check(contentScrolled.sheet.scrollTop > 0, true, 'Content scrolls'); near(contentScrolled.navScroll.scrollTop, 0, 'Content scrolling leaves drawer unchanged'); near(contentScrolled.docScroll, 0, 'Content scrolling leaves document unchanged');
          await page.locator('.v-navigation-drawer__content').hover({ position: { x:100, y:400 } }); await page.mouse.wheel(0, 350); await settle();
          const navScrolled = result.independentScroll = await geometry(); check(navScrolled.navScroll.scrollTop > 0, true, 'Drawer links scroll independently'); near(navScrolled.sheet.scrollTop, contentScrolled.sheet.scrollTop, 'Drawer scrolling leaves content unchanged'); near(navScrolled.docScroll, 0, 'Drawer scrolling leaves document unchanged');
          await page.setViewportSize({ width: 1263, height: 900 }); await settle();
          data = await geometry(); check(data.drawer.right <= 1, true, 'Resize to mobile auto-closes drawer'); near(data.sheet.x, 0, 'Resize removes desktop reservation');
        }
        check(result.pageErrors, [], 'No runtime exceptions'); check(result.httpErrors, [], 'No asset failures'); check(result.externalRequests, [], 'No external requests');
      } finally { await context?.close(); await server.close(); }
    }
    report.passed = true;
  } finally { await browser.close(); fs.writeFileSync(path.join(output, 'layout-parity-report.json'), JSON.stringify(report, null, 2)); }
  console.log(JSON.stringify({ passed:report.passed, checks:report.checks, output }));
})().catch(error => { console.error(error); process.exitCode = 1; });
