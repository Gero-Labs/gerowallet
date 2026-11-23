import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { bech32 } from 'bech32';
import { Ed25519PublicKey, Ed25519Signature } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { WalletBg } from '@/chrome/walletBg';
import { getPaymentKeyExternal, getStakeKey } from '@/chrome/serialization';
import { Blockchain, CoinTypes, HARDENED, Network, WalletType, WalletTypePurpose } from '@/models/types';
import { buildCardanoTransaction } from './builder';
import { holderAnswerFields } from './holderAnswers';
import { resolvePrivateKey } from './resolver';
import type { VoteIntent } from './voteBuilder';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));

// Published mainnet vector in CIP-0204, block 13983648.
const stake = '4d85d4526012e2b4aab72be47325ec86e04950b18591e83d4b326736';
const hashes = [
  'f6fd3678f12edc58dd8739560149fcdb0b8b6fc77a5f303d49c87c74d1fccb4c',
  '75e7882a8ef2bc39517bffbfb654e89f525def5a8364d81e11fc5facafc6dd9b',
  '418df5986f50547ec4a709f1a5bce6b850753ad6614c873386b7c953fee84a9f',
];
const answers: VoteIntent[] = hashes.map((hash, i) => ({ govActionId: `${hash}#0`, choice: i ? 'No' : 'Yes' }));

describe('CIP-0204 holder answers', () => {
  it('reproduces all 156 bytes of the published metadata and requires the named stake key', () => {
    const { auxiliaryData, requiredExtraSignatures } = holderAnswerFields(stake, answers);
    expect(Serialization.GeneralTransactionMetadata.fromCore(auxiliaryData.blob).toCbor()).toBe(
      `a119069fa30001018200581c${stake}028382825820${hashes[0]}000182825820${hashes[1]}000082825820${hashes[2]}0000`);
    expect(requiredExtraSignatures).toEqual([stake]);
  });

  it('encodes Abstain and the largest uint16 index and refuses ambiguous or invalid answers', () => {
    const one = { govActionId: `${hashes[0]}#65535`, choice: 'Abstain' } as const;
    const { auxiliaryData } = holderAnswerFields(stake, [one]);
    expect(Serialization.GeneralTransactionMetadata.fromCore(auxiliaryData.blob).toCbor()).toMatch(/19ffff02$/);
    expect(() => holderAnswerFields(stake, [])).toThrow();
    expect(() => holderAnswerFields(stake, [one, one])).toThrow();
    expect(() => holderAnswerFields(stake, [{ ...one, govActionId: `${hashes[0]}#65536` }])).toThrow();
    expect(() => holderAnswerFields('00', [one])).toThrow();
    expect(() => holderAnswerFields(stake, [{ ...one, choice: 'Maybe' } as unknown as VoteIntent])).toThrow();
  });

  it('funds one fee and signs the complete reviewed body with payment and stake keys', async () => {
    // Public test vector, disconnected wallet and synthetic input.
    const root = resolvePrivateKey(`${'abandon '.repeat(23)}art`);
    const account = root.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED]).toPublic();
    const publicKey = bech32.encode('xpub', bech32.toWords(account.bytes()), 1023);
    const wallet = new WalletBg({ id: 204, chain: Blockchain.CARDANO, network: Network.PREPROD,
      name: 'holder test', type: WalletType.Normal, publicKey } as ConstructorParameters<typeof WalletBg>[0]);
    const keys = wallet.resolvePathsForMissingAddresses([]);
    const address = Cardano.PaymentAddress(keys.payment[0].address);
    const utxos: Cardano.Utxo[] = [[
      { txId: Cardano.TransactionId('11'.repeat(32)), index: 0, address }, { address, value: { coins: 8_000_000n } },
    ]];
    const tx = await buildCardanoTransaction({
      ...holderAnswerFields(keys.stake[0].cred, answers), utxos, changeAddress: address, walletContext: { keys },
      tip: { slot: 1000 }, invalidHereafter: Cardano.Slot(1010),
      epochParams: { minFeeCoefficient: 44, minFeeConstant: 155381, coinsPerUtxoByte: 4310, maxValueSize: 5000,
        maxTxSize: 16384, prices: { memory: 0.0577, steps: 0.0000721 } },
    });
    expect(tx.body.validityInterval.invalidHereafter).toBe(1010);
    expect(tx.body.votingProcedures).toBeUndefined();
    expect(tx.body.certificates).toBeUndefined();
    expect(tx.body.outputs).toHaveLength(1);
    expect(tx.body.outputs[0].address).toBe(address);
    expect(tx.body.outputs[0].value.coins + tx.body.fee).toBe(8_000_000n);
    const serialized = Serialization.Transaction.fromCore(tx);
    const { witnesses } = await wallet.signTx(serialized.toCbor(), '', utxos, keys, root.bytes());
    const signed = Serialization.TransactionWitnessSet.fromCbor(Serialization.TxCBOR(witnesses));
    expect(signed.vkeys().values().map(w => w.vkey()).sort()).toEqual(
      [getPaymentKeyExternal(publicKey, 0).hex(), getStakeKey(publicKey, 0).hex()].sort());
    for (const witness of signed.vkeys().values()) {
      expect(Ed25519PublicKey.fromHex(witness.vkey()).verify(
        Ed25519Signature.fromHex(witness.signature()), HexBlob(serialized.getId()))).toBe(true);
    }
    serialized.setWitnessSet(signed);
    const submitted = Serialization.Transaction.fromCbor(serialized.toCbor()).toCore();
    expect(submitted.body.requiredExtraSignatures).toEqual([keys.stake[0].cred]);
    expect(submitted.body.auxiliaryDataHash).toBe(Cardano.computeAuxiliaryDataHash(submitted.auxiliaryData));
    expect(tx.body.fee).toBeGreaterThanOrEqual(155381n + 44n * BigInt(serialized.toCbor().length / 2));
  });
});
