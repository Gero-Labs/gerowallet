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
    const url = process.env.WALLET_LIBRARY_URL || 'http://127.0.0.1:3317/test/wallet-library/index.html';
    await page.goto(url);
    await page.getByRole('button', { name: 'Business 1', exact: true }).waitFor();
    const search = page.getByRole('searchbox', { name: 'Search wallets' });
    const names = async (scope = page) => (await scope.locator('.library-wallet:visible .wallet-name').allTextContents()).map(name => name.trim());
    const group = key => page.locator(`[data-group="${key}"]`);
    const eventually = async predicate => {
      for (let i = 0; i < 100; i++) { if (await predicate()) return; await page.waitForTimeout(50); }
      throw new Error('UI did not reach expected state');
    };
    const drag = async (source, destination) => {
      await source.scrollIntoViewIfNeeded();
      const from = await source.boundingBox();
      const to = await destination.boundingBox();
      assert.ok(from && to, 'Drag endpoints exist');
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await page.mouse.down();
      await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 + 8, { steps: 3 });
      await page.mouse.move(to.x + to.width / 2, to.y + 10, { steps: 20 });
      await page.waitForTimeout(200);
      await page.mouse.up();
      await page.waitForTimeout(200);
    };
    assert.equal((await names()).length, 8);
    assert.deepEqual(await names(group('favorites')), ['Company treasury', 'Long-term reserve', 'Everyday wallet']);
    for (const [query, expected] of [['OPERAT', 'Operating expenses'], ['stake1urewardsonly', 'Staking rewards'], ['bc1qreserve', 'Long-term reserve']]) {
      await search.fill(query);
      assert.deepEqual(await names(), [expected]);
    }
    await search.fill('nothing-matches');
    await page.getByText('No wallets match your search.').waitFor();
    await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
    await page.getByRole('button', { name: 'Personal 2', exact: true }).click();
    await eventually(async () => (await names()).length === 6);
    await search.fill('stake1urewardsonly');
    assert.deepEqual(await names(), ['Staking rewards']);
    await search.press('Escape');
    await eventually(async () => (await names()).length === 6);
    await page.getByRole('button', { name: 'Personal 2', exact: true }).click();
    await eventually(async () => (await names()).length === 8);
    // Hold storage indefinitely. The UI must pin immediately, without disabling other rows.
    await page.evaluate(async () => {
      const repo = window.walletLibraryFixture.repository;
      const original = repo.setFavorite;
      window.restoreFavorite = () => { repo.setFavorite = original; };
      repo.setFavorite = async (...args) => {
        await new Promise(resolve => { window.releaseFavorite = resolve; });
        return original(...args);
      };
    });
    await page.getByRole('button', { name: 'Add Operating expenses to favorites', exact: true }).click();
    await eventually(async () => (await names())[0] === 'Operating expenses');
    assert.equal(await page.getByRole('button', { name: 'Add Staking rewards to favorites', exact: true }).isEnabled(), true);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.selectedWallet), undefined);
    await page.waitForFunction(() => typeof window.releaseFavorite === 'function');
    await page.evaluate(() => { window.restoreFavorite(); window.releaseFavorite(); });
    await eventually(async () => (await page.locator('.library-save-status').textContent()).trim() === '');
    await page.locator('.filter-button').filter({ hasText: 'Favorites' }).click();
    assert.equal((await names()).length, 4);
    await page.locator('.filter-button').filter({ hasText: 'All wallets' }).click();
    // Failure must roll back the optimistic star and retain the rest of the list.
    await page.evaluate(async () => {
      const repo = window.walletLibraryFixture.repository;
      const original = repo.setFavorite;
      repo.setFavorite = async () => { repo.setFavorite = original; throw new Error('Simulated storage failure'); };
    });
    await page.getByRole('button', { name: 'Add Staking rewards to favorites', exact: true }).click();
    await page.locator('.library-error').waitFor();
    await page.getByRole('button', { name: 'Add Staking rewards to favorites', exact: true }).waitFor();
    assert.equal((await names()).length, 8);
    await page.getByRole('button', { name: 'New category', exact: true }).click();
    await page.getByRole('textbox', { name: 'Category name' }).fill('Research');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByRole('button', { name: 'Research 0', exact: true }).waitFor();
    await page.locator('.v-dialog__content--active').waitFor({ state: 'hidden' });
    await page.waitForTimeout(350);
    const research = page.locator('.library-group').filter({ has: page.getByRole('button', { name: /Research/ }) });
    await drag(page.getByRole('button', { name: /Reorder Operating expenses/ }), research.locator('.library-wallets'));
    await eventually(async () => (await names(research))[0] === 'Operating expenses');
    await page.getByRole('button', { name: 'Add Operating expenses to favorites', exact: true }).waitFor();
    await page.reload();
    await page.getByRole('button', { name: 'Research 1', exact: true }).waitFor();
    await page.getByRole('button', { name: /Reorder Long-term reserve/ }).press('Alt+ArrowUp');
    await eventually(async () => (await names())[0] === 'Long-term reserve');
    await drag(page.getByRole('button', { name: /Reorder Company treasury/ }), page.locator('[data-wallet-id="3"]'));
    await eventually(async () => (await names())[0] === 'Company treasury');
    // Cross-tab updates and category deletion still preserve every wallet.
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
    await page.locator('.v-dialog__content--active').waitFor({ state: 'hidden' });
    // Drag into a collapsed category: its drop area remains reachable.
    await page.getByRole('button', { name: 'Business 1', exact: true }).click();
    await eventually(async () => (await names(group('business'))).length === 0);
    await drag(page.getByRole('button', { name: /Reorder Staking rewards/ }), group('business').locator('.library-wallets'));
    await eventually(async () => (await names(group('business'))).includes('Staking rewards'));
    // Reproduce the cramped, scrolling list that the old native implementation struggled with.
    await page.setViewportSize({ width: 520, height: 700 });
    const source = page.getByRole('button', { name: /Reorder Partner payments/ });
    await source.scrollIntoViewIfNeeded();
    const from = await source.boundingBox();
    const scroll = await page.locator('.library-scroll').boundingBox();
    const scrollBefore = await page.locator('.library-scroll').evaluate(el => el.scrollTop);
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 8, from.y + from.height / 2 - 8, { steps: 3 });
    await page.mouse.move(scroll.x + scroll.width / 2, scroll.y + 8, { steps: 20 });
    await eventually(async () => await page.locator('.library-scroll').evaluate(el => el.scrollTop) < scrollBefore - 50);
    await eventually(async () => await page.locator('.library-scroll').evaluate(el => el.scrollTop) < 5);
    const pinned = await group('favorites').locator('.library-wallets').boundingBox();
    await page.mouse.move(pinned.x + pinned.width / 2, pinned.y + 10, { steps: 10 });
    await page.waitForTimeout(200);
    await page.mouse.up();
    await eventually(async () => (await names(group('favorites')))[0] === 'Partner payments');
    await page.setViewportSize({ width: 1100, height: 1400 });
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
    const scaleContext = await browser.newContext({ viewport: { width: 1100, height: 960 } });
    const scale = await scaleContext.newPage();
    await scale.goto(url + '?walletCount=200');
    await scale.getByRole('button', { name: 'Add Wallet 200 to favorites', exact: true }).waitFor({ state: 'attached' });
    const renderMs = await scale.evaluate(async () => {
      const repo = window.walletLibraryFixture.repository;
      const original = repo.setFavorite;
      let release;
      repo.setFavorite = async (...args) => { await new Promise(resolve => { release = resolve; }); return original(...args); };
      const started = performance.now();
      const rendered = new Promise(resolve => {
        const observer = new MutationObserver(() => {
          if (document.querySelector('.library-wallet .wallet-name')?.textContent.trim() === 'Wallet 200') {
            observer.disconnect(); resolve(performance.now() - started);
          }
        });
        observer.observe(document.querySelector('.wallet-library'), { childList: true, subtree: true });
      });
      document.querySelector('[aria-label="Add Wallet 200 to favorites"]').click();
      const elapsed = await rendered;
      await new Promise(resolve => setTimeout(resolve, 0));
      release();
      return elapsed;
    });
    assert.ok(renderMs < 500, `Star rendering with 200 wallets took ${renderMs}ms`);
    console.log(`200-wallet star render: ${Math.round(renderMs)}ms, with storage paused.`);
    await scale.locator('.library-save-status').filter({ hasText: 'Saving' }).waitFor({ state: 'hidden' });
    await scaleContext.close();
    console.log('PASS: search, collapsed search, favorites pinned before storage resolves, failed-save rollback, SortableJS drag, collapsed drop targets, autoscroll, keyboard ordering, category lifecycle, reload persistence, cross-tab updates, narrow layout, isolated login action.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
