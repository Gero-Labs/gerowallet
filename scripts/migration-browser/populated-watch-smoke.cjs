/* Read-only populated-wallet browser check. Uses a fresh profile and public Watch record. */
const { chromium } = require('playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');

const repo = path.resolve(__dirname, '../..');
const extension = process.env.WATCH_SMOKE_EXTENSION || path.join(repo, 'extension');
const out = process.env.WATCH_SMOKE_OUTPUT || path.join(repo, 'output/migration-populated-watch');
const address = process.env.WATCH_SMOKE_ADDRESS;
assert.ok(address?.startsWith('addr1'), 'WATCH_SMOKE_ADDRESS must contain the authorized public mainnet address');
fs.mkdirSync(out, { recursive: true });
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gero-public-watch-'));
const record = { id: 1, name: 'Read-only review wallet', type: 'Watch', watchAddress: address,
  publicKey: '', theme: 'Gero', chain: 'Cardano', network: 'Mainnet', order: 1, icon: '' };
function artifactDigest() {
  const digest = createHash('sha256');
  function visit(directory, prefix = '') {
    for (const name of fs.readdirSync(directory).sort()) {
      const file = path.join(directory, name);
      const relative = `${prefix}${name}`;
      if (fs.statSync(file).isDirectory()) visit(file, `${relative}/`);
      else digest.update(relative).update('\0').update(createHash('sha256').update(fs.readFileSync(file)).digest('hex')).update('\n');
    }
  }
  visit(extension);
  return digest.digest('hex');
}
const report = { startedAt: new Date().toISOString(), extension, profile, checks: [], errors: [], blockedRequests: [],
  runtimeConsoleErrors: [], otherConsoleErrors: [], networkConsoleErrorCount: 0,
  publicBackendRequestCount: 0,
  artifactSha256: artifactDigest(),
  fixtureBoundary: 'Only a public Watch wallet record is seeded. All balances, assets, NFTs and transactions come through real production login, public sync, database loaders and broadcasts. No store fields are pinned or overridden.',
  approvalBoundary: 'Approval presentation uses a previously confirmed public transaction supplied through a fixture popup port. No approval, signature, or submission is dispatched.',
  coverageLimits: [
    'Fresh profile with a seeded Watch record, not an existing-profile upgrade or hardware-wallet check.',
    'Only wallet backend and sync hosts are reachable. Third-party prices/images can be unavailable; this checks populated rendering and clone safety, not complete live fiat valuation.',
  ],
};
let context;
let worker;
let page;
let stage = 'launch';
const check = name => { report.checks.push(name); console.log(JSON.stringify({ check: name })); };
const safeError = text => text.replace(/(?:addr|stake|asset)(?:_test)?1[a-z0-9]+/g, '[public identifier]')
  .replace(/\b[0-9a-f]{32,}\b/gi, '[hex data]').replace(/https?:\/\/\S+/g, '[URL]').slice(0, 250);
