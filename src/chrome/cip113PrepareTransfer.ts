// CIP113_PREPARE_TRANSFER: turn the user's intent (token, amount, recipient) into one
// verified, unsigned CIP-113 transfer. Background only. The page never names the inputs: the
// background chooses them from the wallet's programmable UTxOs, asks Nexus to build, and
// checks what came back against the intent (cip113VerifyTransfer.ts) before the caller grants
// the one-shot signing allowance for its id.
//
// Software wallets (password, PassKey, Google), and the hardware wallets listed in
// CIP113_SEND_HARDWARE_WALLET_TYPES (empty until each device has passed a preprod run).
// Preprod and preview only (decision 11).

import { Cardano } from '@cardano-sdk/core';
import type { Keys } from '@/models/types';
import { Blockchain } from '@/models/types';
import networks from '@/utils/networks';
import { isCip113SendHardware } from '@/utils/cip113Deployments';
import {
  CIP113_MAX_FEE_INPUTS,
  type Cip113TransferBuildRequest,
  type Cip113TransferBuildResponse,
  nexusErrorCode,
  walletUtxosToNexusInputs,
} from '@/api/nexus-tx-api';
import { selectCip113TransferInputs } from '@/chrome/cip113SelectInputs';
import {
  type Cip113TransferSummary,
  Cip113VerifyError,
  resolveRecipient,
  verifyCip113Transfer,
} from '@/chrome/cip113VerifyTransfer';

/** Wallet types that sign in the worker with a key the wallet holds. */
const SOFTWARE_WALLET_TYPES = new Set(['Normal', 'Google']);

export type Cip113PrepareErrorCode =
  | 'INVALID_REQUEST'
  | 'WALLET_UNSUPPORTED'
  | 'NETWORK_UNSUPPORTED'
  | 'INSUFFICIENT'
  | 'NOT_IN_ONE_TRANSFER'
  | 'OWNER_KEY_UNKNOWN'
  | 'RECIPIENT_INVALID'
  | 'BUILD_FAILED'
  | 'VERIFY_FAILED'
  /** Or a Nexus 422 errorCode, passed through (MODULE_UNSUPPORTED, BLACKLIST_UNRESOLVED, …). */
  | string;

export class Cip113PrepareError extends Error {
  constructor(
    readonly code: Cip113PrepareErrorCode,
    message: string,
    /** For INSUFFICIENT and NOT_IN_ONE_TRANSFER: the most one transfer can send, in base units. */
    readonly maxSingleTransfer?: string,
  ) {
    super(message);
    this.name = 'Cip113PrepareError';
  }
}

export interface Cip113PrepareEnv {
  walletId: number;
  chain: string;
  network: string;
  walletType: string;
  /** WalletBg's programmable UTxOs (background only). */
  programmableUtxos: readonly Cardano.Utxo[];
  /** The wallet's spendable UTxOs. */
  ownUtxos: readonly Cardano.Utxo[];
  keys: Partial<Keys> | null | undefined;
  /** The UTxO kept aside as dApp collateral; not offered as a fee input. */
  reservedCollateral: Cardano.Utxo | null | undefined;
  /** Where the ADA change goes: the wallet's receive address. */
  changeAddress: string;
  build: (request: Cip113TransferBuildRequest, network: string) => Promise<Cip113TransferBuildResponse>;
}

export interface Cip113PreparedTransfer {
  /** The CBOR exactly as Nexus built it: sign and submit these bytes, never a re-encoding. */
  txCbor: string;
  txId: string;
  summary: Cip113TransferSummary;
  /** The programmable UTxOs it spends, for the allowance. */
  programmableRefs: string[];
  sponsoredCollateralRef?: string;
}

const QUANTITY = /^[1-9][0-9]{0,29}$/;
const UNIT = /^[0-9a-f]{56}(?:[0-9a-f]{2}){0,32}$/;
const UTXO_REF = /^[0-9a-f]{64}#\d{1,5}$/;

