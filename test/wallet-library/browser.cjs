// Run the fixture server first: vite --config test/wallet-library/vite.config.mts
// PLAYWRIGHT_MODULE may point to an existing Playwright installation.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const { join } = require('node:path');
const { tmpdir } = require('node:os');

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_EXECUTABLE ? { executablePath: process.env.CHROME_EXECUTABLE } : {}) });
  try {
    const context = await browser.newContext({ viewport: { width: 1100, height: 1400 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const url = 'http://127.0.0.1:3317/test/wallet-library/index.html';
    await page.goto(url);
    await page.getByRole('button', { name: 'Business 3', exact: true }).waitFor();
    const search = page.getByRole('searchbox', { name: 'Search wallets' });
    const visibleNames = () => page.locator('.library-wallet:visible .wallet-name').allTextContents();
    const names = async () => (await visibleNames()).map(name => name.trim());
    const eventually = async predicate => {
      for (let i = 0; i < 60; i++) { if (await predicate()) return; await page.waitForTimeout(50); }
      throw new Error('UI did not reach expected state');
    };
    assert.equal((await names()).length, 8);
    await search.fill('OPERAT');
    assert.deepEqual(await names(), ['Operating expenses']);
    await search.fill('stake1urewardsonly');
    assert.deepEqual(await names(), ['Staking rewards']);
    await search.fill('bc1qreserve');
    assert.deepEqual(await names(), ['Long-term reserve']);
    await search.fill('nothing-matches');
    await page.getByText('No wallets match your search.').waitFor();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.getByRole('button', { name: 'Personal 3', exact: true }).click();
    await eventually(async () => (await names()).length === 5);
    await search.fill('stake1urewardsonly');
    assert.deepEqual(await names(), ['Staking rewards']);
    await search.press('Escape');
    await eventually(async () => (await names()).length === 5);
    await page.getByRole('button', { name: 'Personal 3', exact: true }).click();
    await eventually(async () => (await names()).length === 8);
    await page.getByRole('button', { name: 'Add Operating expenses to favorites', exact: true }).click();
    await page.getByRole('button', { name: 'Remove Operating expenses from favorites', exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.selectedWallet), undefined);
    await page.getByRole('button', { name: /Favorites 4/ }).click();
    assert.equal((await names()).length, 4);
    await page.getByRole('button', { name: /All wallets 8/ }).click();
    await page.getByRole('button', { name: 'New category', exact: true }).click();
    await page.getByRole('textbox', { name: 'Category name' }).fill('Research');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Research 0', exact: true }).waitFor();
    // Real browser drag, including a move to an empty category.
    await page.getByRole('button', { name: /Reorder Operating expenses/ }).dragTo(page.getByRole('button', { name: 'Research 0', exact: true }));
    await page.getByRole('button', { name: 'Research 1', exact: true }).waitFor();
    assert.deepEqual(await page.locator('.library-group').filter({ has: page.getByRole('button', { name: 'Research 1', exact: true }) }).locator('.wallet-name').allTextContents().then(values => values.map(value => value.trim())), ['Operating expenses']);
    await page.reload();
    await page.getByRole('button', { name: 'Research 1', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Remove Operating expenses from favorites', exact: true }).waitFor();
    // Keyboard reordering, then drag back to the original order.
    const handle = page.getByRole('button', { name: /Reorder Long-term reserve/ });
    await handle.focus();
    await handle.press('Alt+ArrowUp');
    await eventually(async () => (await names())[0] === 'Long-term reserve');
    await page.getByRole('button', { name: /Reorder Company treasury/ }).dragTo(page.getByRole('button', { name: 'Open Long-term reserve', exact: true }));
    await eventually(async () => (await names())[0] === 'Company treasury');
    // Cross-tab reactivity uses the same IndexedDB, not a second preferences store.
    const other = await context.newPage();
    await other.goto(url);
    await other.getByRole('button', { name: 'Research 1', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Remove Company treasury from favorites', exact: true }).click();
    await other.getByRole('button', { name: 'Add Company treasury to favorites', exact: true }).waitFor();
    await other.close();
    await page.getByRole('button', { name: 'Actions for Research', exact: true }).click();
    await page.getByText('Delete category', { exact: true }).click();
    await page.getByRole('button', { name: 'Delete', exact: true }).click();
    await eventually(async () => await page.getByRole('button', { name: 'Research 1', exact: true }).count() === 0);
    assert.equal((await names()).length, 8);
    await page.getByRole('button', { name: 'Remove Operating expenses from favorites', exact: true }).waitFor();
    await page.locator('.v-dialog__content--active').waitFor({ state: 'hidden' });
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(350);
    await page.evaluate(() => document.fonts.ready);
    await page.screenshot({ path: join(tmpdir(), 'gero-wallet-library-desktop.png'), fullPage: true });
    await page.setViewportSize({ width: 375, height: 812 });
    await page.screenshot({ path: join(tmpdir(), 'gero-wallet-library-mobile.png'), fullPage: true });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.getByRole('button', { name: 'Open Company treasury', exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.selectedWallet), '1');
    assert.deepEqual(errors, []);
    console.log('PASS: search, collapsed search, filters, favorites, category create/delete, real drag, keyboard ordering, reload persistence, cross-tab updates, narrow layout, and isolated login action.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