async function launch() {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true, viewport: { width: 1440, height: 1100 },
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE api.gerowallet.io, EXCLUDE sync.gerowallet.io'],
  });
  await context.route(/^https?:/, async route => {
    const url = new URL(route.request().url());
    if (['api.gerowallet.io', 'sync.gerowallet.io'].includes(url.hostname)
      && !/(?:submit|broadcast|signTransaction|signTx|signData)/i.test(url.pathname)) return route.continue();
    report.blockedRequests.push({ host: url.hostname, method: route.request().method() });
    await route.abort();
  });
  context.on('page', target => target.on('pageerror', error => report.errors.push({ stage, message: error.message })));
  context.on('request', request => {
    if (['api.gerowallet.io', 'sync.gerowallet.io'].includes(new URL(request.url()).hostname)) report.publicBackendRequestCount++;
  });
  context.on('console', message => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/DataCloneError|could not be cloned|TypeError|ReferenceError|SyntaxError|Unhandled error|Error in render|Cannot (?:read|convert|access)|is not (?:a function|defined)|structuredClone/i.test(text)) {
      report.runtimeConsoleErrors.push({ stage, message: safeError(text) });
    } else if (/Failed to load resource|Network Error|ERR_|fetch|Axios|websocket|Cardano Shield|sync|Nexus|api\./i.test(text)) {
      report.networkConsoleErrorCount++;
    } else report.otherConsoleErrors.push({ stage, message: safeError(text) });
  });
  await context.addInitScript(() => {
    // Defense in depth for this read-only harness. No test action clicks Sign,
    // Confirm or Send; any accidental transaction message fails before dispatch.
    if (!globalThis.chrome?.runtime?.sendMessage) return;
    const nativeSend = chrome.runtime.sendMessage.bind(chrome.runtime);
    chrome.runtime.sendMessage = (...args) => {
      if (/(?:sign|submit|broadcast|send.*tx|reveal|privatekey)/i.test(String(args[0]?.method || ''))) {
        throw new Error('Read-only review forbids transaction/secret operations');
      }
      return nativeSend(...args);
    };
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker', { timeout: 30000 });
  report.extensionId = worker.url().split('/')[2];
  report.chromium = context.browser().version();
  return `chrome-extension://${report.extensionId}`;
}
async function observe(target) {
  await target.evaluate(() => {
    // Hash navigation retains this document and its live subscription. Replacing
    // it would discard observed fields from stores that only broadcast changes.
    if (window.__watchReviewObserver) return;
    const state = { walletId: null, tokenCount: 0, collectionCount: 0, transactionCount: 0, assetCount: 0, syncing: true, updates: 0 };
    const port = chrome.runtime.connect({ name: 'store-sync' });
    const chunks = new Map();
    const applyUpdate = (storeName, update) => {
      if (storeName === 'walletStore') {
        if ('loggedWallet' in update) state.walletId = update.loggedWallet?.id ?? null;
        if ('tokens' in update) state.tokenCount = Object.keys(update.tokens || {}).length;
        if ('collections' in update) state.collectionCount = Object.keys(update.collections || {}).length;
        if ('transactions' in update) state.transactionCount = update.transactions?.length ?? 0;
        if ('isSyncing' in update) state.syncing = update.isSyncing;
      }
      if (storeName === 'networkStore' && 'assets' in update) state.assetCount = Object.keys(update.assets || {}).length;
      state.updates++;
    };
    port.onMessage.addListener(message => {
      if (message.type === 'STORE_UPDATE') applyUpdate(message.storeName, message.updates);
      // Large production snapshots use the same JSON update split across messages.
      // Observe both transport forms without replacing or pinning application state.
      if (message.type !== 'STORE_UPDATE_CHUNK') return;
      const pending = chunks.get(message.updateId) || { parts: [], received: 0 };
      if (pending.parts[message.chunkIndex] === undefined) pending.received++;
      pending.parts[message.chunkIndex] = message.data;
      chunks.set(message.updateId, pending);
      if (pending.received === message.totalChunks) {
        applyUpdate(message.storeName, JSON.parse(pending.parts.join('')));
        chunks.delete(message.updateId);
      }
    });
    port.postMessage({ type: 'STORE_SUBSCRIBE', storeName: 'walletStore' });
    port.postMessage({ type: 'STORE_SUBSCRIBE', storeName: 'networkStore' });
    window.__watchReviewObserver = { state, port };
  });
}
async function capture(name) {
  await page.screenshot({ path: path.join(out, `${name}.png`), fullPage: true });
  fs.writeFileSync(path.join(out, `${name}.txt`), await page.locator('body').innerText());
}

(async () => {
  try {
    let base = await launch();
    page = await context.newPage();
    await page.goto(`${base}/index.html#/welcome`);
    await page.waitForFunction(async () => (await indexedDB.databases()).some(db => db.name === 'GeroWalletDatabase' && db.version >= 160), null, { timeout: 30000 });
    await page.waitForFunction(async () => !!(await chrome.storage.local.get('geroStore')).geroStore, null, { timeout: 30000 });
    stage = 'seed public watch record';
    assert.equal(new URL(worker.url()).host, new URL(page.url()).host, 'Watch setup worker and page must belong to the same extension');
    // The page can finish schema setup before the worker. Opening too early in
    // the worker can create an empty v1 database; inspect readiness without opening.
    report.seedDatabaseVersion = await worker.evaluate(async () => {
      const deadline = Date.now() + 30000;
      while (Date.now() < deadline) {
        const database = (await indexedDB.databases()).find(db => db.name === 'GeroWalletDatabase');
        if (database?.version >= 160) return database.version;
        await new Promise(resolve => setTimeout(resolve, 250));
      }
      throw new Error('Watch setup timed out waiting for the worker database schema; no record was seeded');
    });
    await worker.evaluate(async record => {
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('GeroWalletDatabase');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        if (!db.objectStoreNames.contains('wallets')) throw new Error(`Watch setup found database v${db.version} stores: ${Array.from(db.objectStoreNames).join(',')}`);
        await new Promise((resolve, reject) => {
          const tx = db.transaction('wallets', 'readwrite');
          tx.objectStore('wallets').put({ ...record, passwordLastUpdate: new Date() });
          tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
        });
      } finally { db.close(); }
    }, record);
    await context.close();
    base = await launch();
    page = await context.newPage();
    await page.goto(`${base}/index.html#/welcome`);
    await observe(page);
    stage = 'real public watch login and sync';
    await page.evaluate(record => {
      window.__watchReviewLogin = { status: 'pending' };
      void chrome.runtime.sendMessage({ method: 'LOGIN', data: { wallet: record }, target: 'gerowallet', sender: 'options' })
        .then(response => { window.__watchReviewLogin = { status: response?.data?.success ? 'success' : 'failed', error: response?.error?.message || null }; });
    }, record);
    for (let elapsed = 0; elapsed < 330; elapsed += 10) {
      await page.waitForTimeout(10000);
      const state = await page.evaluate(() => ({ ...window.__watchReviewObserver.state, login: window.__watchReviewLogin }));
      console.log(JSON.stringify({ stage, elapsedSeconds: elapsed + 10, state }));
      report.state = state;
      if (state.login.status === 'failed') throw new Error(`Watch login failed: ${state.login.error}`);
      if (state.login.status === 'success' && !state.syncing && state.assetCount > 0 && state.transactionCount > 0) break;
    }
    assert.equal(report.state.login.status, 'success', 'Real LOGIN must complete');
    assert.ok(report.state.assetCount > 0 && report.state.tokenCount > 0, 'Public sync must deliver populated asset and token stores');
    assert.ok(report.state.transactionCount > 0, 'Public sync must deliver history');
    report.postLoginState = { ...report.state };
    check('Real production Watch login hydrates populated token and transaction stores from public mainnet data');
    stage = 'dashboard and portfolio';
    await page.goto(`${base}/index.html#/`);
    await observe(page);
    await page.locator('.liquid-glass-nav-drawer').waitFor({ timeout: 30000 });
    await page.locator('.market-token-table').waitFor({ timeout: 45000 });
    await page.locator('.market-token-table .token-ticker').first().waitFor();
    await capture('watch-dashboard');
    report.holdingsRowCount = await page.locator('.market-token-table .token-ticker').count();
    assert.ok(report.holdingsRowCount > 1, 'Dashboard must render native tokens alongside ADA');
    await page.waitForFunction(() => {
      const state = window.__watchReviewObserver.state;
      return state.walletId === 1 && state.tokenCount > 0 && state.assetCount > 0 && state.transactionCount > 0;
    }, null, { timeout: 30000 });
    report.state = await page.evaluate(() => ({ ...window.__watchReviewObserver.state }));
    check('Populated dashboard renders navigation drawer and portfolio token rows');
    const collectibles = page.getByText('Collectibles', { exact: true }).first();
    if (await collectibles.count()) {
      await collectibles.click();
      await page.waitForTimeout(1500);
      await capture('watch-collectibles');
      if (report.state.collectionCount > 0) check('Collectibles view opens with the live wallet collection state');
      else report.coverageLimits.push('The supplied public address has no live NFT collections; the empty collectibles view is checked, but populated NFT acceptance remains open.');
    }
    stage = 'transactions';
    await page.goto(`${base}/index.html#/transactions`);
    await page.locator('.tx-page').waitFor({ timeout: 30000 });
    await page.locator('.tx-page .tx-row').first().waitFor();
    await capture('watch-transactions');
    check('Transactions view renders public history with populated asset metadata');
    const archived = await worker.evaluate(async () => {
      const chainDb = await new Promise((resolve, reject) => {
        const request = indexedDB.open('Cardano_Mainnet');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      const metadata = await new Promise((resolve, reject) => {
        const request = chainDb.transaction('assets').objectStore('assets').getAll();
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      chainDb.close();
      const byUnit = new Map(metadata.map(asset => [asset.asset, asset]));
      const assetUnits = row => (row.body?.outputs || []).flatMap(output =>
        output.value?.assets instanceof Map ? [...output.value.assets.keys()] : Object.keys(output.value?.assets || {}));
      const db = await new Promise((resolve, reject) => {
        const request = indexedDB.open('wallet-1');
        request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
      });
      try {
        return await new Promise((resolve, reject) => {
          const request = db.transaction('transactions').objectStore('transactions').getAll();
          request.onsuccess = () => {
            // Pick an asset whose metadata is actually in the reactive network
            // store, so this exercises the clone boundary rather than undefined.
            const tx = request.result.find(row => row.cbor && assetUnits(row).some(unit => byUnit.has(unit)));
            if (!tx) return resolve(null);
            const asset = byUnit.get(assetUnits(tx).find(unit => byUnit.has(unit)));
            const decodedName = new TextDecoder().decode(Uint8Array.from((asset.asset_name || '').match(/.{2}/g) || [], byte => parseInt(byte, 16)));
            const labels = [asset.metadata?.name, asset.metadata?.ticker, asset.onchain_metadata?.name, decodedName]
              .filter(label => typeof label === 'string' && label.length > 0);
            resolve({ cbor: tx.cbor, id: tx.id || tx.tx_hash, labels });
          };
          request.onerror = () => reject(request.error);
        });
      } finally { db.close(); }
    });
    assert.ok(archived?.cbor, 'Public history must contain a token-bearing transaction with CBOR');
    assert.ok(archived.labels.length > 0, 'Selected token must have a metadata-backed display label');
    await page.goto(`${base}/index.html#/transactions?tx=${archived.id}`);
    await page.locator('.tx-split__detail').waitFor();
    // Token pills are created only when this disclosure is open. A transaction
    // may contain tokens in another output without a token movement in our ledger.
    const utxos = page.locator('.tx-split__detail .tx-section__head').filter({ hasText: 'UTxOs' });
    if (await utxos.getAttribute('aria-expanded') !== 'true') await utxos.click();
    for (const more of await page.locator('.tx-split__detail .tx-io-more').all()) await more.click();
    for (const more of await page.locator('.tx-split__detail .tx-utxo .tx-more').all()) await more.click();
    await page.waitForFunction(labels => [...document.querySelectorAll('.tx-split__detail .tx-pill__name, .tx-split__detail .tx-ledger')]
      .some(element => labels.some(label => element.textContent.includes(label))), archived.labels, { timeout: 30000 });
    report.transactionDetailTokenLabelCount = await page.locator('.tx-split__detail .tx-pill__name').count();
    await capture('watch-transaction-detail');
    check('A token-bearing transaction opens its full details without clone errors');
    stage = 'archived transaction approval presentation';
    await worker.evaluate(cbor => {
      chrome.runtime.onConnect.addListener(port => {
        if (port.name !== 'internal-background-popup-communication') return;
        port.onMessage.addListener(message => {
          if (message.method === 'requestData') port.postMessage({ data: { tx: cbor }, method: 'signTx' });
          if (message.method === 'returnData') throw new Error('Read-only review never accepts approval results');
        });
      });
    }, archived.cbor);
    await page.goto(`${base}/index.html#/sign-tx?website=https%3A%2F%2Freview.invalid`);
    await page.locator('.tx-details').waitFor({ timeout: 30000 });
    await page.locator('.tx-details .tx-asset-pill').first().hover();
    await page.locator('.tx-asset-tooltip .tx-asset-name').first().waitFor();
    report.approvalOutputCount = await page.locator('.tx-details .tx-output-row').count();
    report.approvalAssetLabelCount = await page.locator('.tx-asset-tooltip .tx-asset-name').count();
    assert.ok(report.approvalOutputCount > 0 && report.approvalAssetLabelCount > 0, 'Approval must render outputs and asset labels');
    await capture('watch-approval-presentation');
    check('Production sign-tx popup presents an archived token transaction; no signing or approval action is taken');
    report.approvalArchivedCborPresent = true;
    report.success = report.errors.length === 0 && report.runtimeConsoleErrors.length === 0;
    assert.deepEqual(report.errors, [], 'Populated routes must not raise page errors');
    assert.deepEqual(report.runtimeConsoleErrors, [], 'Populated routes must not log clone, render, type, reference or syntax errors');
  } catch (error) {
    report.success = false;
    report.failure = { stage, message: error.message };
    if (page && !page.isClosed()) await capture('watch-failure').catch(() => {});
    process.exitCode = 1;
  } finally {
    report.artifactSha256After = artifactDigest();
    if (report.artifactSha256After !== report.artifactSha256) {
      report.success = false;
      report.failure = { stage: 'artifact immutability', message: 'Artifact bytes changed during the browser run' };
      process.exitCode = 1;
    }
    report.completedAt = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'populated-watch-report.json'), JSON.stringify(report, null, 2));
    await context?.close();
    console.log(JSON.stringify({ success: report.success, checks: report.checks, failure: report.failure }));
  }
})();
