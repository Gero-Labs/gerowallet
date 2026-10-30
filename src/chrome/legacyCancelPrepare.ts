// LEGACY_LISTING_PREPARE_CANCEL: turn the refs of the wallet's own stuck listings and offers
// at the closed marketplace's legacy contracts into one verified, unsigned cancel (NFT rescue).
// Background only. The page names nothing but the refs: the background checks they belong to
// the wallet (Nexus's by-owner lookup against the wallet's own key hashes), picks the fee
// inputs and every address itself, asks Nexus to build, and checks the CBOR it gets back
// (legacyCancelVerify.ts) before the page signs those exact bytes.
//
// Software wallets (password, PassKey, Google) and the hardware wallets listed in
// LEGACY_RESCUE_HARDWARE_WALLET_TYPES (empty until each device has signed a real rescue).
// Cardano mainnet only. Unlike a CIP-113 transfer this grants no signing allowance: a legacy
// cancel spends no programmable input, so the signer's CIP-113 refusal never concerns it.

import { Cardano } from '@cardano-sdk/core';
import type { Keys } from '@/models/types';
import { Blockchain, Network } from '@/models/types';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import { debugLog } from '@/utils/debug';
import { SENDER, TARGET } from '@/chrome/config';
import { legacyRef, type LegacyListingItem } from '@/api/legacy-listings-api';
import {
  type LegacyCancelBuildRequest,
  type LegacyCancelBuildResponse,
  nexusErrorCode,
  walletUtxosToNexusInputs,
} from '@/api/nexus-tx-api';
import { LEGACY_CANCEL_MAX, isLegacyRescueHardware } from '@/utils/legacyMarketScripts';
import { ownKeys } from '@/chrome/cip113PrepareTransfer';
import { type LegacyCancelSummary, verifyLegacyCancel } from '@/chrome/legacyCancelVerify';

/** Wallet types that sign in the worker with a key the wallet holds (as CIP-113 Send). */
const SOFTWARE_WALLET_TYPES = new Set(['Normal', 'Google']);

/** Most fee inputs Nexus's legacy cancel builder accepts in one request. */
export const LEGACY_CANCEL_MAX_FEE_INPUTS = 50;

export type LegacyCancelPrepareErrorCode =
  | 'INVALID_REQUEST'
  | 'WALLET_UNSUPPORTED'
  | 'NETWORK_UNSUPPORTED'
  | 'NOT_OWNED'
  | 'BUILD_FAILED'
  | 'VERIFY_FAILED'
  /** Or a Nexus 422 errorCode, passed through (LISTING_NOT_FOUND, NOT_LEGACY_LISTING, EVALUATION_FAILED, …). */
  | string;

export class LegacyCancelPrepareError extends Error {
  constructor(readonly code: LegacyCancelPrepareErrorCode, message: string) {
    super(message);
    this.name = 'LegacyCancelPrepareError';
  }
}

export interface LegacyCancelPrepareEnv {
  walletId: number;
  chain: string;
  network: string;
  walletType: string;
  /** The wallet's spendable UTxOs. */
  ownUtxos: readonly Cardano.Utxo[];
  keys: Partial<Keys> | null | undefined;
  /** The UTxO kept aside as dApp collateral; not offered as a fee input. */
  reservedCollateral: Cardano.Utxo | null | undefined;
  /** Where the returned assets and the ADA change go: the wallet's receive address. */
  changeAddress: string;
  /** Nexus's by-owner lookup of the legacy UTxOs still unspent (fetchLegacyListings). */
  lookup: (ownerPkhs: string[], network: string) => Promise<LegacyListingItem[]>;
  build: (request: LegacyCancelBuildRequest, network: string) => Promise<LegacyCancelBuildResponse>;
}

export interface LegacyCancelPrepared {
  /** The CBOR exactly as Nexus built it: sign and submit these bytes, never a re-encoding. */
  txCbor: string;
  txId: string;
  summary: LegacyCancelSummary;
  sponsoredCollateralRef?: string;
}

const UTXO_REF = /^[0-9a-f]{64}#\d{1,5}$/;

