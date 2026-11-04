import { MessageTypes } from '@/models/MessageTypes';
import { CIP113_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import {
  PREPARED_TX_EXPIRED,
  PREPARED_TX_SIGN_FAILED,
  PREPARED_TX_SUBMIT_FAILED,
  PREPARED_TX_WRONG_PASSWORD,
  usePreparedTxFlow,
  type PreparedTxCredentials,
  type PreparedTxFailure,
  type PreparedTxStage,
} from '@/shared/composables/usePreparedTxFlow';
import type { Cip113TransferSummary } from '@/chrome/cip113VerifyTransfer';

/**
 * Gero's own Send of a CIP-113 programmable token, page side (options and side panel).
 *
 * The sign-and-submit machinery is the generic usePreparedTxFlow (the legacy-listing rescue
 * runs the same one); this file adds what is CIP-113's own: the CIP113_PREPARE_TRANSFER intent,
 * the worker's signing-allowance refusal (CIP113_SIGN_REFUSAL_MESSAGE), `maxSingleTransfer` on
 * a failed build, and the `programmableTokens.send.error.*` copy keys.
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

export type Cip113SendStage = PreparedTxStage;

export interface Cip113SendFailure extends PreparedTxFailure {
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
}

/** Credentials for the signature: the spending password, or a PassKey wallet's decrypted root key. Google and hardware wallets need neither. */
export type Cip113SendCredentials = PreparedTxCredentials;

export interface Cip113SendOptions {
  /** Ledger only: the user chose Bluetooth for this signature. USB otherwise. */
  getIsBT?: () => boolean;
}

/** The page's own failure codes, beside the worker's and Nexus's. */
export const CIP113_SEND_WRONG_PASSWORD = PREPARED_TX_WRONG_PASSWORD;
/** The one-shot signing allowance was used or expired (five minutes): prepare again. */
export const CIP113_SEND_EXPIRED = PREPARED_TX_EXPIRED;
export const CIP113_SEND_SIGN_FAILED = PREPARED_TX_SIGN_FAILED;
export const CIP113_SEND_SUBMIT_FAILED = PREPARED_TX_SUBMIT_FAILED;

/**
 * The i18n key explaining a failure. Every key named here exists in us/de/es
 * (`programmableTokens.send.error.*`, and the shared wrong-password message); unknown
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
  const flow = usePreparedTxFlow<Cip113TransferSummary, Cip113SendFailure>({
    getIsBT: options.getIsBT,
    refusalMessage: CIP113_SIGN_REFUSAL_MESSAGE,
    failureFields: ['maxSingleTransfer'],
  });

  /** Have the worker build and verify the transfer. True when a summary is ready to review. */
  function prepare(intent: Cip113SendIntent): Promise<boolean> {
    return flow.prepare(MessageTypes.CIP113_PREPARE_TRANSFER, {
      unit: intent.unit,
      quantity: intent.quantity,
      recipientAddress: intent.recipientAddress,
    });
  }

  return { ...flow, prepare };
}
