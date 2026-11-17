// The one min-UTxO rule of the Gero market: `(160 + canonical size) * coinsPerUtxoByte`, with the
// protocol parameter capped at the reviewed ceiling. verifyBuy (what a payee output may be raised
// to) and the royalty choice (which entries are too small to keep) both read it from here.
import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { minAdaRequired } from '@cardano-sdk/tx-construction';
import { DEFAULT_COINS_PER_UTXO_BYTE } from '@/shared/utils/txIntentGuard';
import { inlineDatumFromCbor } from '@/shared/utils/utxoCbor';
import { HexBlob } from '@cardano-sdk/util';
import { MIN_UTXO_OVERHEAD_BYTES, effectiveCoinsPerUtxoByte, minUtxoOf } from './minUtxo';

const ADDRESS = Cardano.BaseAddress.fromCredentials(
  Cardano.NetworkId.Testnet,
  { hash: '41'.repeat(28) as never, type: Cardano.CredentialType.KeyHash },
  { hash: '42'.repeat(28) as never, type: Cardano.CredentialType.KeyHash },
).toAddress().toBech32();

const tagged = (coins: bigint): Cardano.TxOut => ({
  address: Cardano.PaymentAddress(ADDRESS),
  value: { coins },
  datum: inlineDatumFromCbor(HexBlob(`5820${'00'.repeat(32)}`)),
});

describe('minUtxoOf', () => {
  it('is (160 + size) * coinsPerUtxoByte over the canonical encoding: 108 bytes, 1,155,080 at 4310', () => {
    expect(MIN_UTXO_OVERHEAD_BYTES).toBe(160n);
    expect(minUtxoOf(tagged(2_000_000n), 4310n)).toBe(1_155_080n);
    expect(minUtxoOf(tagged(2_000_000n), 4310n)).toBe(minAdaRequired(tagged(2_000_000n), 4310n));
  });

  it('scales with the protocol parameter', () => {
    expect(minUtxoOf(tagged(2_000_000n), 8620n)).toBe(2n * 1_155_080n);
    expect(minUtxoOf(tagged(2_000_000n), 4000n)).toBeLessThan(1_155_080n);
  });

  it('measures the output as the ledger would write it, whatever its coin: a larger coin may take more bytes', () => {
    expect(minUtxoOf(tagged(1n), 4310n)).toBeLessThan(minUtxoOf(tagged(5_000_000_000n), 4310n));
  });
});

describe('effectiveCoinsPerUtxoByte', () => {
  it('is the reviewed ceiling when the store has no figure', () => {
    expect(effectiveCoinsPerUtxoByte(undefined)).toBe(DEFAULT_COINS_PER_UTXO_BYTE);
  });

  it('passes a lower figure through and caps a higher one at the ceiling (an inflated figure must not talk a verifier into overpayment)', () => {
    expect(effectiveCoinsPerUtxoByte(4000n)).toBe(4000n);
    expect(effectiveCoinsPerUtxoByte(DEFAULT_COINS_PER_UTXO_BYTE)).toBe(DEFAULT_COINS_PER_UTXO_BYTE);
    expect(effectiveCoinsPerUtxoByte(DEFAULT_COINS_PER_UTXO_BYTE + 1n)).toBe(DEFAULT_COINS_PER_UTXO_BYTE);
    expect(effectiveCoinsPerUtxoByte(999_999n)).toBe(DEFAULT_COINS_PER_UTXO_BYTE);
  });

  it('is null for a figure that cannot be used: not a bigint, zero or negative', () => {
    expect(effectiveCoinsPerUtxoByte(0n)).toBeNull();
    expect(effectiveCoinsPerUtxoByte(-1n)).toBeNull();
    expect(effectiveCoinsPerUtxoByte(4310 as unknown as bigint)).toBeNull();
    expect(effectiveCoinsPerUtxoByte('4310' as unknown as bigint)).toBeNull();
  });
});
