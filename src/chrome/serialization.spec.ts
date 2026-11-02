import { describe, it, expect } from 'vitest';
import { Serialization, Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { classifyUtxoAddress, coalesceValueQuantities } from './serialization';

// Regression for @cardano-sdk/core 0.47: Value.multiasset() returns undefined
// for an ADA-only value (0.46 returned an empty Map), so coalesceValueQuantities
// called setMultiasset(undefined) and threw "Cannot read properties of undefined
// (reading 'size')" — crashing getBalance / the portfolio page on any ADA-only
// wallet.
describe('coalesceValueQuantities (SDK 0.47 multiasset undefined)', () => {
  const ada = (n: bigint) => new Serialization.Value(n);
  const withAsset = (n: bigint, assetId: string, qty: bigint) =>
    new Serialization.Value(n, new Map<Cardano.AssetId, bigint>([[assetId as Cardano.AssetId, qty]]));
  const ASSET = '1234567890123456789012345678901234567890123456789012345678'; // policy+name hex

  it('sums ADA-only values without throwing', () => {
    const out = coalesceValueQuantities([ada(1000000n), ada(2500000n)]);
    expect(out.coin()).toBe(3500000n);
    // multiasset stays absent/empty for a pure-ADA total
    expect(out.multiasset() === undefined || out.multiasset()!.size === 0).toBe(true);
  });

  it('handles a mix of ADA-only and asset-bearing values', () => {
    const out = coalesceValueQuantities([ada(1000000n), withAsset(2000000n, ASSET, 5n)]);
    expect(out.coin()).toBe(3000000n);
    expect(out.multiasset()!.get(ASSET as Cardano.AssetId)).toBe(5n);
  });

  it('accumulates the same asset across values', () => {
    const out = coalesceValueQuantities([withAsset(1000000n, ASSET, 3n), withAsset(1000000n, ASSET, 4n)]);
    expect(out.coin()).toBe(2000000n);
    expect(out.multiasset()!.get(ASSET as Cardano.AssetId)).toBe(7n);
  });

  it('is a no-op-safe on an empty list', () => {
    const out = coalesceValueQuantities([]);
    expect(out.coin()).toBe(0n);
  });
});

// The Gero NFT market's `listed` partition. A listing sits at the listing script's address
// with the seller's own stake key in the stake slot, so gero-sync returns it as the user's: it
// must be diverted from the spendable set, and a listing under someone else's stake must be
// dropped. Ordering matters as for CIP-113: the spendable checks run first and the CIP-113
// branch before this one, and with no listed hash configured nothing changes.
describe('classifyUtxoAddress: Gero market listed partition', () => {
  const NETWORK_ID = Cardano.NetworkId.Testnet;
  const LISTED = '558802cc2e2f21e4e13662cdf73f979ce0140e7dbd7ce13911a9063d';
  const LISTED_V2 = '1111111111111111111111111111111111111111111111111111aaaa';
  const PLB = 'a48744c1584c58c2995cba1fa26b37f3999ee8cedac0ef241662f53d';
  const OWN_PAYMENT = '00000000000000000000000000000000000000000000000000000001';
  const OWN_STAKE = '00000000000000000000000000000000000000000000000000000002';
  const STRANGER = '000000000000000000000000000000000000000000000000000000ff';

  const ownPayment = new Set([OWN_PAYMENT]);
  const owners = new Set([OWN_PAYMENT, OWN_STAKE]);
  const listedSet = new Set([LISTED]);
  const plbSet = new Set([PLB]);
  const none = new Set<string>();

  function base(payment: string, paymentType: Cardano.CredentialType, stake: string, stakeType: Cardano.CredentialType): string {
    return Cardano.BaseAddress.fromCredentials(
      NETWORK_ID,
      { hash: Hash28ByteBase16(payment), type: paymentType },
      { hash: Hash28ByteBase16(stake), type: stakeType },
    ).toAddress().toBech32();
  }
  const SCRIPT = Cardano.CredentialType.ScriptHash;
  const KEY = Cardano.CredentialType.KeyHash;

  const listedOwn = base(LISTED, SCRIPT, OWN_STAKE, KEY);
  const listedOther = base(LISTED, SCRIPT, STRANGER, KEY);

  it('is listed for the listing script under the wallet\'s own stake key', () => {
    expect(classifyUtxoAddress(listedOwn, ownPayment, none, owners, listedSet)).toBe('listed');
  });

  it('is listed-other under another stake key', () => {
    expect(classifyUtxoAddress(listedOther, ownPayment, none, owners, listedSet)).toBe('listed-other');
  });

  it('is listed-other when the stake slot holds a script credential', () => {
    expect(classifyUtxoAddress(base(LISTED, SCRIPT, OWN_STAKE, SCRIPT), ownPayment, none, owners, listedSet)).toBe('listed-other');
  });

  it('recognises every configured version', () => {
    const both = new Set([LISTED, LISTED_V2]);
    expect(classifyUtxoAddress(base(LISTED_V2, SCRIPT, OWN_STAKE, KEY), ownPayment, none, owners, both)).toBe('listed');
    expect(classifyUtxoAddress(listedOwn, ownPayment, none, owners, both)).toBe('listed');
  });

  it('requires a script credential in the payment slot', () => {
    expect(classifyUtxoAddress(base(LISTED, KEY, OWN_STAKE, KEY), ownPayment, none, owners, listedSet)).toBe('foreign');
  });

  it('leaves another script under the own stake key foreign', () => {
    expect(classifyUtxoAddress(base(STRANGER, SCRIPT, OWN_STAKE, KEY), ownPayment, none, owners, listedSet)).toBe('foreign');
  });

  it('keeps the wallet\'s own address spendable', () => {
    const own = base(OWN_PAYMENT, KEY, OWN_STAKE, KEY);
    expect(classifyUtxoAddress(own, ownPayment, none, owners, listedSet)).toBe('spendable');
    expect(classifyUtxoAddress(own, ownPayment, plbSet, owners, listedSet)).toBe('spendable');
  });

  it('lets a CIP-113 hash win its own branch', () => {
    const plbOwn = base(PLB, SCRIPT, OWN_STAKE, KEY);
    expect(classifyUtxoAddress(plbOwn, ownPayment, plbSet, owners, listedSet)).toBe('programmable');
    expect(classifyUtxoAddress(base(PLB, SCRIPT, STRANGER, KEY), ownPayment, plbSet, owners, listedSet)).toBe('programmable-other');
    // Even when the same hash is configured on both lists, CIP-113 is decided first.
    expect(classifyUtxoAddress(listedOwn, ownPayment, listedSet, owners, listedSet)).toBe('programmable');
  });

  it('classifies a listing even while the CIP-113 gate is shut', () => {
    expect(classifyUtxoAddress(listedOwn, ownPayment, none, owners, listedSet)).toBe('listed');
    expect(classifyUtxoAddress(listedOwn, ownPayment, plbSet, owners, listedSet)).toBe('listed');
  });

  describe('with no listed hash configured', () => {
    const addresses: Record<string, string> = {
      own: base(OWN_PAYMENT, KEY, OWN_STAKE, KEY),
      stranger: base(STRANGER, KEY, OWN_STAKE, KEY),
      listedOwn,
      listedOther,
      plbOwn: base(PLB, SCRIPT, OWN_STAKE, KEY),
      plbOther: base(PLB, SCRIPT, STRANGER, KEY),
      enterpriseOwn: Cardano.EnterpriseAddress.fromCredentials(NETWORK_ID, {
        hash: Hash28ByteBase16(OWN_PAYMENT),
        type: KEY,
      }).toAddress().toBech32(),
      enterpriseStranger: Cardano.EnterpriseAddress.fromCredentials(NETWORK_ID, {
        hash: Hash28ByteBase16(STRANGER),
        type: KEY,
      }).toAddress().toBech32(),
      garbage: 'not-an-address',
      empty: '',
    };

    it.each(Object.entries(addresses))('gives %s the same answer as before the listed branch existed', (_name, address) => {
      for (const plb of [none, plbSet]) {
        const before = classifyUtxoAddress(address, ownPayment, plb, owners);
        expect(classifyUtxoAddress(address, ownPayment, plb, owners, none)).toBe(before);
        expect(['spendable', 'programmable', 'programmable-other', 'foreign']).toContain(before);
      }
    });

    it('keeps a listing-script address foreign, never listed', () => {
      expect(classifyUtxoAddress(listedOwn, ownPayment, none, owners)).toBe('foreign');
      expect(classifyUtxoAddress(listedOwn, ownPayment, plbSet, owners, none)).toBe('foreign');
    });

    it('keeps unparseable addresses spendable where no gate is active', () => {
      expect(classifyUtxoAddress('not-an-address', ownPayment, none, owners, none)).toBe('spendable');
    });
  });

  // A listed hash turns the server-side payment-credential filter off (subscriptionCredentials
  // sends []), so these fallbacks are then the only gate and have to fail closed, as for CIP-113.
  describe('a configured listed hash closes the gate', () => {
    it('drops unparseable addresses', () => {
      expect(classifyUtxoAddress('not-an-address', ownPayment, none, owners, listedSet)).toBe('foreign');
      expect(classifyUtxoAddress('', ownPayment, none, owners, listedSet)).toBe('foreign');
    });

    it('drops a stranger\'s enterprise address but keeps the wallet\'s own', () => {
      const stranger = Cardano.EnterpriseAddress.fromCredentials(NETWORK_ID, {
        hash: Hash28ByteBase16(STRANGER),
        type: KEY,
      }).toAddress().toBech32();
      const own = Cardano.EnterpriseAddress.fromCredentials(NETWORK_ID, {
        hash: Hash28ByteBase16(OWN_PAYMENT),
        type: KEY,
      }).toAddress().toBech32();
      expect(classifyUtxoAddress(stranger, ownPayment, none, owners, listedSet)).toBe('foreign');
      expect(classifyUtxoAddress(own, ownPayment, none, owners, listedSet)).toBe('spendable');
    });
  });
});
