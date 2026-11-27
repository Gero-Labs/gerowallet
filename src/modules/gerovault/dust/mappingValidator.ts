/**
 * The Midnight `cnight_generates_dust` mapping validator, as a native vault uses it: cNIGHT held
 * under the vault's stake credential generates DUST for a Midnight DUST address once a
 * registration names that credential.
 *
 * A registration mints one token with the empty name under the validator's policy (the policy is
 * the validator itself) and locks it at the validator's enterprise address with the inline datum
 * `DustMappingDatum { c_wallet, dust_address }`. For a script credential, which a vault's is, the
 * validator's `check_auth` asks for a withdrawal from that script's reward account, so the
 * transaction withdraws the account's whole balance (zero for a vault that never delegated). A
 * deregistration spends the registration UTxO and burns its token, authorised the same way.
 *
 * Everything here is fixed: the validator bytes (checked against the hash before use), its
 * address, the redeemers and their execution budgets. Pure, no network: the background imports it.
 */
import { Cardano } from '@cardano-sdk/core';
import { blake2b, Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { bech32m } from 'bech32';
import { Network } from '@/models/types';
import type { VaultNetwork } from '@/shared/gerovault';
import { bytesToHex, hexToBytes } from '@/shared/gerovault/cbor';
import { DUST_MAPPING_VALIDATOR } from '@/shared/utils/dustMappingValidator';
import { CNIGHT_ASSETS } from '@/shared/utils/cnightAssets';
import { TESTNET_MAPPING_VALIDATOR_CBOR } from './validatorBytes';

const WALLET_NETWORK: Readonly<Record<VaultNetwork, string>> = {
  mainnet: Network.MAINNET,
  preprod: Network.PREPROD,
  preview: Network.PREVIEW,
};

/** The validator's script bytes per vault network. Mainnet's are not in this release. */
const SCRIPT_BYTES: Readonly<Partial<Record<VaultNetwork, string>>> = {
  preprod: TESTNET_MAPPING_VALIDATOR_CBOR,
  preview: TESTNET_MAPPING_VALIDATOR_CBOR,
};

export interface MappingValidator {
  readonly network: VaultNetwork;
  /** The validator's hash, which is also the policy id of the registration token. */
  readonly scriptHash: string;
  /** The validator's enterprise address, bech32: where a registration output sits. */
  readonly address: string;
  /** The same address, raw bytes as lowercase hex. */
  readonly addressHex: string;
  /** The Plutus V3 script bytes as the ledger hashes them. */
  readonly scriptCbor: string;
}

/** blake2b-224(0x03 || bytes): the ledger's hash of a Plutus V3 script. */
export function plutusV3ScriptHash(scriptCbor: string): string {
  return blake2b.hash(HexBlob(`03${scriptCbor}`), 28).toString();
}

const checked = new Map<VaultNetwork, MappingValidator | null>();

/**
 * The mapping validator of a vault network, or undefined where this release has none (mainnet).
 * The bytes must hash to the validator hash and the address must be the one that hash gives on
 * that network; otherwise there is no validator, and no DUST operation is built or signed.
 */
export function mappingValidatorFor(network: VaultNetwork): MappingValidator | undefined {
  if (checked.has(network)) return checked.get(network) ?? undefined;
  const entry = Object.prototype.hasOwnProperty.call(WALLET_NETWORK, network) ? DUST_MAPPING_VALIDATOR[WALLET_NETWORK[network]] : undefined;
  const bytes = SCRIPT_BYTES[network];
  let validator: MappingValidator | null = null;
  if (entry && bytes && plutusV3ScriptHash(bytes) === entry.scriptHash) {
    const id = network === 'mainnet' ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet;
    const address = Cardano.EnterpriseAddress.fromCredentials(id, {
      type: Cardano.CredentialType.ScriptHash,
      hash: Hash28ByteBase16(entry.scriptHash),
    }).toAddress();
    if (address.toBech32() === entry.address) {
      validator = Object.freeze({ network, scriptHash: entry.scriptHash, address: entry.address, addressHex: address.toBytes(), scriptCbor: bytes });
    }
  }
  checked.set(network, validator);
  return validator ?? undefined;
}

/** The cNIGHT asset of a vault network: policy id and asset name, or undefined. */
export function cnightAssetOf(network: VaultNetwork): { readonly policyId: string; readonly assetNameHex: string } | undefined {
  return Object.prototype.hasOwnProperty.call(WALLET_NETWORK, network) ? CNIGHT_ASSETS[WALLET_NETWORK[network]] : undefined;
}

// -------------------------------------------------------------------------------------------------
// Redeemers and budgets

/** `Create` (constructor 0, no fields): the mint redeemer of a registration. */
export const CREATE_REDEEMER_CBOR = 'd87980';
/** `Burn` (constructor 1, no fields): the mint redeemer of a deregistration. */
export const BURN_REDEEMER_CBOR = 'd87a80';
/** The unit redeemer (constructor 0) on the spend of the registration UTxO. */
export const SPEND_REDEEMER_CBOR = 'd87980';

/**
 * Execution budgets declared for each redeemer, fixed so every device rebuilds the same witness
 * set. The fee pays for what is declared, so they are generous but bounded.
 *
 * Measured by the preprod node's evaluator (27 November 2026) on transactions this builder wrote:
 * `Create` 80,682 memory and 30.2 million steps, whatever the inputs; the spend of the registration
 * 79,118 and 26.4 million when it is the first input; `Burn` 39,203 and 14.6 million with one input
 * and 44,921 and 17.9 million with two. The burn counts every input, and finding the registration
 * walks the inputs before it, so both grow by about 5,800 memory and 3.3 million steps per input;
 * `MAX_OPERATION_INPUTS` keeps the worst case well inside these budgets (`budgetCovers`).
 */
export const CREATE_EX_UNITS: Readonly<Cardano.ExUnits> = Object.freeze({ memory: 250_000, steps: 100_000_000 });
export const SPEND_EX_UNITS: Readonly<Cardano.ExUnits> = Object.freeze({ memory: 250_000, steps: 100_000_000 });
export const BURN_EX_UNITS: Readonly<Cardano.ExUnits> = Object.freeze({ memory: 200_000, steps: 80_000_000 });

/** Vault inputs one operation may spend; a deregistration spends the registration too. */
export const MAX_OPERATION_INPUTS = 8;

/** The measured cost of a redeemer at one input, and what each further input adds (see above). */
export const MEASURED_COST = Object.freeze({
  create: { base: { memory: 80_682, steps: 30_217_720 }, perInput: { memory: 0, steps: 0 } },
  spend: { base: { memory: 79_118, steps: 26_357_885 }, perInput: { memory: 5_800, steps: 3_300_000 } },
  burn: { base: { memory: 39_203, steps: 14_642_274 }, perInput: { memory: 5_800, steps: 3_300_000 } },
});

/** Whether `declared` covers `cost` at `inputs` inputs, with half again to spare. */
export function budgetCovers(declared: Readonly<Cardano.ExUnits>, cost: (typeof MEASURED_COST)[keyof typeof MEASURED_COST], inputs: number): boolean {
  const memory = cost.base.memory + cost.perInput.memory * (inputs - 1);
  const steps = cost.base.steps + cost.perInput.steps * (inputs - 1);
  return declared.memory >= memory * 1.5 && declared.steps >= steps * 1.5;
}

// -------------------------------------------------------------------------------------------------
// The datum

/** A DUST address is 33 bytes; the validator allows at most 33. */
export const DUST_ADDRESS_BYTES = 33;

const HEX28 = /^[0-9a-f]{56}$/;
const DUST_HEX = /^[0-9a-f]{66}$/;
const SCRIPT_DATUM = /^d8799fd87a9f581c([0-9a-f]{56})ff5821([0-9a-f]{66})ff$/;

/**
 * `DustMappingDatum { c_wallet: Script(scriptHash), dust_address }` as inline datum CBOR, in the
 * one encoding this wallet writes and accepts (indefinite-length fields, as the experiment's
 * registration the ledger and Midnight accepted).
 */
export function encodeScriptMappingDatum(scriptHash: string, dustAddressHex: string): string {
  if (!HEX28.test(scriptHash) || !DUST_HEX.test(dustAddressHex)) throw new TypeError('A script hash is 28 bytes and a DUST address 33, lowercase hex');
  return `d8799fd87a9f581c${scriptHash}ff5821${dustAddressHex}ff`;
}

/** The credential and DUST address of a datum in exactly that encoding, or null. */
export function decodeScriptMappingDatum(cborHex: string): { readonly scriptHash: string; readonly dustAddressHex: string } | null {
  const match = typeof cborHex === 'string' ? SCRIPT_DATUM.exec(cborHex) : null;
  return match ? { scriptHash: match[1], dustAddressHex: match[2] } : null;
}

// -------------------------------------------------------------------------------------------------
// DUST addresses (Midnight bech32m)

const DUST_PREFIX: Readonly<Record<VaultNetwork, string>> = {
  mainnet: 'mn_dust',
  preprod: 'mn_dust_preprod',
  preview: 'mn_dust_preview',
};

/** The raw bytes of a DUST address of `network`, lowercase hex, or undefined for anything else. */
export function dustAddressHex(network: VaultNetwork, address: string): string | undefined {
  if (typeof address !== 'string' || !Object.prototype.hasOwnProperty.call(DUST_PREFIX, network)) return undefined;
  try {
    const trimmed = address.trim();
    if (trimmed !== trimmed.toLowerCase()) return undefined;
    const decoded = bech32m.decode(trimmed, 200);
    if (decoded.prefix !== DUST_PREFIX[network]) return undefined;
    const bytes = bech32m.fromWords(decoded.words);
    if (bytes.length !== DUST_ADDRESS_BYTES) return undefined;
    return bytesToHex(Uint8Array.from(bytes));
  } catch {
    return undefined;
  }
}

/** The bech32m DUST address of `network` for 33 raw bytes. Throws for any other length. */
export function dustAddressOf(network: VaultNetwork, hex: string): string {
  if (!DUST_HEX.test(hex)) throw new TypeError('A DUST address is 33 bytes of lowercase hex');
  return bech32m.encode(DUST_PREFIX[network], bech32m.toWords(hexToBytes(hex) ?? new Uint8Array()), 200);
}
