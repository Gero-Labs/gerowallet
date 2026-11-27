/**
 * What the vault screen reads about a vault's stake credential and its DUST generation. Each read
 * is a display: a provider's answer is never proof. The builder refuses on what these say (a second
 * registration, a registration before the stake one), and the ledger is the judge of the rest.
 *
 * - The stake account: Nexus `GET /api/account/{reward address}/info` (registered, withdrawable
 *   rewards, deposit), through the same client the vault's address reads use.
 * - Registrations: the UTxOs at the mapping validator's address, read with the vault's chain reader
 *   and kept when their datum names this vault's stake credential (Nexus's own registration list
 *   reads key credentials only).
 * - Generation on Midnight: Nexus `dust/status` for the vault's reward address, the Midnight
 *   indexer's `dustGenerationStatus`, which takes script reward addresses as well.
 * - The proposer's collateral: the UTxOs of this wallet's own first address.
 * - Script evaluation before signing: Nexus `POST /api/transactions/evaluate` (the node's evaluator).
 */
import axios from 'axios';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Bip32PublicKey, Hash28ByteBase16, ready } from '@cardano-sdk/crypto';
import { bech32, bech32m } from 'bech32';
import { toNexusNetwork } from '@/api/nexus-tx-api';
import { getMidnightApi, type MidnightDustRegistrationStatusDto } from '@/api/midnight-api';
import { Network } from '@/models/types';
import type { AxiosInstance } from 'axios';
import { createNexusReadClient, type VaultReadHttp } from '@/modules/gerovault/chain/vaultChainReader';
import type { VaultChainReader } from '@/modules/gerovault/contracts';
import type { VaultNetwork } from '@/shared/gerovault';
import type { VaultSpendContext } from '@/modules/gerovault/spend/vaultSpendContext';
import { vaultRegistrations, type EvaluatedRedeemer, type ScriptEvaluator, type StakeChainState } from './buildOperation';
import { cnightAssetOf, decodeScriptMappingDatum, dustAddressOf, mappingValidatorFor } from './mappingValidator';

const WALLET_NETWORK: Readonly<Record<VaultNetwork, string>> = {
  mainnet: Network.MAINNET,
  preprod: Network.PREPROD,
  preview: Network.PREVIEW,
};

export interface StakeAccountState {
  /** Null when the provider could not say. */
  readonly registered: boolean | null;
  readonly rewards: bigint;
  readonly deposit?: bigint;
}

const lovelace = (value: unknown): bigint | undefined => {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return BigInt(value);
  if (typeof value === 'string' && /^[0-9]{1,20}$/.test(value)) return BigInt(value);
  return undefined;
};

/** The vault's stake account, as Nexus reports it. An address Nexus does not know is not registered. */
export async function readStakeAccount(network: VaultNetwork, rewardAccount: string, http: VaultReadHttp = createNexusReadClient()): Promise<StakeAccountState> {
  let data: Record<string, unknown>;
  try {
    ({ data } = await http.get(`/api/account/${encodeURIComponent(rewardAccount)}/info`, { params: { network: toNexusNetwork(WALLET_NETWORK[network]) } }));
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return { registered: false, rewards: 0n };
    throw error;
  }
  const field = (name: string): unknown => (data && typeof data === 'object' ? data[name] : undefined);
  const registered = typeof field('registered') === 'boolean' ? (field('registered') as boolean) : null;
  const rewards = lovelace(field('withdrawable_amount') ?? field('withdrawableAmount')) ?? 0n;
  const deposit = lovelace(field('deposit'));
  return { registered, rewards, ...(deposit !== undefined && deposit > 0n ? { deposit } : {}) };
}

/** This vault's registrations at the mapping validator. */
export async function readVaultRegistrations(reader: VaultChainReader, context: Pick<VaultSpendContext, 'network' | 'stakeScriptHash'>): Promise<Cardano.Utxo[]> {
  const validator = mappingValidatorFor(context.network);
  if (!validator) return [];
  return vaultRegistrations(await reader.utxos(validator.address), context);
}