export async function prepareLegacyCancel(request: unknown, env: LegacyCancelPrepareEnv): Promise<LegacyCancelPrepared> {
  const refs = readRefs(request);

  if (env.chain !== Blockchain.CARDANO || !(SOFTWARE_WALLET_TYPES.has(env.walletType) || isLegacyRescueHardware(env.walletType))) {
    throw new LegacyCancelPrepareError('WALLET_UNSUPPORTED', 'Cancelling listings is not available for this wallet');
  }
  if (env.network !== Network.MAINNET) {
    throw new LegacyCancelPrepareError('NETWORK_UNSUPPORTED', `Cancelling listings is not available on ${env.network}`);
  }

  // Key addresses only. The stuck UTxOs sit at the contracts' script addresses, which carry
  // this wallet's own stake key: an address of that kind in this set would let a cancel pay
  // its change to a place only the contract can spend from, locking the value for good.
  const own = ownKeys(env.keys);
  // OX Agent: Authorization prevented by requiring the return address to be one of the wallet's own key addresses
  if (!own.addresses.has(env.changeAddress)) {
    throw new LegacyCancelPrepareError('WALLET_UNSUPPORTED', "The wallet's receive address is not among its keys");
  }

  // OX Agent: Authorization prevented by looking the refs up under the wallet's own key hashes and refusing any ref whose owner is not one of them
  const items = await lookUpOwnItems(env, own.keyHashes);
  for (const ref of refs) {
    if (!items.has(ref)) throw new LegacyCancelPrepareError('NOT_OWNED', 'One of these listings does not belong to this wallet');
  }

  const ownUtxos = keyAddressUtxos(env.ownUtxos, own.addresses);
  let built: LegacyCancelBuildResponse;
  try {
    built = await env.build({
      listings: refs.map((ref) => {
        const { txHash, outputIndex } = items.get(ref) as LegacyListingItem;
        return { txHash, outputIndex };
      }),
      feeInputs: walletUtxosToNexusInputs(ownUtxos, env.reservedCollateral, true, { limit: LEGACY_CANCEL_MAX_FEE_INPUTS }),
      returnAddress: env.changeAddress,
      changeAddress: env.changeAddress,
      allowSponsoredCollateral: true,
    }, env.network);
  } catch (e) {
    const message = getErrorMessage(e, 'The cancel could not be built');
    throw new LegacyCancelPrepareError(nexusErrorCode(e) ?? 'BUILD_FAILED', message);
  }

  if (typeof built?.tx_cbor !== 'string' || typeof built?.tx_hash !== 'string') {
    throw new LegacyCancelPrepareError('BUILD_FAILED', 'Nexus returned no transaction');
  }
  const sponsoredCollateralRef = typeof built.sponsoredCollateralRef === 'string' && UTXO_REF.test(built.sponsoredCollateralRef)
    ? built.sponsoredCollateralRef
    : undefined;

  let summary: LegacyCancelSummary;
  try {
    summary = verifyLegacyCancel(built.tx_cbor, built.tx_hash, refs, {
      networkId: Cardano.NetworkId.Mainnet,
      items,
      ownUtxos,
      ownAddresses: own.addresses,
      ownKeyHashes: own.keyHashes,
      returnAddress: env.changeAddress,
      sponsoredCollateralRef,
    });
  } catch (e) {
    const message = getErrorMessage(e, 'The cancel did not pass the wallet\'s checks');
    throw new LegacyCancelPrepareError('VERIFY_FAILED', message);
  }

  return {
    txCbor: built.tx_cbor,
    txId: summary.txId,
    summary,
    ...(summary.sponsoredCollateralRef ? { sponsoredCollateralRef: summary.sponsoredCollateralRef } : {}),
  };
}

/** 1 to LEGACY_CANCEL_MAX distinct `txHash#index` refs, exactly as Nexus writes them. */
function readRefs(request: unknown): string[] {
  const raw = (request as { refs?: unknown } | null | undefined)?.refs;
  // Array.from turns a hole into undefined, which the string check below refuses.
  const refs: unknown[] = Array.isArray(raw) ? Array.from(raw) : [];
  // OX Agent: Sensitive Data Protection prevented by validating the request's refs to the exact txHash#index shape before anything is looked up or built
  if (
    refs.length < 1
    || refs.length > LEGACY_CANCEL_MAX
    || !refs.every((ref) => typeof ref === 'string' && UTXO_REF.test(ref))
    || new Set(refs).size !== refs.length
  ) {
    throw new LegacyCancelPrepareError('INVALID_REQUEST', `Choose 1 to ${LEGACY_CANCEL_MAX} different listings to cancel`);
  }
  return refs as string[];
}

/**
 * The wallet's legacy UTxOs by `txHash#index`: what Nexus lists for the wallet's key hashes,
 * minus anything whose owner is not one of them (Nexus is asked about the wallet's keys, so
 * another owner in its answer is a fault, not an item to cancel).
 */
async function lookUpOwnItems(env: LegacyCancelPrepareEnv, keyHashes: ReadonlySet<string>): Promise<Map<string, LegacyListingItem>> {
  let listed: LegacyListingItem[];
  try {
    listed = await env.lookup([...keyHashes], env.network);
  } catch (e) {
    const message = getErrorMessage(e, 'The wallet\'s listings could not be looked up');
    throw new LegacyCancelPrepareError(nexusErrorCode(e) ?? 'BUILD_FAILED', message);
  }
  const items = new Map<string, LegacyListingItem>();
  for (const item of Array.isArray(listed) ? listed : []) {
    if (keyHashes.has(item?.ownerPkh)) items.set(legacyRef(item), item);
  }
  return items;
}

