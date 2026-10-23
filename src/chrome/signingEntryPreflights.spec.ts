import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Tripwire over background.ts: every request entry point that can lead to a
 * Cardano signature runs its preflights before the approval UI opens.
 *
 * - signTx: the CIP-113 refusal (refusalForProgrammableInputs). Ledger and
 *   Keystone sign in the page, so the entry check is the only one they get.
 * - signData: the reserved-subject refusal (reservedSigningDomain), so no dApp
 *   or peer gets one of Gero's own proofs signed.
 */

const source = readFileSync(join(__dirname, 'background.ts'), 'utf8');

/** Body of `app.add(<name>, …)` up to the next registration. */
function handler(name: string): string {
  const start = source.indexOf(`\napp.add(${name},`);
  expect(start, name).toBeGreaterThan(0);
  const next = source.indexOf('\napp.add', start + 10);
  return source.slice(start, next < 0 ? undefined : next);
}

/** A `case '<name>': {` block inside a switch, up to the next case. */
function caseBlock(scope: string, name: string): string {
  const start = scope.indexOf(`case '${name}': {`);
  expect(start, name).toBeGreaterThan(0);
  const next = scope.indexOf('\n      case ', start + 10);
  return scope.slice(start, next < 0 ? undefined : next);
}

const cip45 = (() => {
  const start = source.indexOf('app.addToOptions(MessageTypes.CIP45_INVOKE');
  return source.slice(start, source.indexOf('\napp.', start + 10));
})();
const walletConnect = (() => {
  const start = source.indexOf('wcService.onSessionRequest = async');
  return source.slice(start, source.indexOf('// ---- Bitcoin methods ----', start));
})();

/** `check` appears in `block`, before the call that opens the approval. */
function checksBefore(block: string, check: string, route: string) {
  const at = block.indexOf(check);
  expect(at, `${check} missing`).toBeGreaterThan(0);
  expect(at, `${check} after ${route}`).toBeLessThan(block.indexOf(route));
}

describe('signTx entry points run the CIP-113 preflight first', () => {
  it('CIP-30 signTx', () => checksBefore(handler('METHOD.signTx'), 'refusalForProgrammableInputs(', 'sendToMiniGero('));
  it('WalletConnect cardano_signTx', () => checksBefore(caseBlock(walletConnect, 'cardano_signTx'), 'refusalForProgrammableInputs(', 'routeWcSigningRequest('));
  it('CIP-45 signTx', () => {
    const block = caseBlock(cip45, 'signTx');
    checksBefore(block, 'refusalForProgrammableInputs(params.tx)', 'routeCip45SigningRequest(');
    expect(block).toContain('CIP113_SIGN_REFUSAL_MESSAGE');
  });
});

describe('signData entry points refuse Gero\'s reserved subjects first', () => {
  it('CIP-30 signData', () => checksBefore(handler('METHOD.signData'), 'reservedSigningDomain(request.data?.payload)', 'sendToMiniGero('));
  it('WalletConnect cardano_signData', () => checksBefore(caseBlock(walletConnect, 'cardano_signData'), 'reservedSigningDomain(wcParams.payload)', 'routeWcSigningRequest('));
  it('CIP-45 signData', () => checksBefore(caseBlock(cip45, 'signData'), 'reservedSigningDomain(params.payload)', 'routeCip45SigningRequest('));
});
