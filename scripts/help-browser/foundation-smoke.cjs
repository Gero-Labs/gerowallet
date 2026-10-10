const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { fitShot, scrollsSideways, acceptHelpEvents, anonymousEvents } = require('./helpers.cjs');
// Each scenario uses a fresh browser profile and intercepted API responses.
const out = process.env.HELP_SMOKE_OUTPUT || path.resolve(__dirname, '../../output/help-browser');
fs.mkdirSync(out, { recursive: true });
const extension = path.join(process.env.WALLET_REPO || path.resolve(__dirname, '../..'), 'extension');
const shot = name => path.join(out, name);
const READER = '#/help/articles/backup?chain=midnight&q=recovery';
const HERO_QUERY = 'proof server';
const WELCOME_QUERY = 'unlikely zebra words';

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gero-help-smoke-'));
  const context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1360, height: 1000 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`],
  });
  const errors = [];
  const requests = [];
  const eventBodies = [];
  try {
    // Every http(s) request is refused, except the anonymous usage counters, which are accepted and recorded:
    // this scenario runs on the bundled answers alone.
    await context.route(/^https?:/, async route => {
      requests.push(route.request().url().split('?')[0]);
      if (await acceptHelpEvents(route, eventBodies)) return;
      await route.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
    // chrome-extension URLs have an opaque origin in Node's URL implementation.
    const base = worker.url().split('/').slice(0, 3).join('/');
    const page = await context.newPage();
    page.on('pageerror', e => errors.push(e.message));
    const header = page.locator('header.help-header');
    const dialog = page.getByRole('dialog');
    const helpButton = page.getByRole('button', { name: 'Help', exact: true });
    const panel = page.locator('#whelp-panel');
    const readerBody = page.locator('.g-prose.article-body');
    const goReader = () => page.goto(`${base}/index.html${READER}`);

    // --- Public home, no wallet ---
    await page.goto(`${base}/index.html#/help`);
    await page.getByRole('heading', { level: 1, name: 'Find your way forward.' }).waitFor({ timeout: 30000 });
    await page.screenshot({ path: shot('help-public-desktop.png'), fullPage: true });
    console.log(JSON.stringify({ stage: 'public-home', url: page.url(), text: (await page.locator('body').innerText()).slice(0, 2600), errors }));
    await header.waitFor();
    assert.equal(await header.getByRole('link', { name: 'Overview' }).getAttribute('aria-current'), 'page');
    await page.getByRole('search').first().waitFor();
    await page.locator('#help-query').waitFor();
    const chainPills = page.locator('.chain-pills');
    assert.deepEqual(await chainPills.getByRole('button').evaluateAll(buttons => buttons.map(b => [b.textContent.trim(), b.getAttribute('aria-pressed')])),
      [['All chains', 'true'], ['Cardano', 'false'], ['Midnight', 'false'], ['Bitcoin', 'false']]);
    assert.equal(await page.locator('.topic-tile').count(), 6);
    assert.equal(await page.locator('.topic-tile--muted').count(), 0);
    await chainPills.getByRole('button', { name: 'Midnight', exact: true }).click();
    assert.equal(await chainPills.getByRole('button', { name: 'Midnight', exact: true }).getAttribute('aria-pressed'), 'true');
    assert.equal(await chainPills.getByRole('button', { name: 'All chains', exact: true }).getAttribute('aria-pressed'), 'false');
    await page.locator('.topic-tile--muted').first().waitFor();
    const muted = await page.locator('.topic-tile--muted').allTextContents();
    assert.ok(muted.some(text => text.includes('Gero Card') && text.includes('Cardano only')), 'Gero Card is demoted to Cardano only');
    await page.locator('a.topic-tile[href*="/topics/card"]').click();
    await page.locator('.help-applicability').waitFor();
    await fitShot(page, shot('help-midnight-applicability.png'));

    // --- Reader for a bundled answer, and the no-wallet email dialog ---
    await goReader();
    await readerBody.waitFor();
    const crumbs = page.getByRole('navigation', { name: 'Breadcrumb' });
    await crumbs.getByRole('link', { name: 'Tutorials & answers' }).waitFor();
    await crumbs.getByRole('link', { name: 'Security & recovery' }).waitFor();
    assert.equal(await crumbs.locator('[aria-current="page"]').textContent(), 'Keep your recovery phrase safe');
    assert.equal(await page.getByRole('heading', { level: 1 }).textContent(), 'Keep your recovery phrase safe');
    assert.ok((await readerBody.innerText()).length > 40, 'The bundled answer renders');
    assert.equal(await page.locator('#help-reader-search').inputValue(), 'recovery');
    assert.ok((await page.locator('aside.rail').innerText()).includes('All wallets and chains'));
    await page.getByRole('button', { name: 'Contact support about this guide' }).click();
    await page.locator('[data-test="support-notice"]').waitFor();
    await page.waitForTimeout(400);
    assert.ok((await page.locator('[data-test="support-notice"]').innerText()).includes('create or import'));
    const mailto = 'mailto:support@gerowallet.io';
    assert.equal(await dialog.locator('a.support-email-link').getAttribute('href'), mailto);
    const emailAction = dialog.getByRole('link', { name: 'Email support', exact: true });
    assert.equal(await emailAction.getAttribute('href'), mailto);
    assert.match(await emailAction.getAttribute('class'), /g-btn--primary/);
    const setupAction = dialog.getByRole('link', { name: 'Create or import', exact: true });
    assert.ok((await setupAction.getAttribute('href')).endsWith('#/welcome'));
    assert.match(await setupAction.getAttribute('class'), /g-btn--secondary/);
    await page.screenshot({ path: shot('help-no-wallet-support.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('[data-test="support-notice"]').waitFor({ state: 'hidden' });

    // --- Narrow layout and search from the hero ---
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${base}/index.html#/help`);
    await page.locator('#help-query').waitFor();
    assert.equal(await scrollsSideways(page), false, 'Home has no horizontal scroll at 390px');
    await fitShot(page, shot('help-public-mobile.png'));
    await page.locator('#help-query').fill(HERO_QUERY);
    await page.locator('#help-query').press('Enter');
    await page.locator('.results .result-row').first().waitFor();
    assert.ok(page.url().includes('/help/search') && page.url().includes('q=proof'));
    assert.ok((await page.locator('.results').innerText()).toLowerCase().includes('proof'));
    assert.equal(await scrollsSideways(page), false, 'Results have no horizontal scroll at 390px');

    // --- Blog routes keep their behaviour ---
    await page.goto(`${base}/index.html#/blog`);
    await header.waitFor();
    assert.ok(page.url().endsWith('#/blog'));
    await page.goto(`${base}/index.html#/blog/unavailable-offline-slug`);
    await header.waitFor();
    assert.ok(page.url().includes('#/blog/unavailable-offline-slug'));

    // --- Welcome screen: one Help button, a panel over the unchanged screen ---
    await page.setViewportSize({ width: 1360, height: 1000 });
    await page.goto(`${base}/index.html#/welcome`);
    await page.locator('.language-selector-container').waitFor();
    assert.equal(await helpButton.count(), 1, 'Exactly one Help button');
    assert.equal(await page.getByRole('button', { name: /Help Center|Contact support/ }).count(), 0, 'No Help Center or Contact support button');
    assert.equal(await helpButton.getAttribute('aria-expanded'), 'false');
    const create = page.getByRole('button', { name: 'Create your first wallet', exact: true });
    await helpButton.click();
    await panel.waitFor();
    assert.equal(await helpButton.getAttribute('aria-expanded'), 'true');
    assert.equal(await create.count(), 1, 'The welcome content stays mounted');
    assert.ok(page.url().endsWith('#/welcome'));
    assert.deepEqual(await panel.locator('h3.t-label').evaluateAll(headings => headings.map(h => h.textContent.trim())).then(labels => labels.slice(0, 2)), ['New to Gero', 'Common questions']);
    assert.ok((await panel.innerText()).includes('Support will never need your recovery words.'));
    await panel.locator('#whelp-search').fill(WELCOME_QUERY);
    await panel.locator('[data-test="no-results"]').waitFor();
    await page.waitForTimeout(900); // The panel counts a search once typing has paused for 600 ms.
    await panel.locator('#whelp-search').fill('');
    await panel.locator('[data-test="list-view"] [data-section]').first().waitFor();
    await page.screenshot({ path: shot('welcome-help.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    assert.equal(await helpButton.getAttribute('aria-expanded'), 'false');
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-test')), 'help-button', 'Focus returns to the Help button');

    // Setup open: the panel talks about this step and keeps setup untouched underneath.
    await create.click();
    await page.locator('.onboarding-wrapper').waitFor();
    await helpButton.click();
    await panel.waitFor();
    assert.ok((await panel.locator('[data-section="aboutStep"] h3').textContent()).includes('About this step'));
    await panel.getByRole('button', { name: /Restore an existing wallet/ }).click();
    const answer = panel.locator('[data-test="answer-view"]');
    await answer.waitFor();
    assert.ok((await answer.locator('span.t-label').first().textContent()).includes('About this step'));
    const numbers = await answer.locator('.whelp-step__number').allTextContents();
    assert.ok(numbers.length >= 2, 'The answer is split into steps');
    assert.deepEqual(numbers, numbers.map((_, i) => String(i + 1)), 'Steps are numbered in order');
    assert.ok((await answer.locator('[data-test="setup-caption"]').innerText()).includes('Help stays available while setup is open.'));
    assert.equal(await panel.getByRole('button', { name: 'Back to Help' }).count(), 1);
    await page.screenshot({ path: shot('welcome-help-panel-setup-answer.png'), fullPage: true });
    await panel.getByRole('button', { name: 'Back to Help' }).click();
    await panel.locator('[data-test="list-view"]').waitFor();
    assert.equal(await answer.count(), 0, 'Back returns to the list');

    // The full Help Center opens in a new tab; this tab keeps its URL and its setup.
    const openFull = panel.getByRole('link', { name: /Open the full Help Center/ });
    let nextTab = context.waitForEvent('page');
    await openFull.click();
    let helpTab = await nextTab;
    await helpTab.getByRole('heading', { level: 1, name: 'Find your way forward.' }).waitFor();
    assert.ok(helpTab.url().endsWith('#/help'));
    assert.ok(page.url().endsWith('#/welcome'));
    assert.equal(await page.locator('.onboarding-wrapper').count(), 1);
    assert.equal(await helpButton.getAttribute('aria-expanded'), 'true');
    await helpTab.close();

    // A refused tab is reported inside the panel footer, with a plain link to the same page.
    await page.evaluate(() => { window.originalHelpTabCreate = chrome.tabs.create; chrome.tabs.create = () => Promise.reject(new Error('Synthetic denied tab')); });
    await openFull.click();
    const failure = panel.locator('footer [data-test="open-failed"]');
    await failure.waitFor();
    assert.ok((await failure.innerText()).includes('Help could not open automatically.'));
    assert.ok(page.url().endsWith('#/welcome'));
    assert.equal(await page.locator('.onboarding-wrapper').count(), 1);
    await page.screenshot({ path: shot('welcome-help-panel-failure.png'), fullPage: true });
    nextTab = context.waitForEvent('page');
    await failure.getByRole('link', { name: 'Open Help in a new tab' }).click();
    helpTab = await nextTab;
    await helpTab.getByRole('heading', { level: 1, name: 'Find your way forward.' }).waitFor();
    await helpTab.close();
    await page.evaluate(() => { chrome.tabs.create = window.originalHelpTabCreate; });
    nextTab = context.waitForEvent('page');
    await openFull.click();
    helpTab = await nextTab;
    await helpTab.getByRole('heading', { level: 1, name: 'Find your way forward.' }).waitFor();
    await helpTab.close();
    assert.equal(await failure.count(), 0, 'A successful open clears the failure message');
    assert.ok(page.url().endsWith('#/welcome'));
    assert.equal(await page.locator('.onboarding-wrapper').count(), 1);

    // On a phone the panel is a bottom sheet over a scrim.
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    await page.setViewportSize({ width: 390, height: 844 });
    await helpButton.click();
    const sheet = page.locator('section#whelp-panel.whelp-sheet');
    await sheet.waitFor();
    assert.equal(await sheet.getAttribute('role'), 'dialog');
    assert.equal(await sheet.getAttribute('aria-modal'), 'true');
    const sheetBox = await sheet.boundingBox();
    assert.ok(Math.abs(sheetBox.y + sheetBox.height - 844) <= 1 && sheetBox.width >= 389 && sheetBox.y > 0, `Bottom sheet is anchored to the bottom edge: ${JSON.stringify(sheetBox)}`);
    const scrimBox = await page.locator('[data-test="scrim"]').boundingBox();
    assert.deepEqual([scrimBox.x, scrimBox.y, scrimBox.width, scrimBox.height], [0, 0, 390, 844], 'The scrim covers the screen');
    await page.screenshot({ path: shot('welcome-help-sheet-390.png'), fullPage: true });
    await page.mouse.click(20, 20);
    await sheet.waitFor({ state: 'detached' });
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('data-test')), 'help-button');
    await page.setViewportSize({ width: 1360, height: 1000 });

    // --- Synthetic wallet metadata in this isolated profile; no keys or funds. ---
    // The UI, route guard and lock watcher are the real production bundle.
    await goReader();
    await readerBody.waitFor();
    await page.evaluate(async () => {
      const m = await import('./js/activityTracker.service.js');
      window.helpSmokeStores = m;
      const wallet = { id: 90001, name: 'Help smoke wallet', chain: 'Midnight', network: 'Mainnet', type: 'Normal', icon: 'gero' };
      m.geroStore.wallets = { [wallet.id]: wallet };
      m.walletStore.loggedWallet = wallet;
      m.walletStore.isSyncing = false;
      m.walletStore.isLocked = false;
    });
    await header.waitFor({ state: 'hidden' });
    await page.locator('.help-embedded').waitFor();
    await readerBody.waitFor();
    await fitShot(page, shot('help-unlocked-reader.png'));
    const beforeLock = page.url();
    await page.evaluate(() => { window.helpSmokeStores.walletStore.isLocked = true; });
    await header.waitFor();
    assert.equal(page.url(), beforeLock);
    assert.equal(await page.locator('#help-reader-search').inputValue(), 'recovery');
    await readerBody.waitFor();
    assert.equal(await header.getByRole('link', { name: 'Unlock wallet' }).count() + await header.getByRole('button', { name: 'Unlock wallet' }).count(), 0, 'The header no longer carries Unlock wallet');

    // The home support widget offers the unlock while locked.
    await header.getByRole('link', { name: 'Overview' }).click();
    await page.locator('[data-test="live-chat-status"]').waitFor();
    assert.equal(await page.locator('[data-test="live-chat-status"]').innerText(), 'Unlock your wallet to start a live chat.');
    assert.ok((await page.locator('.support-action').getAttribute('href')).includes('redirect='));
    await goReader();
    await readerBody.waitFor();
    assert.equal(page.url(), beforeLock);

    // The locked email dialog carries it too, and it leads to the saved-wallet welcome screen.
    await page.getByRole('button', { name: 'Contact support about this guide' }).click();
    await page.locator('[data-test="support-notice"]').waitFor();
    await page.waitForTimeout(400);
    assert.ok((await page.locator('[data-test="support-notice"]').innerText()).includes('Unlock your wallet'));
    await fitShot(page, shot('support-email-dialog.png'));
    const unlock = dialog.getByRole('link', { name: 'Unlock wallet', exact: true });
    assert.ok((await unlock.getAttribute('href')).includes('redirect='));
    await unlock.click();
    await page.waitForURL('**#/welcome?redirect=*');
    assert.ok(page.url().includes('redirect='));
    await page.locator('.language-selector-container').waitFor();
    await page.screenshot({ path: shot('welcome-saved-help.png'), fullPage: true });
    await helpButton.click();
    await panel.waitFor();
    assert.ok((await panel.locator('[data-section="gettingBack"] h3').textContent()).includes('Getting back in'));
    await page.screenshot({ path: shot('welcome-help-panel-saved.png'), fullPage: true });
    await page.keyboard.press('Escape');
    await panel.waitFor({ state: 'detached' });
    await page.evaluate(() => { window.helpSmokeStores.walletStore.isLocked = false; });
    await readerBody.waitFor();
    assert.equal(page.url(), beforeLock);

    // --- Eligible Cardano mainnet wallet with live chat: the chat dialog comes first ---
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
    await page.getByRole('button', { name: 'Contact support about this guide' }).click();
    const question = page.locator('#help-support-question');
    const contextField = page.locator('#help-support-context');
    await question.waitFor();
    await contextField.waitFor();
    await page.waitForTimeout(400);
    assert.ok((await dialog.innerText()).includes('Your wallet is ready for live chat.'));
    const contextText = await contextField.inputValue();
    assert.ok(contextText.includes('Cardano') && contextText.includes('Guide: backup'), contextText);
    assert.ok(!contextText.includes('stake1synthetic') && !(await question.inputValue()).includes('stake1synthetic'));
    await page.screenshot({ path: shot('support-chat-dialog.png'), fullPage: true });
    await question.fill('How do I back up my recovery phrase safely?');
    await contextField.fill(`${contextText}\nEdited: yes`);
    await dialog.getByRole('button', { name: 'Start live chat', exact: true }).click();
    await page.locator('.agent-dock__input textarea').waitFor();
    const draft = await page.locator('.agent-dock__input textarea').inputValue();
    assert.ok(draft.includes('How do I back up my recovery phrase safely?') && draft.includes('Edited: yes'), draft);
    assert.ok(draft.includes('Cardano') && draft.includes('backup'));
    assert.ok(!draft.includes('stake1synthetic'));
    assert.equal(await page.evaluate(async () => (await chrome.storage.local.get('agentDockPrefs')).agentDockPrefs.hidden), true, 'Dock prefs stay hidden');
    // The dialog closes when the dock opens (Vuetify keeps its empty, inert wrapper in the DOM, so wait on the sheet).
    await page.locator('.support-sheet').waitFor({ state: 'hidden' });
    await page.screenshot({ path: shot('help-support-context.png'), fullPage: true });
    await page.evaluate(() => { window.helpSmokeStores.featureFlagsStore.state.flags.isLiveChatEnabled = false; });
    await page.locator('[data-test="support-notice"]').waitFor();
    assert.ok((await page.locator('[data-test="support-notice"]').innerText()).includes('unavailable'));
    await dialog.getByRole('button', { name: 'Close', exact: true }).click();
    await page.locator('[data-test="support-notice"]').waitFor({ state: 'hidden' });

    await page.goto(`${base}/index.html#/blog`);
    await page.waitForURL('**#/help/updates?source=blog*');
    assert.ok(page.url().includes('source=blog'));
    assert.equal(requests.filter(url => /chatwoot|support\.gerowallet|support-chat/i.test(url)).length, 0, 'No chat identity/message created before Send');
    assert.deepEqual(errors, []);

    // --- Anonymous usage counters: counts only, never who or what was typed ---
    await page.waitForTimeout(2600); // Events are posted after 2 s without a new one.
    const events = anonymousEvents(assert, eventBodies, ['90001', '90002', 'stake1synthetic', HERO_QUERY, WELCOME_QUERY, 'Help smoke wallet', 'Support smoke wallet']);
    fs.writeFileSync(shot('usage-events.json'), JSON.stringify(events, null, 2));
    const seen = (type, surface, subject) => events.some(event => event.type === type && event.surface === surface && (subject === undefined || event.subject === subject));
    const expected = [
      ['article_view', 'help', 'backup'], // a reader view
      ['search', 'help', 'results'], // the hero search, by outcome
      ['home_click', 'help', 'topic'], // a real click on a topic tile
      ['support_open', 'help', 'noWallets'], ['support_open', 'help', 'locked'], ['support_open', 'help', 'eligible'], // each dialog state
      ['support_chat_started', 'help'],
      ['welcome_open', 'welcome', 'new'], ['welcome_open', 'welcome', 'setup'], ['welcome_open', 'welcome', 'saved'], // each welcome state
      ['welcome_open_full', 'welcome'],
      ['search', 'welcome', 'empty'], // the panel search, by outcome
      ['article_view', 'welcome', 'restore'], // an in-panel answer
    ];
    // Reported together so one gap does not hide the others.
    assert.deepEqual(expected.filter(entry => !seen(...entry)).map(entry => entry.join(':')), [], 'Usage events that should have been counted but were not');
    console.log(JSON.stringify({ stage: 'complete', errors, blockedExternalRequests: requests.length, usageEvents: events.length, profile, screenshots: out }));
    fs.writeFileSync(shot('browser-results.json'), JSON.stringify({ errors, blockedExternalRequests: requests.length, usageEvents: events, passed: true }, null, 2));
  } catch (error) {
    const page = context.pages().at(-1);
    if (page) {
      await page.screenshot({ path: shot('help-smoke-failure.png'), fullPage: true }).catch(() => {});
      console.error((await page.locator('body').innerText().catch(() => '')).slice(0, 3000));
    }
    console.error({ errors });
    throw error;
  } finally { await context.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
