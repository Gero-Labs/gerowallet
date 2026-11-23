import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Source tripwires for how the Midnight connector's prompts reach the side
// panel and how a failed build is answered. Found on a mainnet run
// (2026-11-16): makeTransfer gave the panel 5 s to connect for the dapp's tab
// and failed whenever it was closed, opened in another window or slow;
// a transfer the wallet could not pay reached Nexus and came back as an
// outage; and a decline after a failed build told the dapp the user declined.
// Line endings normalized: a Windows checkout (core.autocrlf) has CRLF files.
const read = (path: string) => readFileSync(join(__dirname, '..', path), 'utf8').replace(/\r\n/g, '\n');

/** The body of `app.add(MIDNIGHT_METHOD.<name>, …)`, up to the next handler. */
function handler(source: string, name: string): string {
  const start = source.indexOf(`app.add(MIDNIGHT_METHOD.${name}, `);
  expect(start, name).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('\napp.add(', start + 10));
}

describe('Midnight prompts wait for the panel instead of failing after 5 s', () => {
  const bg = read('chrome/background.ts');

  it.each(['connect', 'signData', 'makeTransfer', 'makeIntent', 'balanceUnsealedTransaction'])('%s is parked until its tab\'s panel connects', (name) => {
    const body = handler(bg, name);
    expect(body).toContain(`parkMidnightRequest(MIDNIGHT_METHOD.${name}, `);
    expect(body).not.toContain('waitForMiniGeroPort(');
    expect(body).not.toContain('sendToMiniGero(');
  });
});

describe('makeTransfer answers InsufficientFunds before prompting', () => {
  it('checks the synced UTxOs against the summed outputs after validation and before parking', () => {
    const body = handler(read('chrome/background.ts'), 'makeTransfer');
    const validated = body.indexOf('const validation = validateMakeTransferInputs(data, currentWallet.network);');
    const check = body.indexOf('if (uncoveredIntentInput(transferOutputTotals(validation.outputs), midnightStoreSync)) {');
    const parked = body.indexOf('parkMidnightRequest(MIDNIGHT_METHOD.makeTransfer, ');
    expect(validated).toBeGreaterThan(-1);
    expect(check).toBeGreaterThan(validated);
    expect(body.indexOf('MidnightErrorCode.InsufficientFunds', check)).toBeGreaterThan(check);
    expect(parked).toBeGreaterThan(check);
  });
});

// The behaviour is in useConnectorBuildFailure.spec.ts, midnightBuildFailure.spec.ts
// and midnightParkedPrompts.spec.ts; these pin that the panel and worker use it.
describe('a decline after a failed build says the build failed', () => {
  const panel = read('sidepanel/components/DAppOverlay.vue');

  it('every connector build goes through the request-bound failure record', () => {
    expect(panel).toContain('const buildFailure = useConnectorBuildFailure(() => currentRequest.value?.requestId);');
    expect(panel).toContain('return buildFailure.record(() => buildAndSignUnshieldedTransfer(');
    expect(panel).toContain('return buildFailure.record(() => balanceConnectorTransaction(');
    expect(panel).toContain('return buildFailure.record(() => buildConnectorIntent(');
  });

  it.each([
    ['rejectMidnightMakeTransfer', "midnightDecline('this transfer', 'User declined the transfer request')"],
    ['rejectMidnightBalance', "midnightDecline('this transaction', 'User declined the balancing request')"],
    ['rejectMidnightIntent', "midnightDecline('this intent', 'User declined the intent request')"],
  ])('%s answers through midnightDecline', (name, call) => {
    const start = panel.indexOf(`function ${name}() {`);
    expect(start, name).toBeGreaterThan(-1);
    expect(panel.slice(start, panel.indexOf('\n}\n', start))).toContain(call);
  });

  it('only the build steps are marked, after the key is opened', () => {
    const walletBg = read('chrome/walletBg.ts');
    for (const step of [
      'asBuildStep(() => balanceDappTransaction9(', 'asBuildStep(() => balanceDappTransaction(',
      'asBuildStep(() => buildConnectorIntent9(', 'asBuildStep(() => buildConnectorIntent(',
      'asBuildStep(() => assertMidnightTransferMatches(', 'asBuildStep(() => balanceAndSignUnshieldedTransfer(',
    ]) expect(walletBg, step).toContain(step);
    // Nexus's build of a connector transfer, on the page.
    expect(read('services/midnight-tx.service.ts')).toContain('markBuildStep(() => buildUnshielded(');
  });

  it('the worker replies carry the mark', () => {
    expect(read('chrome/background.ts').match(/\.\.\.buildFailureReply\(error\)/g)).toHaveLength(3);
  });
});

