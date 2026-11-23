import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { bech32 } from 'bech32';
import { Ed25519PublicKey, Ed25519Signature, Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { minAdaRequired } from '@cardano-sdk/tx-construction';
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
const epochParams = { minFeeCoefficient: 44, minFeeConstant: 155381, coinsPerUtxoByte: 4310, maxValueSize: 5000,
  maxTxSize: 16384, prices: { memory: 0.0577, steps: 0.0000721 } };

// Each input fits, but combining both token bundles yields a 6,581-byte value.
function tokenInputs(address: Cardano.PaymentAddress): Cardano.Utxo[] {
  return [4, 8].map(n => {
    const policy = n.toString(16).padStart(56, '0');
    const assets = new Map(Array.from({ length: 93 }, (_, i) =>
      [Cardano.AssetId(policy + i.toString(16).padStart(64, '0')), 1n] as const));
    const minimum = minAdaRequired({ address, value: { coins: 30_000_000n, assets } }, 4310n);
    return [{ txId: Cardano.TransactionId(n.toString(16).padStart(64, '0')), index: 0, address },
      { address, value: { coins: minimum + 305_000n, assets } }];
  });
}

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

  it.each([false, true])('funds and signs the reviewed body, including split token change when needed (tokens: %s)', async tokens => {
    // Public test vector, disconnected wallet and synthetic input.
    const root = resolvePrivateKey(`${'abandon '.repeat(23)}art`);
    const account = root.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED]).toPublic();
    const publicKey = bech32.encode('xpub', bech32.toWords(account.bytes()), 1023);
    const wallet = new WalletBg({ id: 204, chain: Blockchain.CARDANO, network: Network.PREPROD,
      name: 'holder test', type: WalletType.Normal, publicKey } as ConstructorParameters<typeof WalletBg>[0]);
    const keys = wallet.resolvePathsForMissingAddresses([]);
    const address = Cardano.PaymentAddress(keys.payment[0].address);
    const utxos: Cardano.Utxo[] = tokens ? tokenInputs(address) : [[
      { txId: Cardano.TransactionId('11'.repeat(32)), index: 0, address }, { address, value: { coins: 8_000_000n } },
    ]];
    const buildOptions = {
      ...holderAnswerFields(keys.stake[0].cred, answers), utxos, changeAddress: address, walletContext: { keys },
      tip: { slot: 1000 }, invalidHereafter: Cardano.Slot(1010),
      epochParams,
    };
    const tx = await buildCardanoTransaction(buildOptions);
    expect(tx.body.validityInterval.invalidHereafter).toBe(1010);
    expect(tx.body.votingProcedures).toBeUndefined();
    expect(tx.body.certificates).toBeUndefined();
    expect(tx.body.outputs).toHaveLength(tokens ? 2 : 1);
    for (const output of tx.body.outputs) {
      expect(output.address).toBe(address);
      expect(Serialization.Value.fromCore(output.value).toCbor().length / 2).toBeLessThanOrEqual(epochParams.maxValueSize);
      expect(output.value.coins).toBeGreaterThanOrEqual(minAdaRequired(output, 4310n));
    }
    expect(tx.body.outputs.reduce((sum, out) => sum + out.value.coins, tx.body.fee))
      .toBe(utxos.reduce((sum, [, out]) => sum + out.value.coins, 0n));
    expect(tx.body.outputs.flatMap(o => [...(o.value.assets ?? [])]).sort())
      .toEqual(utxos.flatMap(([, o]) => [...(o.value.assets ?? [])]).sort());
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
    const signedSize = serialized.toCbor().length / 2;
    expect(tx.body.fee).toBeGreaterThanOrEqual(155381n + 44n * BigInt(signedSize));
    await expect(buildCardanoTransaction({
      ...buildOptions, epochParams: { ...epochParams, maxTxSize: signedSize - 1 },
    })).rejects.toThrow('Maximum Input Count Exceeded');
  });

  it.each([2_000_000n, -2_000_000n])('balances withdrawals, a deposit or refund, and an explicit output (%s)', async deposit => {
    const address = Cardano.PaymentAddress('addr_test1qqydn46r6mhge0kfpqmt36m6q43knzsd9ga32n96m89px3nuzcjqw982pcftgx53fu5527z2cj2tkx2h8ux2vxsg475qypp3m9');
    const stakeCredential = Cardano.Address.fromBech32(address).asBase()!.getStakeCredential();
    const reward = Cardano.RewardAccount.fromCredential(stakeCredential, Cardano.NetworkId.Testnet);
    const tx = await buildCardanoTransaction({ epochParams, changeAddress: address, tip: { slot: 1000 }, implicitCoin: deposit,
      certificates: [deposit > 0n
        ? { __typename: Cardano.CertificateType.Registration, stakeCredential: { type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16(stake) }, deposit }
        : { __typename: Cardano.CertificateType.Unregistration, stakeCredential, deposit: -deposit }],
      withdrawals: [{ stakeAddress: reward, quantity: 3_000_000n }],
      outputs: [{ address, value: { coins: 2_000_000n } }],
      utxos: [[{ txId: Cardano.TransactionId('11'.repeat(32)), index: 0, address }, { address, value: { coins: 8_000_000n } }]],
    });
    expect(tx.body.outputs[0].value.coins).toBe(2_000_000n);
    expect(tx.body.outputs.reduce((n, o) => n + o.value.coins, tx.body.fee)).toBe(11_000_000n - deposit);
  });
});
