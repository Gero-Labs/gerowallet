const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');

// Run against a prepared, immutable artifact copy. This exercises the actual
// application and empty-wallet stores; it never writes fixture state into them.
const wallet = process.env.WALLET_REPO || path.resolve(__dirname, '../..');
const extension = path.join(wallet, 'extension');
const out = process.env.MIGRATION_SMOKE_OUTPUT || path.resolve(wallet, '../entrypoints-browser');
fs.mkdirSync(out, { recursive: true });
const files = ['manifest.json', 'index.html', 'sidepanel/index.html'];
const hashes = () => Object.fromEntries(files.map(file => [file,
  crypto.createHash('sha256').update(fs.readFileSync(path.join(extension, file))).digest('hex'),
]));
function artifactDigest() {
  const digest = crypto.createHash('sha256');
  function visit(directory, prefix = '') {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const relative = `${prefix}${name}`;
      if (fs.statSync(file).isDirectory()) visit(file, `${relative}/`);
      else digest.update(relative).update('\0').update(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')).update('\n');
    }
  }
  visit(extension);
  return digest.digest('hex');
}

(async () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
  const policy = manifest.content_security_policy.extension_pages;
  assert.ok(!policy.includes("'unsafe-eval'"), 'Extension must not permit JavaScript eval');
  const artifactHashes = hashes();
  const artifactSha256 = artifactDigest();
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gero-entrypoints-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1360, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const pageErrors = [];
  const observations = [];
  let blockedRequests = 0;
  let passed = false;
  try {
    await context.route(/^https?:/, route => { blockedRequests += 1; return route.abort(); });
    context.on('page', page => page.on('pageerror', error => pageErrors.push({ url: page.url(), message: error.message })));
    // Passive observation only. No eval/new Function/CDP execution is used as
    // a CSP test: application scripts execute through normal extension loading.
    await context.addInitScript(() => {
      window.__migrationCspViolations = [];
      window.addEventListener('securitypolicyviolation', event => {
        window.__migrationCspViolations.push({ directive: event.effectiveDirective, blocked: event.blockedURI,
          sourceFile: event.sourceFile, lineNumber: event.lineNumber, columnNumber: event.columnNumber, sample: event.sample });
      });
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    const base = `chrome-extension://${new URL(worker.url()).host}`;
    const options = await context.newPage();
    await options.goto(`${base}/index.html#/help`);
    await options.getByRole('heading', { name: 'Find your way forward.', exact: true }).waitFor({ timeout: 30000 });
    assert.equal(await options.locator('.v-application').count(), 1);
    await options.screenshot({ path: path.join(out, 'options-public-help.png'), fullPage: true });
    observations.push({ root: 'options', url: options.url(), translatedHeading: await options.locator('h1').innerText(),
      violations: await options.evaluate(() => window.__migrationCspViolations) });

    const panel = await context.newPage();
    await panel.setViewportSize({ width: 390, height: 844 });
    await panel.goto(`${base}/sidepanel/index.html`);
    await panel.locator('.no-wallet-screen').waitFor({ timeout: 30000 });
    const panelText = await panel.locator('.no-wallet-screen').innerText();
    assert.ok(!panelText.includes('miniGero.'), 'Sidepanel must render compiled translations');
    assert.equal(await panel.locator('.v-application').count(), 1);
    assert.equal(await panel.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await panel.screenshot({ path: path.join(out, 'sidepanel-empty-wallet.png'), fullPage: true });
    const opened = context.waitForEvent('page');
    await panel.getByRole('button', { name: 'Get Started', exact: true }).click();
    const dashboard = await opened;
    await dashboard.waitForURL(`${base}/index.html#/welcome`);
    await dashboard.getByRole('button', { name: 'Help', exact: true }).waitFor({ timeout: 30000 });
    observations.push({ root: 'sidepanel', url: panel.url(), translatedText: panelText,
      dashboardOpened: dashboard.url(), violations: await panel.evaluate(() => window.__migrationCspViolations) });
    observations.push({ root: 'dashboard-from-sidepanel', url: dashboard.url(),
      violations: await dashboard.evaluate(() => window.__migrationCspViolations) });
    assert.deepEqual(pageErrors, [], 'Both roots must load without uncaught browser errors');
    for (const observation of observations) assert.deepEqual(observation.violations, [], `CSP violation in ${observation.root}`);
    assert.deepEqual(hashes(), artifactHashes, 'The tested entrypoint artifact files changed during the run');
    assert.equal(artifactDigest(), artifactSha256, 'The tested extension artifact changed during the run');
    passed = true;
  } finally {
    const report = { passed, artifact: wallet, name: manifest.name, version: manifest.version,
      artifactHashes, artifactSha256, profile, blockedRequests, pageErrors, observations,
      browserVersion: context.browser()?.version(), nodeVersion: process.version,
      os: { platform: os.platform(), release: os.release(), arch: os.arch() },
      coverage: 'Actual extension pages in Chromium tabs, including sidepanel document and dashboard tab handoff; native browser side-panel chrome is not automated.' };
    fs.writeFileSync(path.join(out, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify(report));
    await context.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
