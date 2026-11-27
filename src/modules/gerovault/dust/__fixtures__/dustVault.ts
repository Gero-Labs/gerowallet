/**
 * Test material for the stake and DUST operation specs: a collateral wallet with a root key made in
 * the test run (never a real wallet's), a registration UTxO with the datum's exact bytes, an
 * imported vault whose stake credential is its payment script, and protocol parameters with the
 * Plutus V3 cost model.
 */
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Bip32PrivateKey, ready } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { bech32 } from 'bech32';
import {
  deriveRoleKeys,
  deriveVaultPublicKeys,
  encodeVaultPublicKeys,
  multisigAccountPublicKey,
  vaultId,
  vaultKeyHashes,
  vaultScript,
  ROLE,
} from '@/shared/gerovault';
import type { VaultRecord } from '@/modules/gerovault/contracts';
import { TEST_PARAMS, type FundingTx, type TestOwner, testVaultRecord } from '@/modules/gerovault/spend/__fixtures__/testVault';
import type { OperationProtocolParameters } from '../buildOperation';
import { encodeScriptMappingDatum, mappingValidatorFor } from '../mappingValidator';
import { PREPROD_V3_COST_MODEL_EPOCH_327 } from './experimentTxs';

const HARDENED = 0x80000000;

/** A DUST address on preprod (33 bytes: 0x73 and a made-up key). */
export const TEST_DUST_HEX = `73${'5a'.repeat(32)}`;

export const OPERATION_PARAMS: OperationProtocolParameters = {
  ...TEST_PARAMS,
  stakeKeyDeposit: 2_000_000,
  collateralPercentage: 150,
  costModels: new Map([[Cardano.PlutusLanguageVersion.V3, [...PREPROD_V3_COST_MODEL_EPOCH_327]]]),
};

export interface CollateralWallet {
  readonly rootKey: Uint8Array;
  readonly accountIndex: number;
  /** The CIP-1852 account public key, bech32, as a wallet record stores it. */
  readonly publicKey: string;
  /** The first address: payment key `0/0`, stake key `2/0`. */
  readonly address: string;
  readonly paymentKeyHash: string;
}

/** A fresh software wallet for collateral: random entropy, account `accountIndex`. */
export async function collateralWallet(accountIndex = 0): Promise<CollateralWallet> {
  await ready();
  const root = Bip32PrivateKey.fromBip39Entropy(Buffer.from(crypto.getRandomValues(new Uint8Array(32))), '');
  const account = root.derive([HARDENED + 1852, HARDENED + 1815, HARDENED + accountIndex]).toPublic();
  const payment = account.derive([0, 0]).toRawKey().hash().hex();
  const stake = account.derive([2, 0]).toRawKey().hash().hex();
  const address = Cardano.BaseAddress.fromCredentials(
    Cardano.NetworkId.Testnet,
    { type: Cardano.CredentialType.KeyHash, hash: payment as unknown as Cardano.Credential['hash'] },
    { type: Cardano.CredentialType.KeyHash, hash: stake as unknown as Cardano.Credential['hash'] },
  ).toAddress().toBech32();
  return {
    rootKey: Uint8Array.from(root.bytes()),
    accountIndex,
    publicKey: bech32.encode('acct_xvk', bech32.toWords(Buffer.from(account.bytes())), 1023),
    address,
    paymentKeyHash: payment,
  };
}

/** A vault owner whose root key is `wallet`'s: the proposer whose own first address gives the collateral. */
export async function ownerOfWallet(wallet: CollateralWallet, index: number): Promise<TestOwner> {
  await ready();
  const root = Bip32PrivateKey.fromBytes(wallet.rootKey);
  const account = root.derive([HARDENED + 1854, HARDENED + 1815, HARDENED + 0]).toPublic().hex();
  const keys = await deriveVaultPublicKeys(await deriveRoleKeys(multisigAccountPublicKey(account)), index);
  const hashes = await vaultKeyHashes(keys);
  return { rootKey: Uint8Array.from(wallet.rootKey), index, keys, credential: hashes.payment, stakeKeyHash: hashes.stake };
}

/**
 * A transaction that creates a registration output (the validator's address, its token and the
 * datum with its exact bytes) and returns it as a UTxO. The rest of its outputs are `others`.
 */
export function registrationFunding(stakeScriptHash: string, dustHex = TEST_DUST_HEX, lovelace = 1_353_340n, seed = 7): FundingTx {
  const validator = mappingValidatorFor('preprod')!;
  const token = Cardano.AssetId(validator.scriptHash);
  const datumCbor = encodeScriptMappingDatum(stakeScriptHash, dustHex);
  const output = Serialization.TransactionOutput.fromCore({
    address: Cardano.PaymentAddress(validator.address),
    value: { coins: lovelace, assets: new Map([[token, 1n]]) },
  });
  output.setDatum(Serialization.Datum.newInlineData(Serialization.PlutusData.fromCbor(HexBlob(datumCbor))));
  const body = Serialization.TransactionBody.fromCore({
    inputs: [{ txId: Cardano.TransactionId(seed.toString(16).padStart(64, 'e')), index: 0 }],
    outputs: [],
    fee: 300_000n,
  });
  body.setOutputs([output]);
  const tx = new Serialization.Transaction(body, Serialization.TransactionWitnessSet.fromCore({ signatures: new Map() }));
  const id = String(tx.getId());
  const core = output.toCore();
  return { cbor: tx.toCbor(), id, utxos: [[{ txId: Cardano.TransactionId(id), index: 0, address: core.address }, core]] };
}

/**
 * The record of an imported CIP-1854 vault whose stake credential is its payment script: both
 * script fields hold the payment script, so the payment keys also authorise stake operations.
 */
export async function sharedCredentialVaultRecord(owners: readonly TestOwner[], threshold: number, self: number): Promise<VaultRecord> {
  const base = await testVaultRecord(owners, threshold, self);
  const payment = vaultScript(ROLE.PAYMENT, Serialization.NativeScript.fromCbor(HexBlob(base.paymentScriptCbor)).toCore());
  const stake = vaultScript(ROLE.STAKE, payment.script);
  return {
    ...base,
    origin: 'imported',
    vaultId: vaultId({ payment, stake }, base.network),
    stakeScriptCbor: stake.cbor,
    stakeScriptHash: stake.hash,
    participants: owners.map((owner, i) => ({
      role: 'owner' as const,
      credential: owner.credential,
      stakeKeyHash: owner.stakeKeyHash,
      vaultKeys: encodeVaultPublicKeys(owner.keys),
      label: `Owner ${i + 1}`,
      self: i === self,
    })),
  };
}