/** The DUST address a registration UTxO names, bech32m, or undefined. */
export function registrationDustAddress(utxo: Cardano.Utxo, network: VaultNetwork): string | undefined {
  const datum = utxo[1].datum ? Serialization.PlutusData.fromCore(utxo[1].datum).toCbor() : undefined;
  const decoded = datum ? decodeScriptMappingDatum(datum) : null;
  return decoded ? dustAddressOf(network, decoded.dustAddressHex) : undefined;
}

/** DUST generation of the vault's reward address on the Midnight chain paired with `network`. */
export async function readGeneration(network: VaultNetwork, rewardAccount: string): Promise<MidnightDustRegistrationStatusDto> {
  return getMidnightApi(WALLET_NETWORK[network]).getDustStatus(rewardAccount);
}

/** The chain state the builder takes, from the reads above. */
export function stakeChainState(account: StakeAccountState, registrations: readonly Cardano.Utxo[]): StakeChainState {
  return { stakeRegistered: account.registered, rewards: account.rewards, ...(account.deposit !== undefined ? { deposit: account.deposit } : {}), registrations };
}

/** The cNIGHT a set of vault UTxOs holds, in base units. */
export function cnightHeld(utxos: readonly Cardano.Utxo[], network: VaultNetwork): bigint {
  const asset = cnightAssetOf(network);
  if (!asset) return 0n;
  const unit = Cardano.AssetId(`${asset.policyId}${asset.assetNameHex}`);
  return utxos.reduce((sum, [, output]) => sum + BigInt(output.value.assets?.get(unit) ?? 0n), 0n);
}

/**
 * This wallet's first address (payment key `0/0`, stake key `2/0`) from its CIP-1852 account public
 * key: where the proposer's collateral comes from, and the one collateral its background signs for.
 */
export async function walletFirstAddress(accountPublicKey: unknown, network: VaultNetwork): Promise<string | undefined> {
  if (typeof accountPublicKey !== 'string' || accountPublicKey.length === 0) return undefined;
  try {
    let words: number[];
    try {
      words = bech32.decode(accountPublicKey, 1023).words;
    } catch {
      words = bech32m.decode(accountPublicKey, 1023).words;
    }
    await ready();
    const account = Bip32PublicKey.fromBytes(Uint8Array.from(bech32.fromWords(words)));
    const credential = (role: number): Cardano.Credential => ({
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16(account.derive([role, 0]).toRawKey().hash().hex()),
    });
    const id = network === 'mainnet' ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet;
    return Cardano.BaseAddress.fromCredentials(id, credential(0), credential(2)).toAddress().toBech32();
  } catch {
    return undefined;
  }
}

const count = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined);

/** One entry of Nexus's evaluation answer, in either field style, or undefined. */
function evaluatedRedeemer(row: unknown): EvaluatedRedeemer | undefined {
  if (!row || typeof row !== 'object') return undefined;
  const entry = row as Record<string, unknown>;
  const units = (entry['exUnits'] ?? entry['ex_units']) as Record<string, unknown> | undefined;
  const purpose = entry['redeemerTag'] ?? entry['redeemer_tag'];
  const index = count(entry['index']);
  const memory = count(units?.['mem'] ?? units?.['memory']);
  const steps = count(units?.['steps'] ?? units?.['cpu']);
  if (typeof purpose !== 'string' || index === undefined || memory === undefined || steps === undefined) return undefined;
  return { purpose, index, memory, steps };
}

/**
 * The chain's own evaluator through Nexus. Throws when the evaluation fails, the service cannot be
 * reached, or an answer does not read: the builder then refuses the proposal.
 */
export function nexusScriptEvaluator(network: VaultNetwork, http: Pick<AxiosInstance, 'post'> = createNexusReadClient()): ScriptEvaluator {
  return async (txCbor: string) => {
    const { data } = await http.post('/api/transactions/evaluate', { cbor: txCbor }, { params: { network: toNexusNetwork(WALLET_NETWORK[network]) } });
    if (!Array.isArray(data)) throw new Error('The evaluator answered with something other than a list');
    const rows = data.map(evaluatedRedeemer);
    if (rows.some(row => row === undefined)) throw new Error('An evaluation entry does not read');
    return rows as EvaluatedRedeemer[];
  };
}
