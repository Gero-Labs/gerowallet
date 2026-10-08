const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
// Each scenario uses a fresh browser profile and intercepted API responses.
const out = process.env.HELP_SMOKE_OUTPUT || path.resolve(__dirname, '../../output/help-browser');
fs.mkdirSync(out, { recursive: true });
const extension = path.join(process.env.WALLET_REPO || path.resolve(__dirname, '../..'), 'extension');

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gero-help-smoke-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1360, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const errors = [];
  const requests = [];
  try {
    await context.route(/^https?:/, async route => { requests.push(route.request().url().split('?')[0]); await route.abort(); });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    // chrome-extension URLs have an opaque origin in Node's URL implementation.
    const base = worker.url().split('/').slice(0, 3).join('/');
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(`${base}/index.html#/help`);
    await page.locator('.help-hero').waitFor({ timeout: 30000 });
    await page.screenshot({ path: path.join(out, 'help-public-desktop.png'), fullPage: true });
    console.log(JSON.stringify({ stage: 'public-home', url: page.url(), text: (await page.locator('body').innerText()).slice(0, 2600), errors }));
    assert.equal(await page.locator('.help-topic').count(), 6);
    await page.locator('.help-chain select').selectOption('midnight');
    await page.locator('.help-topic--muted').first().waitFor();
    const muted = await page.locator('.help-topic--muted').allTextContents();
    assert.ok(muted.some(text => text.includes('Gero Card') && text.includes('Cardano only')));
    await page.locator('a.help-topic[href*="/card"]').click();
    await page.locator('.help-applicability').waitFor();
    await page.screenshot({ path: path.join(out, 'help-midnight-applicability.png'), fullPage: true });
    await page.goto(`${base}/index.html#/help/articles/backup?chain=midnight&q=recovery`);
    await page.locator('.help-answer-body').waitFor();
    await page.locator('.help-reader button').filter({ hasText: 'Contact support about this guide' }).click();
    await page.locator('[data-test="support-notice"]').waitFor();
    await page.waitForTimeout(400);
    assert.ok((await page.locator('[data-test="support-notice"]').innerText()).includes('create or import'));
    assert.equal(await page.locator('.help-notice a.help-email').getAttribute('href'), 'mailto:support@gerowallet.io');
    await page.screenshot({ path: path.join(out, 'help-no-wallet-support.png'), fullPage: true });
    await page.getByRole('dialog').getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('.help-notice').waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/index.html#/help`);
    await page.locator('.help-hero').waitFor();
    await page.screenshot({ path: path.join(out, 'help-public-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('#help-query').fill('proof server');
    await page.locator('#help-query').press('Enter');
    await page.locator('.help-ledger .help-answer-row').first().waitFor();
    assert.ok((await page.locator('.help-ledger').innerText()).toLowerCase().includes('proof'));
    await page.goto(`${base}/index.html#/blog`);
    await page.locator('.help-public-header').waitFor();
    assert.ok(page.url().endsWith('#/blog'));
    await page.goto(`${base}/index.html#/blog/unavailable-offline-slug`);
    await page.locator('.help-public-header').waitFor();
    assert.ok(page.url().includes('#/blog/unavailable-offline-slug'));
    await page.goto(`${base}/index.html#/welcome`);
    await page.locator('.language-selector-container').waitFor();
    assert.ok((await page.locator('.language-selector-container').innerText()).includes('Help Center'));
    await page.screenshot({ path: path.join(out, 'welcome-help.png'), fullPage: true });
    await page.setViewportSize({ width: 1360, height: 1000 });
    await page.getByRole('button', { name: 'Create your first wallet', exact: true }).click();
    await page.locator('.onboarding-wrapper').waitFor();
    await page.evaluate(() => { window.originalHelpTabCreate = chrome.tabs.create; chrome.tabs.create = () => Promise.reject(new Error('Synthetic denied tab')); });
    await page.locator('.language-selector-container').getByRole('button', { name: 'Help Center', exact: true }).click();
    await page.locator('.welcome-help-error').waitFor();
    assert.ok(page.url().endsWith('#/welcome'));
    assert.equal(await page.getByRole('button', { name: 'Create your first wallet', exact: true }).count(), 0);
    await page.screenshot({ path: path.join(out, 'welcome-tab-failure.png'), fullPage: true });
    const fallbackTabPromise = context.waitForEvent('page');
    await page.locator('.welcome-help-error a').click();
    const fallbackTab = await fallbackTabPromise;
    await fallbackTab.locator('.help-hero').waitFor(); await fallbackTab.close();
    await page.evaluate(() => { chrome.tabs.create = window.originalHelpTabCreate; });
    const newTab = context.waitForEvent('page');
    await page.locator('.language-selector-container').getByRole('button', { name: 'Help Center', exact: true }).click();
    const helpTab = await newTab;
    await helpTab.locator('.help-hero').waitFor();
    assert.ok(page.url().endsWith('#/welcome'));
    assert.equal(await page.getByRole('button', { name: 'Create your first wallet', exact: true }).count(), 0);
    await helpTab.close();
    // Use synthetic wallet metadata in this isolated profile; no keys or funds.
    // The UI, route guard and lock watcher are the real production bundle.
    await page.goto(`${base}/index.html#/help/articles/backup?chain=midnight&q=recovery`);
    await page.locator('.help-answer-body').waitFor();
    await page.evaluate(async () => {
      const m = await import('./js/activityTracker.service.js');
      window.helpSmokeStores = m;
      const wallet = { id: 90001, name: 'Help smoke wallet', chain: 'Midnight', network: 'Mainnet', type: 'Normal', icon: 'gero' };
      m.geroStore.wallets = { [wallet.id]: wallet };
      m.walletStore.loggedWallet = wallet;
      m.walletStore.isSyncing = false;
      m.walletStore.isLocked = false;
    });
    await page.locator('.help-public-header').waitFor({ state: 'hidden' });
    await page.locator('.help-answer-body').waitFor();
    await page.screenshot({ path: path.join(out, 'help-unlocked-reader.png'), fullPage: true });
    const beforeLock = page.url();
    await page.evaluate(() => { window.helpSmokeStores.walletStore.isLocked = true; });
    await page.locator('.help-public-header').waitFor();
    assert.equal(page.url(), beforeLock);
    assert.equal(await page.locator('#help-query').inputValue(), 'recovery');
    await page.locator('.help-public-header').getByRole('link', { name: 'Unlock wallet', exact: true }).click();
    assert.ok(page.url().includes('redirect='));
    await page.screenshot({ path: path.join(out, 'welcome-saved-help.png'), fullPage: true });
    await page.evaluate(() => { window.helpSmokeStores.walletStore.isLocked = false; });
    await page.locator('.help-answer-body').waitFor();
    assert.equal(page.url(), beforeLock);
    await page.evaluate(async () => {
      const m = window.helpSmokeStores;
      m.featureFlagsStore.state.isInitialized = true;
      m.featureFlagsStore.state.flags.isHelpCenterEnabled = true;
      m.featureFlagsStore.state.flags.isLiveChatEnabled = true;
      m.walletStore.loggedWallet = { id: 90002, name: 'Support smoke wallet', chain: 'Cardano', network: 'Mainnet', type: 'Normal', icon: 'gero', stakeAddress: 'stake1synthetic' };
      await chrome.storage.local.set({ agentDockPrefs: { hidden: true } });
    });
    await page.locator('.agent-dock').waitFor({ state: 'hidden' });
    assert.equal(page.url(), beforeLock, 'Remote flag arrival must not navigate the open article');
    await page.locator('.help-reader button').filter({ hasText: 'Contact support about this guide' }).click();
    await page.locator('.agent-dock__input textarea').waitFor();
    const draft = await page.locator('.agent-dock__input textarea').inputValue();
    assert.ok(draft.includes('Cardano') && draft.includes('backup'));
    assert.ok(!draft.includes('stake1synthetic'));
    assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('agentDockPrefs')).agentDockPrefs.hidden), true);
    await page.screenshot({ path: path.join(out, 'help-support-context.png'), fullPage: true });
    await page.evaluate(() => { window.helpSmokeStores.featureFlagsStore.state.flags.isLiveChatEnabled = false; });
    await page.locator('.help-notice').waitFor();
    assert.ok((await page.locator('[data-test="support-notice"]').innerText()).includes('unavailable'));
    await page.locator('.help-notice').getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('.help-notice').waitFor({ state: 'hidden' });
    await page.goto(`${base}/index.html#/blog`);
    await page.waitForURL('**#/help/updates?source=blog*');
    assert.ok(page.url().includes('source=blog'));
    assert.equal(requests.filter(url => /chatwoot|support\.gerowallet|support-chat/i.test(url)).length, 0, 'No chat identity/message created before Send');
    console.log(JSON.stringify({ stage: 'complete', errors, blockedExternalRequests: requests.length, profile, screenshots: out }));
    fs.writeFileSync(path.join(out, 'browser-results.json'), JSON.stringify({ errors, blockedExternalRequests: requests.length, passed: true }, null, 2));
    assert.deepEqual(errors, []);
  } catch (error) {
    const page = context.pages().at(-1);
    if (page) {
      await page.screenshot({ path: path.join(out, 'help-smoke-failure.png'), fullPage: true }).catch(() => {});
      console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 3000));
    }
    console.error({ errors });
    throw error;
  } finally { await context.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
