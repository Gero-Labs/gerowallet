/**
 * Source tripwires for the CIP-113 signing wiring in background.ts and walletBg.ts, which
 * unit tests cannot load. The pieces are tested on their own (cip113Allowance,
 * cip113PrepareTransfer, cip113Guard, cip113SignAllowance.walletBg); these pin that every
 * dApp entry still refuses, and that only Gero's own Send can use the allowance.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// Normalize CRLF (Windows checkouts) before slicing on newline delimiters.
const read = (rel: string) => readFileSync(join(__dirname, '..', rel), 'utf8').replace(/\r\n/g, '\n');
const bg = read('chrome/background.ts');
const walletBg = read('chrome/walletBg.ts');

/** From `marker` to the next top-level `app.add…` registration (or the end). */
function section(src: string, marker: string): string {
  const start = src.indexOf(marker);
  expect(start, `${marker} not found`).toBeGreaterThan(-1);
  const next = src.indexOf('\napp.add', start + marker.length);
  return src.slice(start, next < 0 ? undefined : next);
}

function functionBody(src: string, signature: string): string {
  const start = src.indexOf(signature);
  expect(start, `${signature} not found`).toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('\n}\n', start));
}

describe('CIP-113 signing wiring', () => {
  it('every dApp signing entry refuses programmable inputs before its prompt opens', () => {
    expect(section(bg, 'app.add(METHOD.signTx,')).toContain('dappSignRefusal(request.data?.tx)');
    expect(section(bg, "case 'signTx': {")).toContain('dappSignRefusal(params.tx)');
    expect(bg).toContain('dappSignRefusal(wcTx)');
    expect(bg).toContain('dappSignRefusal(unsignedCbor)');
    expect(functionBody(bg, 'function dappSignRefusal(')).toContain('refusalForProgrammableInputs(txCbor)');
  });

  it('the dApp refusal never reads the Send allowance, and checks the PLG tripwire', () => {
    const body = functionBody(bg, 'function refusalForProgrammableInputs(');
    expect(body).not.toMatch(/Cip113SignAllowance/);
    expect(body).toContain('cip113TransferNeedsOwnKey(');
    expect(functionBody(bg, 'function dappSignRefusal(')).not.toMatch(/Cip113SignAllowance/);
  });

  // The allowance covers one verified CIP-113 transfer; it never lets a transaction marked to fail through.
  it('the hardware refusal keeps any refusal but the CIP-113 one before it reads the allowance', () => {
    const body = functionBody(bg, 'function hardwareSignRefusal(');
    const kept = body.indexOf('if (refusal !== CIP113_SIGN_REFUSAL_MESSAGE) return refusal;');
    expect(kept).toBeGreaterThan(-1);
    expect(kept).toBeLessThan(body.indexOf('hasCip113SignAllowance('));
    expect(section(bg, 'app.addToOptions(MessageTypes.CIP113_SIGN_PREFLIGHT,')).toContain('message: refusal');
    expect(section(bg, 'app.addToOptions(MessageTypes.TREZOR,')).toContain('throw new Error(trezorRefusal)');
  });

  it('the prepare handler grants the allowance only for what prepareCip113Transfer verified', () => {
    const body = section(bg, 'app.addToOptions(MessageTypes.CIP113_PREPARE_TRANSFER,');
    const prepared = body.indexOf('await prepareCip113Transfer(');
    const granted = body.indexOf('grantCip113SignAllowance(wallet.id, prepared.txId, prepared.programmableRefs)');
    expect(prepared).toBeGreaterThan(-1);
    expect(granted).toBeGreaterThan(prepared);
    // The CBOR goes back exactly as built.
    expect(body).toContain('txCbor: prepared.txCbor');
  });

  it('only the hardware refusal and the prepare handler touch the allowance in the worker', () => {
    const uses = bg.split('\n').filter((line) => /Cip113SignAllowance\(/.test(line));
    expect(uses.map((line) => line.trim().slice(0, 40))).toEqual([
      expect.stringContaining('if (wallet && hasCip113SignAllowance('),
      expect.stringContaining('grantCip113SignAllowance('),
    ]);
    expect(functionBody(bg, 'function hardwareSignRefusal(')).toContain('hasCip113SignAllowance(');
  });

  it('the preflight and the TREZOR handler both go through the hardware refusal', () => {
    expect(section(bg, 'app.addToOptions(MessageTypes.CIP113_SIGN_PREFLIGHT,')).toContain('hardwareSignRefusal(request.data?.txCbor)');
    expect(section(bg, 'app.addToOptions(MessageTypes.TREZOR,')).toContain('hardwareSignRefusal(txCbor)');
    // Every other caller of the hardware refusal would be a dApp path that must not read the allowance.
    expect(bg.match(/hardwareSignRefusal\(/g)).toHaveLength(3);
  });

  it('WalletBg.signTx checks the allowance before decrypting and uses it up before signing', () => {
    const body = walletBg.slice(walletBg.indexOf('  async signTx('), walletBg.indexOf('  async submitTx('));
    const check = body.indexOf('hasCip113SignAllowance(this.id, transaction.id, programmableInputs)');
    const decrypt = body.indexOf('this.decryptRootPrivateKey(password)');
    const consume = body.indexOf('consumeCip113SignAllowance(this.id, transaction.id, programmableInputs)');
    const sign = body.indexOf('.sign(HexBlob(transaction.id))');
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(decrypt);
    expect(consume).toBeGreaterThan(decrypt);
    expect(consume).toBeLessThan(sign);
  });
});
