import { describe, expect, it } from 'vitest';
import {
  SOLANA_SIGN_MESSAGE_MAX_BYTES,
  describeSolanaMessage,
  looksLikeSolanaTransaction,
  solanaSignMessageRefusal,
} from './solanaSignMessage';
import { buildSolTransferMessage } from './solanaTransaction';
import { deriveSolanaKeypairFromMnemonic } from './solanaKeyManager';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const text = (s: string) => new TextEncoder().encode(s);

/** A legacy message with one key, the blockhash and one instruction carrying `data`. */
function legacyMessage(data: number[]): Uint8Array {
  return new Uint8Array([1, 0, 0, 1, ...new Array(32).fill(7), ...new Array(32).fill(9), 1, 0, 1, 0, data.length, ...data]);
}

describe('looksLikeSolanaTransaction', () => {
  it('recognises a real transfer message, and the whole signed transaction', () => {
    const from = deriveSolanaKeypairFromMnemonic(MNEMONIC, 0).address;
    const to = deriveSolanaKeypairFromMnemonic(MNEMONIC, 1).address;
    const message = buildSolTransferMessage({
      from, to, lamports: 1000n, recentBlockhash: '11111111111111111111111111111111',
      computeUnitLimit: 200_000, computeUnitPriceMicroLamports: 1n,
    });
    expect(looksLikeSolanaTransaction(message)).toBe(true);
    const signed = new Uint8Array([1, ...new Array(64).fill(3), ...message]);
    expect(looksLikeSolanaTransaction(signed)).toBe(true);
  });

  it('recognises legacy and v0 shapes built by hand', () => {
    expect(looksLikeSolanaTransaction(legacyMessage([2, 0, 0, 0]))).toBe(true);
    const v0 = new Uint8Array([0x80, ...legacyMessage([2]), 0]);
    expect(looksLikeSolanaTransaction(v0)).toBe(true);
  });

  it('leaves login text and near misses alone', () => {
    expect(looksLikeSolanaTransaction(text('example.com wants you to sign in with your Solana account'))).toBe(false);
    expect(looksLikeSolanaTransaction(legacyMessage([2]).slice(0, -1))).toBe(false); // truncated
    expect(looksLikeSolanaTransaction(new Uint8Array([...legacyMessage([2]), 0]))).toBe(false); // trailing byte
    expect(looksLikeSolanaTransaction(new Uint8Array([0x81, ...legacyMessage([2]), 0]))).toBe(false); // version 1
  });
});

describe('solanaSignMessageRefusal', () => {
  it('refuses empty, oversized and transaction-shaped bytes, and allows text', () => {
    expect(solanaSignMessageRefusal(new Uint8Array())).toBe('EMPTY');
    expect(solanaSignMessageRefusal(new Uint8Array(SOLANA_SIGN_MESSAGE_MAX_BYTES + 1).fill(65))).toBe('TOO_LARGE');
    expect(solanaSignMessageRefusal(legacyMessage([2]))).toBe('LOOKS_LIKE_TRANSACTION');
    expect(solanaSignMessageRefusal(text('Sign in to example.com'))).toBeNull();
  });
});

describe('describeSolanaMessage', () => {
  it('shows readable UTF-8 as text and anything else as hex', () => {
    expect(describeSolanaMessage(text('Hello\nwörld'))).toEqual({ kind: 'text', text: 'Hello\nwörld' });
    expect(describeSolanaMessage(new Uint8Array([0xff, 0x00, 0x10]))).toEqual({ kind: 'hex', hex: 'ff0010' });
    expect(describeSolanaMessage(new Uint8Array([0x41, 0x00]))).toEqual({ kind: 'hex', hex: '4100' });
  });
});
