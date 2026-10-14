// Real search/address templates and scoped CSS; synthetic values only.
// No wallet startup, extension profile, network requests or signing services.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { parse, compileStyleAsync } = require('@vue/compiler-sfc');
const { parse: parseTemplate } = require('@vue/compiler-dom');
const root = path.resolve(__dirname, '../..');
const output = process.env.VISUAL_PARITY_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(), 'gero-field-focus-'));
const report = { passed: false, measurements: {}, errors: [], requests: [] };
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const find = (node, test) => test(node) ? node : (node.children || []).map(child => find(child, test)).find(Boolean);

(async () => {
  fs.mkdirSync(output, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 900, height: 540 }, reducedMotion: 'reduce' });
    page.on('pageerror', error => report.errors.push(error.message));
    await page.route('**/*', route => { report.requests.push(route.request().url()); return route.abort(); });
    await page.setContent('<div id="app"></div>');
    for (const file of ['src/shared/styles/vuetify-layers.css', 'src/shared/styles/tokens.css',
      'node_modules/vuetify/dist/vuetify.css', 'src/shared/styles/baseline.css', 'src/shared/styles/vuetify-compat.css']) {
      await page.addStyleTag({ content: read(file) });
    }
    const inter = fs.readFileSync(path.join(root, 'node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2')).toString('base64');
    const mdi = fs.readFileSync(path.join(root, 'node_modules/@mdi/font/fonts/materialdesignicons-webfont.woff2')).toString('base64');
    await page.addStyleTag({ content: read('node_modules/@mdi/font/css/materialdesignicons.css').replace(/url\([^)]*\)/g, `url(data:font/woff2;base64,${mdi})`) });
    await page.addStyleTag({ content: `@font-face{font-family:'Inter Variable';font-weight:100 900;src:url(data:font/woff2;base64,${inter})} .fixture{width:min(560px,calc(100vw - 32px));margin:40px auto} .recipient-fixture{padding:24px;margin-top:32px;background:var(--g-surface);border-radius:var(--g-r-card)}` });
    const components = {};
    for (const [name, file] of [['Search', 'src/shared/components/GlobalSearch.vue'], ['Recipient', 'src/modules/dashboard/components/SendRecipientCard.vue']]) {
      const descriptor = parse(read(file)).descriptor;
      const input = find(parseTemplate(descriptor.template.content), node => node.tag === 'v-text-field');
      assert.ok(input, `${file}: source input must exist`);
      components[name] = { input: input.loc.source, scope: `data-v-focus-${name.toLowerCase()}` };
      for (const style of descriptor.styles) {
        const compiled = await compileStyleAsync({ source: style.content, filename: path.join(root, file), id: components[name].scope,
          scoped: style.scoped, preprocessLang: style.lang,
          preprocessOptions: { additionalData: '@import "_tokens.scss";\n', loadPaths: [path.join(root, 'src/shared/styles')], silenceDeprecations: ['import', 'if-function'] } });
        assert.deepEqual(compiled.errors, []);
        await page.addStyleTag({ content: compiled.code });
      }
    }
    for (const file of ['node_modules/vue/dist/vue.global.prod.js', 'node_modules/vuetify/dist/vuetify.min.js']) await page.addScriptTag({ content: read(file) });
    await page.evaluate(components => {
      const Search = { __scopeId: components.Search.scope,
        template: `<v-card class="global-search-card" style="border-radius:12px;overflow:hidden"><v-card-text class="pa-0">${components.Search.input}</v-card-text><v-divider/><div class="global-search-footer pa-3 text-center">Press Esc to close</div></v-card>`,
        data: () => ({ query: '' }), methods: { t: () => 'Global Search', moveSelection() {}, selectCurrent() {} } };
      const Recipient = { __scopeId: components.Recipient.scope,
        template: `<div class="recipient-fixture"><div class="address-row">${components.Recipient.input}</div></div>`,
        data: () => ({ localAddress: 'addr_test1_synthetic_recipient_for_layout_only', loggedWallet: { chain: 'Cardano', network: 'Preprod' },
          isMainnetCardano: false, resolving: false, resolvedSuffix: '', handleAsset: null, canSaveContact: false, resolvedFailed: false, invalid: false }),
        computed: { rules() { return { recipientRules: () => () => !this.invalid }; } }, methods: { resolveAddress() {} } };
      const app = Vue.createApp({ components: { Search, Recipient }, template: '<v-app><main class="fixture"><Search/><Recipient ref="recipient"/></main></v-app>' });
      app.config.globalProperties.$t = () => 'Enter recipient address';
      app.use(Vuetify.createVuetify({ components: Vuetify.components, directives: Vuetify.directives,
        defaults: { VTextField: { color: 'primary' } }, theme: { defaultTheme: 'dark', themes: { dark: { dark: true, colors: { primary: '#33C7DD', error: '#FDA29B' } } } } }));
      window.fixture = app.mount('#app');
    }, components);
    await page.evaluate(() => document.fonts.ready);
    for (const width of [900, 390]) {
      await page.setViewportSize({ width, height: 540 });
      for (const [name, selector] of [['search', '.global-search-input'], ['recipient', '.address-input']]) {
        const field = page.locator(selector);
        await field.locator('input').focus();
        await page.waitForFunction(selector => document.querySelector(`${selector} .v-field--focused`), selector);
        await page.waitForTimeout(300); // Native focus color transition, not wallet work.
        const value = await field.evaluate(element => {
          const field = element.querySelector('.v-field'), outline = element.querySelector('.v-field__outline');
          const box = field.getBoundingClientRect(), ring = outline.getBoundingClientRect();
          return { inputOutline: getComputedStyle(element.querySelector('input')).outlineStyle,
            radius: getComputedStyle(field).borderRadius, ringRadius: getComputedStyle(outline).borderRadius,
            shadow: getComputedStyle(outline).boxShadow, color: getComputedStyle(outline).color,
            border: getComputedStyle(outline.querySelector('.v-field__outline__start') || outline).borderLeftWidth,
            x: box.x, width: box.width, ringX: ring.x, ringWidth: ring.width };
        });
        report.measurements[`${name}-${width}`] = value;
        assert.equal(value.inputOutline, 'none');
        assert.equal(value.x, value.ringX);
        assert.equal(value.width, value.ringWidth);
        assert.ok(value.x >= 0 && value.x + value.width <= width);
        if (name === 'search') {
          assert.equal(value.radius, '12px 12px 0px 0px');
          assert.equal(value.ringRadius, value.radius);
          assert.match(value.shadow, /2px inset/);
        } else {
          assert.equal(value.radius, '8px');
          assert.equal(value.border, '1px');
        }
        await page.locator('.fixture').screenshot({ path: path.join(output, `${name}-${width}.png`) });
      }
    }
    await page.evaluate(() => { window.fixture.$refs.recipient.invalid = true; });
    await page.waitForFunction(() => document.querySelector('.address-input .v-field--error'));
    const errorColor = await page.evaluate(() => {
      const swatch = document.createElement('span');
      swatch.style.color = 'var(--g-error)';
      document.body.append(swatch);
      const color = getComputedStyle(swatch).color;
      swatch.remove();
      return color;
    });
    await page.waitForFunction(color => getComputedStyle(document.querySelector('.address-input .v-field__outline')).color === color, errorColor);
    report.measurements.errorColor = errorColor;
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.requests, []);
    report.passed = true;
    console.log(`Source field focus checks passed. Evidence: ${output}`);
  } finally {
    fs.writeFileSync(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
