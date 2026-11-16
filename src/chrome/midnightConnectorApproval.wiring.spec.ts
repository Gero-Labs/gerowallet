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

describe('a decline after a failed build says the build failed', () => {
  const panel = read('sidepanel/components/DAppOverlay.vue');

  it('every connector build records its failure', () => {
    expect(panel).toContain('return recordBuildFailure(() => buildAndSignUnshieldedTransfer(');
    expect(panel).toContain('return recordBuildFailure(() => balanceConnectorTransaction(');
    expect(panel).toContain('return recordBuildFailure(() => buildConnectorIntent(');
  });

  it('the PassKey prompt and the prover-consent ask are not build failures', () => {
    const start = panel.indexOf('async function recordBuildFailure<T>(');
    const body = panel.slice(start, panel.indexOf('\n}\n', start));
    expect(body).toContain('e instanceof StaleApprovalError');
    expect(body).toContain("'ProvingConsentRequiredError'");
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

  it('a request switch forgets the failure', () => {
    expect(panel).toContain('watch(() => currentRequest.value?.requestId, () => { buildFailureCode.value = null; });');
  });
});
