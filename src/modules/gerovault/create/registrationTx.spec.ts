// The optional CIP-0146 registration: its auxiliary data decodes as a registration of the vault's
// own scripts, and the wallet's ordinary builder and software signer produce it, signed with the
// wallet's payment key only. A public test phrase and a synthetic input; nothing is submitted.
import 'fake-indexeddb/auto';
import { describe, expect, it, vi } from 'vitest';
import { bech32 } from 'bech32';
import { Ed25519PublicKey, Ed25519Signature } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { WalletBg } from '@/chrome/walletBg';
import { getPaymentKeyExternal } from '@/chrome/serialization';
import { Blockchain, CoinTypes, HARDENED, Network, WalletType, WalletTypePurpose } from '@/models/types';
import { resolvePrivateKey } from '@/shared/utils/resolver';
import { buildVaultFromParticipants, decodeRegistration, deriveRoleKeys, multisigAccountPublicKey } from '@/shared/gerovault';
import { testAccounts } from '@/shared/gerovault/__fixtures__/manifest';
import { buildRegistrationTx, registrationAuxiliaryData } from './registrationTx';

vi.mock('@/chrome/storeMessagingBg', () => ({ default: { broadcastUpdate: vi.fn() } }));
vi.mock('@/services/storeMessaging.service', () => ({ default: { subscribe: vi.fn() } }));

const epochParams = { minFeeCoefficient: 44, minFeeConstant: 155381, coinsPerUtxoByte: 4310, maxValueSize: 5000,
  maxTxSize: 16384, prices: { memory: 0.0577, steps: 0.0000721 } };

async function testVault() {
  const people = await Promise.all((await testAccounts()).slice(0, 3)
    .map(async a => deriveRoleKeys(multisigAccountPublicKey(a.toPublic().hex()))));
  return buildVaultFromParticipants({ template: { kind: 'standard', threshold: 2 }, owners: people.map((roleKeys, i) => ({ roleKeys, index: i + 1 })) });
}

describe('CIP-0146 registration transaction', () => {
  it('carries a registration of the vault\'s scripts under label 1854, and no names', async () => {
    const vault = await testVault();
    const aux = registrationAuxiliaryData(vault);
    expect([...aux.blob!.keys()]).toEqual([1854n]);
    const decoded = decodeRegistration({
      metadata: { cbor: Serialization.GeneralTransactionMetadata.fromCore(aux.blob!).toCbor() },
      nativeScripts: { cbors: aux.scripts!.map(s => Serialization.NativeScript.fromCore(s as Cardano.NativeScript).toCbor()) },
    });
    if (decoded.ok === false) throw new Error(decoded.code);
    expect(decoded.registration.payment.hash).toBe(vault.payment.hash);
    expect(decoded.registration.stake?.hash).toBe(vault.stake.hash);
    expect(decoded.registration.name).toBeUndefined();
    expect(decoded.registration.participants).toEqual({});
  });

  it('is built by the wallet\'s builder as change to itself and signed by its payment key alone', async () => {
    const vault = await testVault();
    const root = resolvePrivateKey(`${'abandon '.repeat(23)}art`);
    const account = root.derive([WalletTypePurpose.CIP1852, CoinTypes.CARDANO, HARDENED]).toPublic();
    const publicKey = bech32.encode('xpub', bech32.toWords(account.bytes()), 1023);
    const wallet = new WalletBg({ id: 1854, chain: Blockchain.CARDANO, network: Network.PREPROD,
      name: 'registration test', type: WalletType.Normal, publicKey } as ConstructorParameters<typeof WalletBg>[0]);
    const keys = wallet.resolvePathsForMissingAddresses([]);
    const address = Cardano.PaymentAddress(keys.payment[0].address);
    const utxos: Cardano.Utxo[] = [[{ txId: Cardano.TransactionId('11'.repeat(32)), index: 0, address }, { address, value: { coins: 8_000_000n } }]];

    const tx = await buildRegistrationTx(vault, { utxos, epochParams, changeAddress: address, tip: { slot: 1000 }, walletContext: { keys } });
    expect(tx.body.outputs).toHaveLength(1);
    expect(tx.body.outputs[0].address).toBe(address);
    expect(tx.body.outputs[0].value.coins + tx.body.fee).toBe(8_000_000n);
    expect(tx.body.certificates).toBeUndefined();

    const serialized = Serialization.Transaction.fromCore(tx);
    const { witnesses } = await wallet.signTx(serialized.toCbor(), '', utxos, keys, root.bytes());
    const signed = Serialization.TransactionWitnessSet.fromCbor(Serialization.TxCBOR(witnesses));
    expect(signed.vkeys().values().map(w => w.vkey())).toEqual([getPaymentKeyExternal(publicKey, 0).hex()]);
    const witness = signed.vkeys().values()[0];
    expect(Ed25519PublicKey.fromHex(witness.vkey()).verify(Ed25519Signature.fromHex(witness.signature()), HexBlob(serialized.getId()))).toBe(true);

    serialized.setWitnessSet(signed);
    const submitted = Serialization.Transaction.fromCbor(serialized.toCbor()).toCore();
    expect(submitted.body.auxiliaryDataHash).toBe(Cardano.computeAuxiliaryDataHash(submitted.auxiliaryData));
    expect(submitted.auxiliaryData?.scripts).toHaveLength(2);
    expect(tx.body.fee).toBeGreaterThanOrEqual(155381n + 44n * BigInt(serialized.toCbor().length / 2));
  });
});
