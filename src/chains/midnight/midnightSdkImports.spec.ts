// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as ledger from '@midnightntwrk/ledger-v9';
import * as shieldedV2 from 'midnight-v9-shielded/v2';
import * as dustV2 from 'midnight-v9-dust-wallet/v2';
import { createKeystore } from 'midnight-v9-unshielded-wallet/v2';

// In wallet SDK 2.0.0 `/v1` is the ledger 8 variant and `/v2` the ledger 9 one.
// Ledger WASM objects only work inside the module that made them, so a `/v2`
// capability that accepts ledger-v9 objects proves which ledger it imports.
describe('wallet SDK 2 /v2 subpaths run on ledger-v9', () => {
  it('shielded /v2 applies a ledger-v9 offer', () => {
    const keys = ledger.ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(7));
    try {
      const coin = { nonce: '22'.repeat(32), type: 'aa'.repeat(32), value: 5n };
      const offer = ledger.ZswapOffer.fromOutput(ledger.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey), coin.type, coin.value);
      const wallet = shieldedV2.CoreWallet.apply(shieldedV2.CoreWallet.initEmpty(keys, 'preview'), keys, offer);
      expect([...wallet.state.coins].map(c => c.value)).toEqual([5n]);
    } finally { keys.clear(); }
  });

  it('shielded /v1 refuses the same ledger-v9 objects', async () => {
    // Not mapped in tsconfig: nothing in the wallet imports the ledger 8 variant directly.
    const v1 = 'midnight-v9-shielded/v1';
    const shieldedV1 = await import(/* @vite-ignore */ v1) as typeof shieldedV2;
    const keys = ledger.ZswapSecretKeys.fromSeed(new Uint8Array(32).fill(7));
    try {
      const coin = { nonce: '22'.repeat(32), type: 'aa'.repeat(32), value: 5n };
      const offer = ledger.ZswapOffer.fromOutput(ledger.ZswapOutput.new(coin, 0, keys.coinPublicKey, keys.encryptionPublicKey), coin.type, coin.value);
      expect(() => shieldedV1.CoreWallet.apply(shieldedV1.CoreWallet.initEmpty(keys as never, 'preview'), keys as never, offer as never)).toThrow();
    } finally { keys.clear(); }
  });

  it('dust /v2 starts from a ledger-v9 DUST state', () => {
    const key = ledger.DustSecretKey.fromSeed(new Uint8Array(32).fill(9));
    try {
      const state = new ledger.DustLocalState(ledger.LedgerParameters.initialParameters().dust);
      const wallet = dustV2.CoreWallet.init(state, key, 'preview');
      const balance = dustV2.CoinsAndBalances.makeDefaultCoinsAndBalancesCapability({},
        () => ({ keysCapability: dustV2.Keys.makeDefaultKeysCapability() })).getWalletBalance(wallet, new Date());
      expect(balance).toBe(0n);
    } finally { key.clear(); }
  });

  it('unshielded /v2 keystore signs with tagged ledger-v9 keys', () => {
    const keystore = createKeystore({ kind: 'schnorr', secret: new Uint8Array(32).fill(1) }, 'preview');
    const payload = new Uint8Array([1, 2, 3]);
    const signature = keystore.signData(payload);
    expect(keystore.getPublicKey().tag).toBe('schnorr');
    expect(ledger.verifySignature(keystore.getPublicKey(), payload, signature)).toBe(true);
  });
});