describe('parked connect prompts are bounded', () => {
  const bg = read('chrome/background.ts');

  it('a repeated connect joins the parked prompt of its tab and site', () => {
    expect(handler(bg, 'connect')).toContain('parkedMidnightConnects.join(tabId, origin, () => parkMidnightRequest(MIDNIGHT_METHOD.connect, ');
  });

  it('a decline settles the tab\'s other parked connects', () => {
    const body = handler(bg, 'connect');
    const denial = body.indexOf('recordMidnightPermissionDenial(tabId, MIDNIGHT_METHOD.connect);');
    expect(denial).toBeGreaterThan(-1);
    expect(body.indexOf('settleParkedMidnightRequests(tabId, new Set([MIDNIGHT_METHOD.connect]), {', denial)).toBeGreaterThan(denial);
  });

  it('a new top-frame document drops the tab\'s parked Midnight prompts', () => {
    const start = bg.indexOf('chrome.webNavigation?.onCommitted?.addListener((details) => {');
    expect(start).toBeGreaterThan(-1);
    const body = bg.slice(start, bg.indexOf('\n});\n', start));
    expect(body).toContain('if (!isNewTopDocument(');
    expect(body).toContain('parkedMidnightConnects.forgetTab(details.tabId);');
    expect(body).toContain('settleParkedMidnightRequests(details.tabId, PARKED_MIDNIGHT_METHODS, {');
  });
});

describe('balanceSealedTransaction reuses the balance worker path', () => {
  const bg = read('chrome/background.ts');
  const wallet = read('chrome/walletBg.ts');
  const service = read('services/midnight-tx.service.ts');

  it('the worker message carries the sealed flag to the wallet', () => {
    const start = bg.indexOf('app.addToOptions(MessageTypes.BALANCE_MIDNIGHT_CONNECTOR_TX, ');
    expect(start).toBeGreaterThan(-1);
    const body = bg.slice(start, bg.indexOf('\napp.addToOptions(', start + 10));
    expect(body).toContain('const { tx, password, prfSecret, sealed } = request.data || {};');
    expect(body).toContain("if (sealed !== undefined && typeof sealed !== 'boolean') throw new Error('Invalid sealed flag');");
    expect(body).toContain('walletBg.balanceMidnightConnectorTransaction(tx, password, prfBytes, sealed === true)');
  });

  it('the wallet balances a sealed transaction on ledger 9 only, and checks its sync before unlocking keys', () => {
    const start = wallet.indexOf('async balanceMidnightConnectorTransaction(');
    expect(start).toBeGreaterThan(-1);
    const body = wallet.slice(start, wallet.indexOf('async buildMidnightConnectorIntent(', start));
    const syncCheck = body.indexOf('if (sealed && !connectorIntentSyncReady(midnightStore)) throw new Error(MIDNIGHT_WALLET_NOT_SYNCED);');
    expect(syncCheck).toBeGreaterThan(-1);
    expect(syncCheck).toBeLessThan(body.indexOf('openMnemonicWithPassword('));
    expect(body).toContain('asBuildStep(() => balanceSealedTransaction9({');
    expect(body).toContain("if (sealed) throw new Error('balanceSealedTransaction needs a ledger 9 network');");
  });

  it('the page passes the flag and says a DUST-coin shortfall in the user\'s language', () => {
    expect(service).toContain("[MIDNIGHT_DUST_COINS_SHORT]: 'midnight.errors.dustCoinsShort',");
    const start = service.indexOf('export async function balanceConnectorTransaction(');
    const body = service.slice(start, service.indexOf('\nexport async function ', start + 10));
    expect(body).toContain('sealed = false,');
    expect(body).toContain('      sealed,');
  });
});

