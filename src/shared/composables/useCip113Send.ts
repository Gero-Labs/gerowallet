import { ref } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
import { CIP113_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import { walletStore } from '@/stores/walletStore';
import { nexusCollateralApi } from '@/api/nexus-collateral-api';
import { toNexusNetwork } from '@/api/nexus-tx-api';
import { mergeWitnessSets } from '@/shared/utils/witnessSets';
import { signsOnDevice, useHardwareTxSigner } from '@/shared/composables/useHardwareTxSigner';
import hardwareLoading from '@/plugins/hardwareLoading';
import type { Cip113TransferSummary } from '@/chrome/cip113VerifyTransfer';
import { assertTokenDecimals, TokenDecimalsError } from '@/shared/utils/verifiedDecimals';

/**
 * Gero's own Send of a CIP-113 programmable token, page side (options and side panel).
 *
 * The page never builds or handles inputs. It asks the worker to prepare
 * (CIP113_PREPARE_TRANSFER: the worker chooses the inputs, has Nexus build, verifies, and
 * allows that one transaction id to be signed once), shows the verified summary, then signs
 * and submits the CBOR exactly as built:
 *
 *   PREPARE → VERIFY_SPENDING_PASSWORD (password wallets) → SIGN_TX → SUBMIT_TX {txCbor, witnessHex}
 *
 * A hardware wallet (only those in CIP113_SEND_HARDWARE_WALLET_TYPES, which the worker's
 * prepare enforces) signs in the page instead of SIGN_TX:
 *
 *   PREPARE → device (Ledger, Trezor, Keystone QR) → Nexus co-signs sponsored collateral → SUBMIT_TX
 *
 * The device paths ask the worker before signing; they honour the allowance without using
 * it up, and a refusal (the allowance expired) means building again, as for SIGN_TX.
 *
 * OPAQUE CBOR INVARIANT: the prepared `txCbor` is never re-encoded here. SIGN_TX and the
 * devices return a witness set, and SUBMIT_TX merges it into these bytes under a body-hash
 * guard, as the DUST and swap flows do. A Plutus transaction re-encoded can stop matching
 * its script integrity hash.
 */

export type Cip113SendStage = 'idle' | 'preparing' | 'review' | 'signing' | 'submitting' | 'done';

export interface Cip113SendFailure {
  /** A CIP113_PREPARE_TRANSFER errorCode, a Nexus 422 code, or one of this file's own codes. */
  code: string;
  /** For INSUFFICIENT and NOT_IN_ONE_TRANSFER: the most one transfer can send, in base units. */
  maxSingleTransfer?: string;
}

export interface Cip113SendIntent {
  unit: string;
  /** Base units. */
  quantity: string;
  recipientAddress: string;
  /** The decimals the typed amount was converted with, confirmed before the build (verifiedDecimals.ts). */
  decimals: number;
  network: string | undefined;
}

/** Credentials for the signature: the spending password, or a PassKey wallet's decrypted root key. Google and hardware wallets need neither. */
export interface Cip113SendCredentials {
  password?: string;
  privateKeyBytes?: Uint8Array;
}

export interface Cip113SendOptions {
  /** Ledger only: the user chose Bluetooth for this signature. USB otherwise. */
  getIsBT?: () => boolean;
}

interface PreparedTransfer {
  txCbor: string;
  txId: string;
  summary: Cip113TransferSummary;
}

type Reply<T> = { data?: T } | undefined;

/** The page's own failure codes, beside the worker's and Nexus's. */
export const CIP113_SEND_WRONG_PASSWORD = 'WRONG_PASSWORD';
/** The one-shot signing allowance was used or expired (five minutes): prepare again. */
export const CIP113_SEND_EXPIRED = 'EXPIRED';
export const CIP113_SEND_SIGN_FAILED = 'SIGN_FAILED';
export const CIP113_SEND_SUBMIT_FAILED = 'SUBMIT_FAILED';
/** The token's decimals from Gero's backend are not its published ones, or could not be checked. */
export const CIP113_SEND_DECIMALS_MISMATCH = 'DECIMALS_MISMATCH';
export const CIP113_SEND_DECIMALS_UNVERIFIED = 'DECIMALS_UNVERIFIED';

/**
 * The i18n key explaining a failure. Every key named here exists in us/de/es
 * (`programmableTokens.send.error.*`, the shared wrong-password and token-decimals messages); unknown
 * codes fall back to the generic one.
 */
export function cip113SendErrorKey(code: string): string {
  switch (code) {
    case CIP113_SEND_WRONG_PASSWORD:
      return 'errors.wrongPassword';
    case 'INSUFFICIENT':
    case 'NOT_IN_ONE_TRANSFER':
    case 'RECIPIENT_INVALID':
    case 'OWNER_KEY_UNKNOWN':
    case 'WALLET_UNSUPPORTED':
    case 'NETWORK_UNSUPPORTED':
    case 'MODULE_UNSUPPORTED':
    case 'TOKEN_NOT_REGISTERED':
    case 'BLACKLIST_UNRESOLVED':
    case 'CIP113_TRANSFER_DISABLED':
    case 'VERIFY_FAILED':
    case CIP113_SEND_EXPIRED:
    case CIP113_SEND_SIGN_FAILED:
    case CIP113_SEND_SUBMIT_FAILED:
      return `programmableTokens.send.error.${code}`;
    case CIP113_SEND_DECIMALS_MISMATCH:
      return 'txGuard.tokenDecimalsMismatch';
    case CIP113_SEND_DECIMALS_UNVERIFIED:
      return 'txGuard.tokenDecimalsUnverified';
    case 'INVALID_REQUEST':
    case 'LOGIC_BYTES_UNAVAILABLE':
    case 'CIP68_REFERENCE_TOKEN':
    case 'FOREIGN_DEPLOYMENT':
    case 'PARAMS_MISMATCH':
    case 'MIXED_OWNERS':
    case 'CO_LOCATED_POLICY':
    case 'REGISTRY_NODE_AMBIGUOUS':
      return 'programmableTokens.send.error.UNSUPPORTED_TOKEN';
    default:
      return 'programmableTokens.send.error.BUILD_FAILED';
  }
}

export function useCip113Send(options: Cip113SendOptions = {}) {
  // Ledger, Trezor and Keystone sign in the page. The host renders KeystoneSignDialog off
  // `keystone`'s refs.
  const hardware = useHardwareTxSigner({ getIsBT: options.getIsBT });
  const stage = ref<Cip113SendStage>('idle');
  const prepared = ref<PreparedTransfer | null>(null);
  const failure = ref<Cip113SendFailure | null>(null);
  const submittedTxId = ref<string | null>(null);

  function fail(code: string, maxSingleTransfer?: string): false {
    failure.value = { code, ...(maxSingleTransfer ? { maxSingleTransfer } : {}) };
    return false;
  }

  /** Have the worker build and verify the transfer. True when a summary is ready to review. */
  async function prepare(intent: Cip113SendIntent): Promise<boolean> {
    failure.value = null;
    prepared.value = null;
    stage.value = 'preparing';
    try {
      await assertTokenDecimals([{ unit: intent.unit, decimals: intent.decimals }], intent.network);
    } catch (e) {
      stage.value = 'idle';
      if (e instanceof TokenDecimalsError && e.problem === 'mismatch') return fail(CIP113_SEND_DECIMALS_MISMATCH);
      return fail(CIP113_SEND_DECIMALS_UNVERIFIED);
    }
    const reply = (await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.CIP113_PREPARE_TRANSFER,
      data: { unit: intent.unit, quantity: intent.quantity, recipientAddress: intent.recipientAddress },
    }).catch(() => undefined)) as Reply<{
      success?: boolean;
      result?: PreparedTransfer;
      errorCode?: string;
      maxSingleTransfer?: string;
    }>;
    const data = reply?.data;
    const result = data?.result;
    if (!data?.success || !result?.txCbor || !result.txId || !result.summary) {
      stage.value = 'idle';
      return fail(typeof data?.errorCode === 'string' ? data.errorCode : 'BUILD_FAILED', data?.maxSingleTransfer);
    }
    prepared.value = { txCbor: result.txCbor, txId: result.txId, summary: result.summary };
    stage.value = 'review';
    return true;
  }

  /** Sign the prepared transfer and submit it. True once the network accepted it. */
  async function signAndSubmit(credentials: Cip113SendCredentials = {}): Promise<boolean> {
    const transfer = prepared.value;
    if (!transfer) return fail(CIP113_SEND_EXPIRED);
    failure.value = null;
    stage.value = 'signing';
    // Once a signature exists the transfer may reach the network, so no later failure may
    // read as "nothing was sent", and the spent allowance means a retry builds again.
    let signedOnce = false;
    const unconfirmed = (): false => {
      prepared.value = null;
      stage.value = 'idle';
      return fail(CIP113_SEND_SUBMIT_FAILED);
    };
    // The worker refuses once the allowance is used or expired: the user builds again.
    const expired = (): false => {
      prepared.value = null;
      stage.value = 'idle';
      return fail(CIP113_SEND_EXPIRED);
    };
    try {
      let witnessHex: string;
      if (signsOnDevice(walletStore.loggedWallet?.type)) {
        try {
          witnessHex = await withSponsorCosignature(transfer, await signOnDevice(transfer.txCbor));
        } catch (e) {
          // Nothing has left the page: a device signature is only ever sent with SUBMIT_TX.
          if (e instanceof Error && e.message === CIP113_SIGN_REFUSAL_MESSAGE) return expired();
          stage.value = 'review';
          return fail(CIP113_SEND_SIGN_FAILED);
        }
      } else {
        if (credentials.password !== undefined) {
          const verify = (await Messaging.sendToBackgroundFromOptions({
            method: MessageTypes.VERIFY_SPENDING_PASSWORD,
            data: { password: credentials.password },
          })) as Reply<{ success?: boolean }>;
          if (!verify?.data?.success) {
            stage.value = 'review';
            return fail(CIP113_SEND_WRONG_PASSWORD);
          }
        }

        const signed = (await Messaging.sendToBackgroundFromOptions({
          method: MessageTypes.SIGN_TX,
          data: {
            txCbor: transfer.txCbor,
            partialSign: false,
            utxos: (walletStore.utxos ?? []) as Cardano.Utxo[],
            addresses: walletStore.keys,
            mergeWitnesses: false,
            ...(credentials.password !== undefined ? { password: credentials.password } : {}),
            ...(credentials.privateKeyBytes ? { privateKeyBytes: Array.from(credentials.privateKeyBytes) } : {}),
          },
        })) as Reply<{ witnesses?: string; error?: string }>;
        if (!signed?.data?.witnesses) {
          if (signed?.data?.error === CIP113_SIGN_REFUSAL_MESSAGE) return expired();
          stage.value = 'review';
          return fail(CIP113_SEND_SIGN_FAILED);
        }
        witnessHex = signed.data.witnesses;
      }

      signedOnce = true;
      stage.value = 'submitting';
      const submitted = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SUBMIT_TX,
        data: { txCbor: transfer.txCbor, witnessHex },
      })) as Reply<{ txId?: string; error?: string }>;
      if (!submitted?.data?.txId) return unconfirmed();
      submittedTxId.value = submitted.data.txId;
      stage.value = 'done';
      return true;
    } catch {
      if (signedOnce) return unconfirmed();
      stage.value = 'review';
      return fail(CIP113_SEND_SIGN_FAILED);
    } finally {
      credentials.privateKeyBytes?.fill(0);
    }
  }

  /** The witness set from the logged wallet's device. Ledger and Trezor show the "continue on your device" prompt; Keystone has its QR dialog. */
  async function signOnDevice(txCbor: string): Promise<string> {
    const type = walletStore.loggedWallet?.type;
    if (type === WalletType.Ledger || type === WalletType.Trezor) hardwareLoading.begin(type);
    try {
      return await hardware.sign(txCbor);
    } finally {
      hardwareLoading.end();
    }
  }

  /**
   * Collateral Nexus lent for this transfer needs the pool's witness too. SIGN_TX adds it in
   * the worker for software wallets; a device signs in the page, so it is fetched here.
   * The verifier reported the ref only when the transfer puts none of the wallet's own ADA up
   * as collateral.
   */
  async function withSponsorCosignature(transfer: PreparedTransfer, witnessHex: string): Promise<string> {
    const ref = transfer.summary.sponsoredCollateralRef;
    if (!ref) return witnessHex;
    const { witness } = await nexusCollateralApi.cosign(transfer.txCbor, ref, toNexusNetwork(walletStore.loggedWallet?.network));
    return mergeWitnessSets(witnessHex, witness);
  }

  function reset(): void {
    stage.value = 'idle';
    prepared.value = null;
    failure.value = null;
    submittedTxId.value = null;
  }

  return { stage, prepared, failure, submittedTxId, prepare, signAndSubmit, reset, keystone: hardware.keystone };
}