export async function prepareCip113Transfer(request: unknown, env: Cip113PrepareEnv): Promise<Cip113PreparedTransfer> {
  const { unit, quantity, recipientAddress } = readRequest(request);

  if (env.chain !== Blockchain.CARDANO || !(SOFTWARE_WALLET_TYPES.has(env.walletType) || isCip113SendHardware(env.walletType))) {
    throw new Cip113PrepareError('WALLET_UNSUPPORTED', 'Sending programmable tokens is not available for this wallet');
  }
  const scripts = networks.resolveCip113TransferScripts(env.chain, env.network);
  if (!scripts) throw new Cip113PrepareError('NETWORK_UNSUPPORTED', `Sending programmable tokens is not available on ${env.network}`);
  const networkId = networks.resolveNetworkId(env.chain, env.network) as Cardano.NetworkId;

  const own = ownKeys(env.keys);
  if (!own.addresses.has(env.changeAddress)) {
    throw new Cip113PrepareError('WALLET_UNSUPPORTED', "The wallet's receive address is not among its keys");
  }

  const selected = selectCip113TransferInputs(env.programmableUtxos, unit, quantity, new Set(scripts.base));
  // `=== false`, not `!`: this repo builds without strictNullChecks, where `!` does not narrow.
  if (selected.ok === false) {
    if (selected.reason === 'INVALID_REQUEST') throw new Cip113PrepareError('INVALID_REQUEST', 'This token cannot be sent');
    throw new Cip113PrepareError(selected.reason, 'Not enough of this token in one place to send that amount', selected.maxSingleTransfer.toString());
  }
  const { selection } = selected;
  if (!own.keyHashes.has(selection.ownerKeyHash)) {
    throw new Cip113PrepareError('OWNER_KEY_UNKNOWN', 'The key that owns these tokens is not among the wallet\'s loaded keys');
  }

  // Refused here before asking Nexus, by the same rules the verifier applies to the result.
  try {
    const recipient = resolveRecipient(recipientAddress, selection.baseScriptHash, networkId);
    if (recipient.programmableAddress === selection.address) {
      throw new Cip113VerifyError('RECIPIENT', 'sends to the same programmable address it spends from');
    }
  } catch (e) {
    throw new Cip113PrepareError('RECIPIENT_INVALID', e instanceof Error ? e.message : String(e));
  }

  const programmableRefs = selection.utxos.map(([txIn]) => `${txIn.txId}#${txIn.index}`);
  let built: Cip113TransferBuildResponse;
  try {
    built = await env.build({
      unit,
      quantity: quantity.toString(),
      recipientAddress,
      programmableInputs: selection.utxos.map(([txIn]) => ({ txHash: txIn.txId, outputIndex: txIn.index })),
      feeInputs: walletUtxosToNexusInputs([...env.ownUtxos], env.reservedCollateral, true, { limit: CIP113_MAX_FEE_INPUTS }),
      changeAddress: env.changeAddress,
      allowSponsoredCollateral: true,
    }, env.network);
  } catch (e) {
    throw new Cip113PrepareError(nexusErrorCode(e) ?? 'BUILD_FAILED', e instanceof Error ? e.message : 'The transfer could not be built');
  }

  const sponsoredCollateralRef = typeof built?.sponsoredCollateralRef === 'string' && UTXO_REF.test(built.sponsoredCollateralRef)
    ? built.sponsoredCollateralRef
    : undefined;
  if (typeof built?.tx_cbor !== 'string' || typeof built?.tx_hash !== 'string') {
    throw new Cip113PrepareError('BUILD_FAILED', 'Nexus returned no transaction');
  }

  let summary: Cip113TransferSummary;
  try {
    summary = verifyCip113Transfer(built.tx_cbor, built.tx_hash, { unit, quantity, recipientAddress }, {
      networkId,
      globalScriptHashes: new Set(scripts.global),
      transferScriptHashes: new Set(scripts.transfer),
      selection,
      ownUtxos: env.ownUtxos,
      ownAddresses: own.addresses,
      ownKeyHashes: own.keyHashes,
      sponsoredCollateralRef,
    });
  } catch (e) {
    throw new Cip113PrepareError('VERIFY_FAILED', e instanceof Error ? e.message : String(e));
  }

  return {
    txCbor: built.tx_cbor,
    txId: summary.txId,
    summary,
    programmableRefs,
    ...(summary.sponsoredCollateralRef ? { sponsoredCollateralRef: summary.sponsoredCollateralRef } : {}),
  };
}

function readRequest(request: unknown): { unit: string; quantity: bigint; recipientAddress: string } {
  const r = (request ?? {}) as { unit?: unknown; quantity?: unknown; recipientAddress?: unknown };
  const unit = typeof r.unit === 'string' ? r.unit.toLowerCase() : '';
  const quantity = typeof r.quantity === 'string' ? r.quantity : '';
  const recipientAddress = typeof r.recipientAddress === 'string' ? r.recipientAddress.trim() : '';
  if (!UNIT.test(unit) || !QUANTITY.test(quantity) || !recipientAddress || recipientAddress.length > 256) {
    throw new Cip113PrepareError('INVALID_REQUEST', 'Token, amount and recipient are required');
  }
  return { unit, quantity: BigInt(quantity), recipientAddress };
}

/** The wallet's key addresses and key hashes, from its key set. */
export function ownKeys(keys: Partial<Keys> | null | undefined): { addresses: Set<string>; keyHashes: Set<string> } {
  const addresses = new Set<string>();
  const keyHashes = new Set<string>();
  for (const kind of ['payment', 'change', 'stake'] as const) {
    for (const key of keys?.[kind] ?? []) {
      if (typeof key?.cred === 'string' && /^[0-9a-f]{56}$/.test(key.cred)) keyHashes.add(key.cred);
      if (kind !== 'stake' && typeof key?.address === 'string' && key.address) addresses.add(key.address);
    }
  }
  return { addresses, keyHashes };
}
