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
