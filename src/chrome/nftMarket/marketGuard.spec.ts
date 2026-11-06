// What makes a transaction a market transaction, for the signing guard: an output at one of the
// Gero listing scripts (it creates a listing, whoever's stake key is in the address) or an input
// that is one of the wallet's own listings (it spends one). Reference inputs and collateral do not
// count, and an unrelated transaction yields nothing.
import { describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { findMarketTouch } from './marketGuard';
import { NFT_MARKET_DEPLOYMENTS_PREPROD, type NftMarketDeployment } from '@/utils/nftMarketDeployments';

const V1: NftMarketDeployment = NFT_MARKET_DEPLOYMENTS_PREPROD[0];
const V2: NftMarketDeployment = { ...V1, version: 2, scriptHash: '9'.repeat(56) };

const OWN_STAKE = '2122232425262728292a2b2c2d2e2f303132333435363738393a3b3c';
const OTHER_STAKE = '4142434445464748494a4b4c4d4e4f505152535455565758595a5b5c';
const KEY_HASH = '0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c';
const NFT = `${'b'.repeat(56)}${Buffer.from('NFT').toString('hex')}`;

const TX_A = 'a1'.repeat(32);
const TX_B = 'b2'.repeat(32);
const TX_C = 'c3'.repeat(32);

const key = (hash: string) => ({ hash: Hash28ByteBase16(hash), type: Cardano.CredentialType.KeyHash });
const script = (hash: string) => ({ hash: Hash28ByteBase16(hash), type: Cardano.CredentialType.ScriptHash });

const baseAt = (hash: string, stake = OWN_STAKE) =>
  Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Testnet, script(hash), key(stake)).toAddress().toBech32() as Cardano.PaymentAddress;
const enterpriseAt = (hash: string) =>
  Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Testnet, script(hash)).toAddress().toBech32() as Cardano.PaymentAddress;
// By hand: the SDK's PointerAddress.fromCredentials gives a script payment the wrong header type.
// Header 0x50 = pointer address with a script payment part, testnet; then the hash and the
// pointer's three naturals (slot 1, tx index 2, cert index 3).
const pointerAt = (hash: string) =>
  Cardano.Address.fromBytes(HexBlob(`50${hash}010203`)).toBech32() as Cardano.PaymentAddress;
const keyAddress = (hash = KEY_HASH, stake = OWN_STAKE) =>
  Cardano.BaseAddress.fromCredentials(Cardano.NetworkId.Testnet, key(hash), key(stake)).toAddress().toBech32() as Cardano.PaymentAddress;

const out = (address: Cardano.PaymentAddress, withNft = false): Cardano.TxOut => ({
  address,
  value: { coins: 2_000_000n, ...(withNft ? { assets: new Map([[Cardano.AssetId(NFT), 1n]]) } : {}) },
});

const input = (txId: string, index: number): Cardano.TxIn => ({ txId: Cardano.TransactionId(txId), index });

function tx(parts: {
  inputs?: Cardano.TxIn[];
  outputs?: Cardano.TxOut[];
  referenceInputs?: Cardano.TxIn[];
  collaterals?: Cardano.TxIn[];
}): Cardano.Tx {
  return {
    id: Cardano.TransactionId('00'.repeat(32)),
    body: { inputs: parts.inputs ?? [input(TX_A, 0)], outputs: parts.outputs ?? [out(keyAddress())], fee: 200_000n, ...(parts.referenceInputs ? { referenceInputs: parts.referenceInputs } : {}), ...(parts.collaterals ? { collaterals: parts.collaterals } : {}) },
    witness: { signatures: new Map() },
  } as Cardano.Tx;
}

const NO_LISTINGS: ReadonlySet<string> = new Set();
const OWN_REF = `${TX_B}#1`;
const OWN_LISTINGS: ReadonlySet<string> = new Set([OWN_REF, `${TX_C}#0`]);

