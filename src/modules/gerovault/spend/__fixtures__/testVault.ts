/**
 * Test vaults for the spend specs: owners with root keys generated in the test run (never a real
 * wallet's), a vault record as the store would hold it, a funding transaction that pays the vault,
 * and a chain reader that serves exactly those.
 */
import { vi } from 'vitest';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Bip32PrivateKey, ready } from '@cardano-sdk/crypto';
import {
  buildVaultFromParticipants,
  deriveRoleKeys,
  deriveVaultPublicKeys,
  encodeVaultPublicKeys,
  multisigAccountPublicKey,
  vaultId,
  vaultKeyHashes,
  type VaultNetwork,
  type VaultPublicKeys,
} from '@/shared/gerovault';
import type { VaultChainReader, VaultRecord, VaultStatus } from '@/modules/gerovault/contracts';
import type { SpendProtocolParameters } from '../buildSpend';

const HARDENED = 0x80000000;

export interface TestOwner {
  /** The root key's bytes: what `decryptPrivateKey` would give for this wallet. */
  readonly rootKey: Uint8Array;
  readonly index: number;
  readonly keys: VaultPublicKeys;
  readonly credential: string;
  readonly stakeKeyHash: string;
}

/** A fresh owner: random entropy, its CIP-1854 vault keys at `index`. */
export async function testOwner(index: number): Promise<TestOwner> {
  await ready();
  const entropy = Buffer.from(crypto.getRandomValues(new Uint8Array(32)));
  const root = Bip32PrivateKey.fromBip39Entropy(entropy, '');
  const account = root.derive([HARDENED + 1854, HARDENED + 1815, HARDENED + 0]).toPublic().hex();
  const keys = await deriveVaultPublicKeys(await deriveRoleKeys(multisigAccountPublicKey(account)), index);
  const hashes = await vaultKeyHashes(keys);
  return { rootKey: Uint8Array.from(root.bytes()), index, keys, credential: hashes.payment, stakeKeyHash: hashes.stake };
}

/** The record one owner's wallet holds for a standard `threshold`-of-n vault of `owners`. */
export async function testVaultRecord(
  owners: readonly TestOwner[],
  threshold: number,
  self: number,
  options: { network?: VaultNetwork; status?: VaultStatus; name?: string } = {},
): Promise<VaultRecord> {
  const network = options.network ?? 'preprod';
  const scripts = await buildVaultFromParticipants({
    template: { kind: 'standard', threshold },
    owners: owners.map(owner => ({ vaultKeys: owner.keys })),
    acknowledged: threshold === owners.length ? ['ALL_OWNERS_REQUIRED'] : [],
  });
  return {
    recordVersion: 1,
    kind: 'native',
    vaultId: vaultId(scripts, network),
    network,
    status: options.status ?? 'accepted',
    origin: 'created',
    ...(options.name !== undefined ? { name: options.name } : {}),
    paymentScriptCbor: scripts.payment.cbor,
    stakeScriptCbor: scripts.stake.cbor,
    paymentScriptHash: scripts.payment.hash,
    stakeScriptHash: scripts.stake.hash,
    participants: owners.map((owner, i) => ({
      role: 'owner' as const,
      credential: owner.credential,
      stakeKeyHash: owner.stakeKeyHash,
      vaultKeys: encodeVaultPublicKeys(owner.keys),
      label: `Owner ${i + 1}`,
      self: i === self,
    })),
    ownIndex: owners[self].index,
    manifest: null,
    verifications: [],
    createdAt: 1,
    updatedAt: 1,
    acceptedAt: 1,
  };
}

export interface FundingTx {
  readonly cbor: string;
  readonly id: string;
  readonly utxos: Cardano.Utxo[];
}

/** A transaction that creates `outputs`, and the UTxOs it creates. Its own input is made up. */
export function fundingTransaction(outputs: readonly Cardano.TxOut[], seed = 0): FundingTx {
  const tx = Serialization.Transaction.fromCore({
    id: Cardano.TransactionId('0'.repeat(64)),
    body: {
      inputs: [{ txId: Cardano.TransactionId(seed.toString(16).padStart(64, 'f')), index: 0 }],
      outputs: [...outputs],
      fee: 200_000n,
    },
    witness: { signatures: new Map() },
  });
  const id = String(tx.getId());
  const cbor = tx.toCbor();
  const utxos = outputs.map((output, index): Cardano.Utxo => [
    { txId: Cardano.TransactionId(id), index, address: output.address },
    output,
  ]);
  return { cbor, id, utxos };
}

export function lovelaceOutput(address: string, lovelace: bigint, assets?: Map<Cardano.AssetId, bigint>): Cardano.TxOut {
  return { address: Cardano.PaymentAddress(address), value: { coins: lovelace, ...(assets ? { assets } : {}) } };
}

/** A chain reader over the given funding transactions. `submit` records what it was given. */
export function testReader(funding: readonly FundingTx[], network: VaultNetwork = 'preprod') {
  const submitted: string[] = [];
  const reader: VaultChainReader = {
    network,
    utxos: vi.fn(async () => funding.flatMap(f => f.utxos)),
    history: vi.fn(async () => []),
    txCbor: vi.fn(async (ids: string[]) => new Map(funding.filter(f => ids.includes(f.id)).map(f => [f.id, f.cbor]))),
    submit: vi.fn(async (txCbor: string) => {
      submitted.push(txCbor);
      return String(Serialization.Transaction.fromCbor(txCbor as Serialization.TxCBOR).getId());
    }),
  };
  return { reader, submitted };
}

/** Preprod's parameters, near enough. */
export const TEST_PARAMS: SpendProtocolParameters = {
  minFeeCoefficient: 44,
  minFeeConstant: 155_381,
  coinsPerUtxoByte: 4310,
  maxTxSize: 16_384,
  maxValueSize: 5000,
  prices: { memory: 0.0577, steps: 0.0000721 },
  minFeeRefScriptCostPerByte: '15',
};

/** A payee address on preprod (a key hash made up for the test). */
export function payeeAddress(byte = 'a1'): string {
  return Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Testnet, {
    type: Cardano.CredentialType.KeyHash,
    hash: byte.repeat(28) as unknown as Cardano.Credential['hash'],
  }).toAddress().toBech32();
}

/** A seeded `Math.random` stand-in, so coin selection is the same on every run. */
export function seededRandom(seed = 1): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}
