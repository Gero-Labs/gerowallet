/**
 * Source tripwires for the market signing guard in background.ts and walletBg.ts, which unit
 * tests cannot load. The pieces are tested on their own (marketGuard, marketAllowance,
 * marketSign.walletBg); these pin where the guard sits: beside the CIP-113 checks in
 * WalletBg.signTx, in the hardware refusal, and nowhere on a dApp's way in.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Normalize CRLF (Windows checkouts) before slicing on newline delimiters.
const read = (rel: string) => readFileSync(join(__dirname, '..', '..', rel), 'utf8').replace(/\r\n/g, '\n');
const bg = read('chrome/background.ts');
const walletBg = read('chrome/walletBg.ts');

function functionBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, `${signature} not found`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('\n}\n', start));
}

describe('NFT market signing wiring', () => {
  const signTx = walletBg.slice(walletBg.indexOf('  async signTx('), walletBg.indexOf('  async submitTx('));

  it('WalletBg.signTx checks the market allowance before decrypting and uses it up before signing', () => {
    const check = signTx.indexOf('hasMarketSignAllowance(this.id, transaction.id, marketHits)');
    const decrypt = signTx.indexOf('this.decryptRootPrivateKey(password)');
    const authorized = signTx.indexOf('assertAuthorized?.()');
    const consume = signTx.indexOf('consumeMarketSignAllowance(this.id, transaction.id, marketHits)');
    const sign = signTx.indexOf('.sign(HexBlob(transaction.id))');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(decrypt);
    expect(consume).toBeGreaterThan(authorized);
    expect(consume).toBeLessThan(sign);
  });

  it('the market check sits beside, and after, the CIP-113 check', () => {
    const cip113Check = signTx.indexOf('hasCip113SignAllowance(this.id, transaction.id, programmableInputs)');
    const marketCheck = signTx.indexOf('hasMarketSignAllowance(this.id, transaction.id, marketHits)');
    const cip113Consume = signTx.indexOf('consumeCip113SignAllowance(this.id, transaction.id, programmableInputs)');
    const marketConsume = signTx.indexOf('consumeMarketSignAllowance(this.id, transaction.id, marketHits)');
    expect(cip113Check).toBeGreaterThan(-1);
    expect(marketCheck).toBeGreaterThan(cip113Check);
    expect(marketConsume).toBeGreaterThan(cip113Consume);
  });

  it('what counts as a market touch is the wallet\'s own deployments and verified listings', () => {
    const body = functionBody(walletBg, '  findMarketTouch(transaction: Cardano.Tx): string[] {');
    expect(body).toContain('networks.resolveNftMarketDeployments(this.chain, this.network)');
    expect(body).toContain('WalletStore.state.listedListings');
    // A guard, not UI: the feature flag has no say.
    expect(body).not.toMatch(/isNftMarketEnabled/);
  });

  it('only the hardware refusal reads the market allowance in the worker, and nothing there uses it up', () => {
    // The grant belongs to the prepare handlers (later); here, one read and no consume.
    expect(bg.match(/hasMarketSignAllowance\(/g)).toHaveLength(1);
    expect(bg).not.toMatch(/consumeMarketSignAllowance\(/);
    expect(functionBody(bg, 'function marketSignRefusal(')).toContain('hasMarketSignAllowance(');
  });

  it('the hardware refusal includes the market refusal, with its own message', () => {
    const body = functionBody(bg, 'function hardwareSignRefusal(');
    expect(body).toContain('marketSignRefusal(txCbor)');
    expect(body).toContain('NFT_MARKET_SIGN_REFUSAL_MESSAGE');
    expect(body).toContain('CIP113_SIGN_REFUSAL_MESSAGE');
  });

  it('no dApp entry refuses a market touch up front: the dApp refusal never reads the market guard', () => {
    const body = functionBody(bg, 'function refusalForProgrammableInputs(');
    expect(body).not.toMatch(/Market/);
    expect(bg.match(/refusalForProgrammableInputs\(/g)!.length).toBeGreaterThan(4);
    // The market refusal is not used on any of those paths.
    expect(bg.match(/marketSignRefusal\(/g)).toHaveLength(2); // its definition and the hardware refusal
  });

  it('the preflight tells the page which refusal it is, and the TREZOR handler throws that message', () => {
    expect(bg).toContain('...(refusal ? { message: refusal.message } : {})');
    expect(bg).toContain('throw new Error(trezorRefusal.message)');
  });
});