/** Whether an address's payment credential is a key (an enterprise or base address of a key), not a script. */
function paysToKey(address: string): boolean {
  try {
    const parsed = Cardano.Address.fromString(address);
    const credential = (parsed?.asBase() ?? parsed?.asEnterprise())?.getPaymentCredential();
    return credential?.type === Cardano.CredentialType.KeyHash;
  } catch {
    return false;
  }
}

/**
 * The UTxOs at the wallet's own key addresses, or any address whose payment credential is a
 * key. A UTxO at a script address (the legacy contracts carry the wallet's stake key, so they
 * can reach the wallet's synced UTxOs) is never a fee input or the wallet's own collateral.
 * An address that cannot be read is left out.
 */
function keyAddressUtxos(utxos: readonly Cardano.Utxo[] | null | undefined, ownAddresses: ReadonlySet<string>): Cardano.Utxo[] {
  return (utxos ?? []).filter((utxo) => {
    const address = String(utxo?.[1]?.address ?? '');
    return ownAddresses.has(address) || paysToKey(address);
  });
}

// ── The message handler, built from injected dependencies so a test can drive it ──

/** The logged-in wallet, as far as the handler needs it. */
export interface LegacyCancelHandlerWallet {
  id: number;
  chain: string;
  network: string;
  type: string;
  /** The wallet's receive address. */
  baseAddress: string;
}

export interface LegacyCancelHandlerDeps {
  /** Resolves once the worker has restored the wallet (background.ts `booted`). */
  booted: () => Promise<unknown>;
  getWallet: () => LegacyCancelHandlerWallet | null | undefined;
  /** The worker's wallet store: the UTxOs, keys and reserved collateral the request never supplies. */
  getState: () => {
    utxos?: readonly Cardano.Utxo[] | null;
    keys?: Partial<Keys> | null;
    collateral?: Cardano.Utxo | null;
  };
  lookup: LegacyCancelPrepareEnv['lookup'];
  build: LegacyCancelPrepareEnv['build'];
  /** Records the Nexus pool collateral a build lent, so a failed co-signature of it is fatal when signing. */
  markNexusLent: (ref: string) => void;
}

/**
 * The handler of MessageTypes.LEGACY_LISTING_PREPARE_CANCEL (background.ts registers it on the
 * extension-pages channel; senderTrust.ts refuses every other sender). It answers
 * `{ success: true, result: { txCbor, txId, summary } }` or `{ success: false, error, errorCode }`
 * and calls `sendResponse` exactly once on every path.
 */
export function legacyCancelPrepareHandler(deps: LegacyCancelHandlerDeps) {
  return async (request: { id?: unknown; data?: unknown }, sendResponse: (response: unknown) => void): Promise<void> => {
    let data: Record<string, unknown>;
    try {
      await deps.booted();
      const wallet = deps.getWallet();
      if (!wallet) throw new LegacyCancelPrepareError('WALLET_UNSUPPORTED', 'Wallet instance not available');
      const prepared = await prepareLegacyCancel(request.data, {
        walletId: wallet.id,
        chain: wallet.chain,
        network: wallet.network,
        walletType: wallet.type,
        ...walletData(deps.getState()),
        changeAddress: wallet.baseAddress,
        lookup: deps.lookup,
        build: deps.build,
      });
      // Checked again here: the wallet may have switched while Nexus was building.
      const current = deps.getWallet();
      if (current?.id !== wallet.id || current.chain !== wallet.chain || current.network !== wallet.network) {
        throw new LegacyCancelPrepareError('WALLET_UNSUPPORTED', 'The wallet changed while the cancel was being built');
      }
      // A failed co-signature of Nexus pool collateral is then fatal in SIGN_TX, as for DUST.
      if (prepared.sponsoredCollateralRef) deps.markNexusLent(prepared.sponsoredCollateralRef);
      data = { success: true, result: { txCbor: prepared.txCbor, txId: prepared.txId, summary: prepared.summary } };
    } catch (error) {
      const message = getErrorMessage(error, 'The cancel could not be prepared');
      const code = error instanceof LegacyCancelPrepareError ? error.code : 'BUILD_FAILED';
      debugLog('Legacy cancel prepare refused:', code);
      data = { success: false, error: message, errorCode: code };
    }
    // Once, and outside the try: a reply that throws must not be answered with a second one.
    try {
      sendResponse({ id: request.id, data, target: TARGET, sender: SENDER.extension });
    } catch (error) {
      debugLog('Legacy cancel prepare could not reply:', getErrorMessage(error));
    }
  };
}

function walletData(state: ReturnType<LegacyCancelHandlerDeps['getState']>) {
  return {
    ownUtxos: state?.utxos ?? [],
    keys: state?.keys,
    reservedCollateral: state?.collateral,
  };
}
