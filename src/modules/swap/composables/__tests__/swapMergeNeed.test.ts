// When a swap needs the wallet merged first: the aggregator selects largest first with no cap,
// so a sale the largest UTxOs one transaction holds cannot cover builds a transaction too large.
import { describe, expect, it } from 'vitest';
import type { Cardano } from '@cardano-sdk/core';
import { swapNeedsMerge } from '../swapMergeNeed';

const ADA = 1_000_000n;
const TOKEN = `${'a'.repeat(56)}474552`;
const txId = (n: number) => n.toString(16).padStart(64, '0');
function utxo(n: number, lovelace: bigint, assets?: Map<string, bigint>): Cardano.Utxo {
  return [{ txId: txId(n), index: 0 }, { address: 'own', value: { coins: lovelace, assets } }] as unknown as Cardano.Utxo;
}
// 300 UTxOs of 1 ADA: the largest 200 hold 200 ADA, the wallet 300.
const wallet = Array.from({ length: 300 }, (_, n) => utxo(n, ADA));

describe('swapNeedsMerge', () => {
  it('is true for a sale the largest UTxOs cannot cover but the wallet can', () => {
    expect(swapNeedsMerge(wallet, 'lovelace', 250n * ADA)).toBe(true);
  });

  it('counts the fees a swap takes besides the amount sold', () => {
    // 190 ADA plus about 15 ADA of fees is more than the largest 200 hold.
    expect(swapNeedsMerge(wallet, 'lovelace', 190n * ADA)).toBe(true);
    expect(swapNeedsMerge(wallet, 'lovelace', 180n * ADA)).toBe(false);
  });

  it('is false when the wallet as a whole falls short: merging would not help', () => {
    expect(swapNeedsMerge(wallet, 'lovelace', 290n * ADA)).toBe(false);
  });

  it('is false for a wallet one transaction carries, or no amount yet', () => {
    expect(swapNeedsMerge(wallet.slice(0, 200), 'lovelace', 190n * ADA)).toBe(false);
    expect(swapNeedsMerge(wallet, 'lovelace', 0n)).toBe(false);
  });

  it('is false for a token sale: its fees fit, and a token spread too thin is not merged as ADA', () => {
    const holders = Array.from({ length: 250 }, (_, n) => utxo(1000 + n, 2n * ADA, new Map([[TOKEN, 1n]])));
    expect(swapNeedsMerge([...wallet, ...holders], TOKEN, 10n)).toBe(false);
    expect(swapNeedsMerge([...wallet, ...holders], TOKEN, 250n)).toBe(false);
  });
});