describe('findMarketTouch: creating a listing', () => {
  it('flags an output at a deployment script, with the index', () => {
    const hits = findMarketTouch(tx({ outputs: [out(keyAddress()), out(baseAt(V1.scriptHash), true)] }), [V1], NO_LISTINGS);
    expect(hits).toEqual(['creates-listing:1']);
  });

  it('flags the script whatever the stake part: the wallet\'s, another key, none, or a pointer', () => {
    for (const address of [baseAt(V1.scriptHash, OWN_STAKE), baseAt(V1.scriptHash, OTHER_STAKE), enterpriseAt(V1.scriptHash), pointerAt(V1.scriptHash)]) {
      expect(findMarketTouch(tx({ outputs: [out(address, true)] }), [V1], NO_LISTINGS)).toEqual(['creates-listing:0']);
    }
  });

  it('flags every deployed version, not only the newest', () => {
    const hits = findMarketTouch(tx({ outputs: [out(baseAt(V2.scriptHash), true), out(baseAt(V1.scriptHash), true)] }), [V2, V1], NO_LISTINGS);
    expect(hits).toEqual(['creates-listing:0', 'creates-listing:1']);
    // A version that is not configured is not a Gero script.
    expect(findMarketTouch(tx({ outputs: [out(baseAt(V2.scriptHash), true)] }), [V1], NO_LISTINGS)).toEqual([]);
  });

  it('lists every such output in index order', () => {
    const outputs = [out(baseAt(V1.scriptHash), true), out(keyAddress()), out(baseAt(V1.scriptHash, OTHER_STAKE), true), out(enterpriseAt(V1.scriptHash))];
    expect(findMarketTouch(tx({ outputs }), [V1], NO_LISTINGS)).toEqual(['creates-listing:0', 'creates-listing:2', 'creates-listing:3']);
  });

  it('ignores a key address, another script, and a key credential that has a script hash\'s bytes', () => {
    const outputs = [out(keyAddress()), out(baseAt('7'.repeat(56))), out(enterpriseAt('8'.repeat(56))), out(keyAddress(V1.scriptHash))];
    expect(findMarketTouch(tx({ outputs }), [V1], NO_LISTINGS)).toEqual([]);
  });

  it('flags nothing when no deployment is configured', () => {
    expect(findMarketTouch(tx({ outputs: [out(baseAt(V1.scriptHash), true)] }), [], NO_LISTINGS)).toEqual([]);
  });

  it('does not throw on an output address it cannot read', () => {
    const odd = out('not-an-address' as Cardano.PaymentAddress);
    expect(findMarketTouch(tx({ outputs: [odd, out(baseAt(V1.scriptHash), true)] }), [V1], NO_LISTINGS)).toEqual(['creates-listing:1']);
  });
});

describe('findMarketTouch: spending an own listing', () => {
  it('flags an input that is one of the wallet\'s listings', () => {
    const hits = findMarketTouch(tx({ inputs: [input(TX_A, 0), input(TX_B, 1)] }), [V1], OWN_LISTINGS);
    expect(hits).toEqual([`spends-listing:${OWN_REF}`]);
  });

  it('matches txId and index together', () => {
    // Same transaction, another output; another transaction, same index.
    expect(findMarketTouch(tx({ inputs: [input(TX_B, 0), input(TX_A, 1)] }), [V1], OWN_LISTINGS)).toEqual([]);
  });

  it('flags every own listing spent, in input order', () => {
    const hits = findMarketTouch(tx({ inputs: [input(TX_C, 0), input(TX_A, 0), input(TX_B, 1)] }), [V1], OWN_LISTINGS);
    expect(hits).toEqual([`spends-listing:${TX_C}#0`, `spends-listing:${OWN_REF}`]);
  });

  it('does not count reference inputs or collateral', () => {
    const hits = findMarketTouch(tx({ referenceInputs: [input(TX_B, 1)], collaterals: [input(TX_C, 0)] }), [V1], OWN_LISTINGS);
    expect(hits).toEqual([]);
  });

  it('flags a spend even when no deployment is configured', () => {
    expect(findMarketTouch(tx({ inputs: [input(TX_B, 1)] }), [], OWN_LISTINGS)).toEqual([`spends-listing:${OWN_REF}`]);
  });
});

describe('findMarketTouch: both, neither', () => {
  it('a reprice-shaped transaction lists the creation first, then the spend', () => {
    const hits = findMarketTouch(tx({ inputs: [input(TX_B, 1)], outputs: [out(baseAt(V1.scriptHash), true)] }), [V1], OWN_LISTINGS);
    expect(hits).toEqual(['creates-listing:0', `spends-listing:${OWN_REF}`]);
  });

  it('an unrelated transaction yields nothing', () => {
    expect(findMarketTouch(tx({}), [V1, V2], OWN_LISTINGS)).toEqual([]);
    expect(findMarketTouch(tx({}), [], NO_LISTINGS)).toEqual([]);
  });

  it('is deterministic: the same transaction gives the same answer, and does not change its inputs', () => {
    const t = tx({ inputs: [input(TX_C, 0), input(TX_B, 1)], outputs: [out(baseAt(V1.scriptHash), true), out(enterpriseAt(V1.scriptHash))] });
    const first = findMarketTouch(t, [V1], OWN_LISTINGS);
    expect(findMarketTouch(t, [V1], OWN_LISTINGS)).toEqual(first);
    expect(first).toEqual(['creates-listing:0', 'creates-listing:1', `spends-listing:${TX_C}#0`, `spends-listing:${OWN_REF}`]);
  });

  it('copes with a transaction that has no outputs or inputs listed', () => {
    expect(findMarketTouch({ id: Cardano.TransactionId('00'.repeat(32)), body: { fee: 0n } } as unknown as Cardano.Tx, [V1], OWN_LISTINGS)).toEqual([]);
  });
});