describe('balanceSealedTransaction: checked before prompting, shown in the balance approval', () => {
  it('validates, requires the sync, reads the prompt, checks the funds, then parks as a sealed balance request', () => {
    const body = handler(read('chrome/background.ts'), 'balanceSealedTransaction');
    const validated = body.indexOf('const validation = validateConnectorBalanceRequest(data, currentWallet.network);');
    const synced = body.indexOf('if (!connectorIntentSyncReady(midnightStore)) {');
    const prompted = body.indexOf('const prompt = await sealedBalancePrompt(');
    const funded = body.indexOf('if (uncoveredIntentInput(prompt.gives.map(');
    const parked = body.indexOf('parkMidnightRequest(MIDNIGHT_METHOD.balanceUnsealedTransaction, ');
    expect(validated).toBeGreaterThan(-1);
    expect(synced).toBeGreaterThan(validated);
    expect(prompted).toBeGreaterThan(synced);
    expect(funded).toBeGreaterThan(prompted);
    expect(body.indexOf('MidnightErrorCode.InsufficientFunds', funded)).toBeGreaterThan(funded);
    expect(parked).toBeGreaterThan(funded);
    expect(body).toContain('sealed: true');
    expect(body).toContain('WalletStore.isWhitelisted(origin)');
    expect(body).not.toContain('waitForMiniGeroPort(');
  });

  it('always answers the dapp, exactly once: a throw anywhere in the async part ends in InternalError', () => {
    const body = handler(read('chrome/background.ts'), 'balanceSealedTransaction');
    // `reply` is idempotent, so the catch-all can never answer twice.
    expect(body).toContain('const reply = replyOnce((opts: ReplyOpts) => {');
    expect(body).not.toContain('let replied');
    const asyncStart = body.indexOf('void (async () => {\n    try {\n');
    const catchAll = body.lastIndexOf("} catch {\n      // A failed import, prompt read or funds check still answers the dapp");
    expect(asyncStart).toBeGreaterThan(-1);
    expect(catchAll).toBeGreaterThan(asyncStart);
    expect(body.indexOf("reply({ error: midnightApiError(MidnightErrorCode.InternalError, 'Failed to complete the sealed transaction') });", catchAll))
      .toBeGreaterThan(catchAll);
    // The import, the prompt, the funds check and the parked prompt are all inside the try.
    for (const step of ["await import('@/stores/midnightStore')", 'await sealedBalancePrompt(', 'uncoveredIntentInput(', 'await parkMidnightRequest(']) {
      const at = body.indexOf(step);
      expect(at, step).toBeGreaterThan(asyncStart);
      expect(at, step).toBeLessThan(catchAll);
    }
  });

  it('answers with the built transaction before recording the activity, which cannot turn it into an error', () => {
    const body = handler(read('chrome/background.ts'), 'balanceSealedTransaction');
    const answered = body.indexOf('reply({ data: response.data });');
    const recorded = body.indexOf("midnightActions.recordSiteActivity(origin, { type: 'funding-done' });");
    expect(answered).toBeGreaterThan(-1);
    expect(recorded).toBeGreaterThan(answered);
  });

  it('a ledger the wallet could not read is InternalError, not the dapp\'s InvalidRequest', () => {
    const body = handler(read('chrome/background.ts'), 'balanceSealedTransaction');
    expect(body).toContain('const code = prompt.internal ? MidnightErrorCode.InternalError : MidnightErrorCode.InvalidRequest;');
    expect(body).toContain('reply({ error: midnightApiError(code, prompt.reason) });');
  });

  it('a wallet switch, lock or revoked permission during the checks answers Disconnected instead of prompting another wallet', () => {
    const body = handler(read('chrome/background.ts'), 'balanceSealedTransaction');
    // Captured synchronously, before the first await.
    const captured = body.indexOf('const { id: walletId, network: walletNetwork } = currentWallet;');
    expect(captured).toBeGreaterThan(-1);
    expect(captured).toBeLessThan(body.indexOf('void (async () => {'));
    expect(body).toContain('return now?.id === walletId && now.network === walletNetwork && !walletStore.isLocked && WalletStore.isWhitelisted(origin);');
    // Rechecked after the last await, right before the prompt is parked.
    const recheck = body.indexOf('if (!sameWalletStill()) {');
    expect(recheck).toBeGreaterThan(body.indexOf('const prompt = await sealedBalancePrompt('));
    expect(recheck).toBeGreaterThan(body.indexOf('if (uncoveredIntentInput(prompt.gives.map('));
    expect(body.indexOf('MidnightErrorCode.Disconnected', recheck)).toBeGreaterThan(recheck);
    expect(body.indexOf('await parkMidnightRequest(MIDNIGHT_METHOD.balanceUnsealedTransaction, ')).toBeGreaterThan(recheck);
    expect(body.slice(recheck, body.indexOf('await parkMidnightRequest(')).match(/\bawait\b/g)).toBeNull();
  });

  it('the funds check counts only the coins the builder may select', () => {
    const body = handler(read('chrome/background.ts'), 'balanceSealedTransaction');
    const view = body.indexOf('utxos: sealedSelectableUtxos(validation.tx, midnightSdkNetworkId(currentWallet.network), midnightStore.utxos),');
    expect(view).toBeGreaterThan(body.indexOf('const prompt = await sealedBalancePrompt('));
    expect(body.indexOf('value: give.amount })), fundable)) {', view)).toBeGreaterThan(view);
  });

  it('an unread ledger at validation is InternalError too', () => {
    const body = handler(read('chrome/background.ts'), 'balanceSealedTransaction');
    expect(body).toContain('const code = validation.internal ? MidnightErrorCode.InternalError : MidnightErrorCode.InvalidRequest;');
    expect(body).toContain('reply({ error: midnightApiError(code, validation.reason) });');
  });

  it('the page API calls the wallet instead of the stub', () => {
    const inject = read('chrome/injectMidnight.ts');
    expect(inject).toContain('return bridge.midnightBalanceSealedTransaction(tx, options);');
    expect(inject).not.toContain('notYetImplemented(');
    expect(read('chrome/midnightWebpage.ts')).toContain('method: MIDNIGHT_METHOD.balanceSealedTransaction,');
    expect(read('chrome/messaging.ts')).toContain('request.method === MIDNIGHT_METHOD.balanceSealedTransaction ||');
    expect(read('chrome/config.ts')).toContain("balanceSealedTransaction: 'midnight_balanceSealedTransaction',");
  });
});
