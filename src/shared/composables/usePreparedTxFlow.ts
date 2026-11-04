import { ref, type Ref } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { nexusCollateralApi } from '@/api/nexus-collateral-api';
import { toNexusNetwork } from '@/api/nexus-tx-api';
import { mergeWitnessSets } from '@/shared/utils/witnessSets';
import { signsOnDevice, useHardwareTxSigner } from '@/shared/composables/useHardwareTxSigner';
import hardwareLoading from '@/plugins/hardwareLoading';

/**
 * The page side of a transaction the background worker prepares: Gero's own Send of a
 * programmable token and the rescue of a closed marketplace's listings both run it.
 *
 * The page never builds or handles inputs. It asks the worker to prepare (the caller picks the
 * message and its data: the worker chooses the inputs, has Nexus build, verifies the CBOR
 * against the request and answers `{ success, result: { txCbor, txId, summary } }` or
 * `{ success: false, errorCode }`), shows the verified summary, then signs and submits the
 * CBOR exactly as built:
 *
 *   PREPARE → VERIFY_SPENDING_PASSWORD (password wallets) → SIGN_TX → SUBMIT_TX {txCbor, witnessHex}
 *
 * A hardware wallet signs in the page instead of SIGN_TX (whether the worker's prepare lets a
 * device wallet through is its own call):
 *
 *   PREPARE → device (Ledger, Trezor, Keystone QR) → Nexus co-signs sponsored collateral → SUBMIT_TX
 *
 * The device paths ask the worker before signing. When the worker has made signing a one-shot
 * grant, `refusalMessage` is the text of its refusal once that grant is spent or expired: the
 * flow then reports EXPIRED and the user prepares again.
 *
 * OPAQUE CBOR INVARIANT: the prepared `txCbor` is never re-encoded here. SIGN_TX and the
 * devices return a witness set, and SUBMIT_TX merges it into these bytes under a body-hash
 * guard, as the DUST and swap flows do. A Plutus transaction re-encoded can stop matching
 * its script integrity hash.
 */

export type PreparedTxStage = 'idle' | 'preparing' | 'review' | 'signing' | 'submitting' | 'done';

export interface PreparedTxFailure {
  /** The worker's errorCode (or a Nexus 422 code it passed through), or one of this file's own codes. */
  code: string;
}

/** Credentials for the signature: the spending password, or a PassKey wallet's decrypted root key. Google and hardware wallets need neither. */
export interface PreparedTxCredentials {
  password?: string;
  privateKeyBytes?: Uint8Array;
}

export interface PreparedTxFlowOptions<TFailure extends PreparedTxFailure = PreparedTxFailure> {
  /** Ledger only: the user chose Bluetooth for this signature. USB otherwise. */
  getIsBT?: () => boolean;
  /**
   * The message SIGN_TX and the device paths answer with once the worker no longer allows
   * the prepared transaction to be signed. Left out, no signing failure reads as expiry.
   */
  refusalMessage?: string;
  /**
   * Extra string fields of the worker's failure reply to copy onto `failure` beside the code
   * (the caller's own `TFailure` fields, e.g. a limit the user can act on).
   */
  failureFields?: readonly (Exclude<keyof TFailure, 'code'> & string)[];
}

export interface PreparedTx<TSummary> {
  txCbor: string;
  txId: string;
  summary: TSummary;
}

type Reply<T> = { data?: T } | undefined;

/** The page's own failure codes, beside the worker's and Nexus's. */
export const PREPARED_TX_WRONG_PASSWORD = 'WRONG_PASSWORD';
/** The worker no longer allows the prepared transaction to be signed (spent or expired): prepare again. */
export const PREPARED_TX_EXPIRED = 'EXPIRED';
export const PREPARED_TX_SIGN_FAILED = 'SIGN_FAILED';
export const PREPARED_TX_SUBMIT_FAILED = 'SUBMIT_FAILED';

export function usePreparedTxFlow<
  TSummary extends { sponsoredCollateralRef?: string },
  TFailure extends PreparedTxFailure = PreparedTxFailure,
>(options: PreparedTxFlowOptions<TFailure> = {}) {
  // Ledger, Trezor and Keystone sign in the page. The host renders KeystoneSignDialog off
  // `keystone`'s refs.
  const hardware = useHardwareTxSigner({ getIsBT: options.getIsBT });
  const stage = ref<PreparedTxStage>('idle');
  // Cast: `ref<T>` unwraps a generic T (UnwrapRef), which the compiler cannot reduce for a type parameter.
  const prepared = ref(null) as Ref<PreparedTx<TSummary> | null>;
  const failure = ref(null) as Ref<TFailure | null>;
  const submittedTxId = ref<string | null>(null);

  const isRefusal = (message: unknown): boolean => options.refusalMessage !== undefined && message === options.refusalMessage;

  function fail(code: string, details: Partial<TFailure> = {}): false {
    failure.value = { code, ...details } as TFailure;
    return false;
  }

  /** The caller's extra failure fields that the worker's reply carries as non-empty strings. */
  function failureDetails(reply: Record<string, unknown>): Partial<TFailure> {
    const details: Record<string, string> = {};
    for (const field of options.failureFields ?? []) {
      const value = reply[field];
      if (typeof value === 'string' && value) details[field] = value;
    }
    return details as Partial<TFailure>;
  }

  /** Have the worker build and verify the transaction. True when a summary is ready to review. */
  async function prepare(method: MessageTypes, data: unknown): Promise<boolean> {
    failure.value = null;
    prepared.value = null;
    stage.value = 'preparing';
    const reply = (await Messaging.sendToBackgroundFromOptions({ method, data }).catch(() => undefined)) as Reply<
      Record<string, unknown> & { success?: boolean; result?: PreparedTx<TSummary>; errorCode?: string }
    >;
    const replyData = reply?.data;
    const result = replyData?.result;
    if (!replyData?.success || !result?.txCbor || !result.txId || !result.summary) {
      stage.value = 'idle';
      return fail(typeof replyData?.errorCode === 'string' ? replyData.errorCode : 'BUILD_FAILED', replyData ? failureDetails(replyData) : {});
    }
    prepared.value = { txCbor: result.txCbor, txId: result.txId, summary: result.summary };
    stage.value = 'review';
    return true;
  }

  /** Sign the prepared transaction and submit it. True once the network accepted it. */
  async function signAndSubmit(credentials: PreparedTxCredentials = {}): Promise<boolean> {
    const transaction = prepared.value;
    if (!transaction) return fail(PREPARED_TX_EXPIRED);
    failure.value = null;
    stage.value = 'signing';
    // Once a signature exists the transaction may reach the network, so no later failure may
    // read as "nothing was sent", and a spent signing grant means a retry builds again.
    let signedOnce = false;
    const unconfirmed = (): false => {
      prepared.value = null;
      stage.value = 'idle';
      return fail(PREPARED_TX_SUBMIT_FAILED);
    };
    // The worker refuses once its signing grant is used or expired: the user builds again.
    const expired = (): false => {
      prepared.value = null;
      stage.value = 'idle';
      return fail(PREPARED_TX_EXPIRED);
    };
    try {
      let witnessHex: string;
      if (signsOnDevice(walletStore.loggedWallet?.type)) {
        try {
          witnessHex = await withSponsorCosignature(transaction, await signOnDevice(transaction.txCbor));
        } catch (e) {
          // Nothing has left the page: a device signature is only ever sent with SUBMIT_TX.
          if (e instanceof Error && isRefusal(e.message)) return expired();
          stage.value = 'review';
          return fail(PREPARED_TX_SIGN_FAILED);
        }
      } else {
        if (credentials.password !== undefined) {
          const verify = (await Messaging.sendToBackgroundFromOptions({
            method: MessageTypes.VERIFY_SPENDING_PASSWORD,
            data: { password: credentials.password },
          })) as Reply<{ success?: boolean }>;
          if (!verify?.data?.success) {
            stage.value = 'review';
            return fail(PREPARED_TX_WRONG_PASSWORD);
          }
        }

        const signed = (await Messaging.sendToBackgroundFromOptions({
          method: MessageTypes.SIGN_TX,
          data: {
            txCbor: transaction.txCbor,
            partialSign: false,
            utxos: (walletStore.utxos ?? []) as Cardano.Utxo[],
            addresses: walletStore.keys,
            mergeWitnesses: false,
            ...(credentials.password !== undefined ? { password: credentials.password } : {}),
            ...(credentials.privateKeyBytes ? { privateKeyBytes: Array.from(credentials.privateKeyBytes) } : {}),
          },
        })) as Reply<{ witnesses?: string; error?: string }>;
        if (!signed?.data?.witnesses) {
          if (isRefusal(signed?.data?.error)) return expired();
          stage.value = 'review';
          return fail(PREPARED_TX_SIGN_FAILED);
        }
        witnessHex = signed.data.witnesses;
      }

      signedOnce = true;
      stage.value = 'submitting';
      const submitted = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SUBMIT_TX,
        data: { txCbor: transaction.txCbor, witnessHex },
      })) as Reply<{ txId?: string; error?: string }>;
      if (!submitted?.data?.txId) return unconfirmed();
      submittedTxId.value = submitted.data.txId;
      stage.value = 'done';
      return true;
    } catch {
      if (signedOnce) return unconfirmed();
      stage.value = 'review';
      return fail(PREPARED_TX_SIGN_FAILED);
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
   * Collateral Nexus lent for this transaction needs the pool's witness too. SIGN_TX adds it
   * in the worker for software wallets; a device signs in the page, so it is fetched here.
   * The verifier reported the ref only when the transaction puts none of the wallet's own ADA
   * up as collateral.
   */
  async function withSponsorCosignature(transaction: PreparedTx<TSummary>, witnessHex: string): Promise<string> {
    const ref = transaction.summary.sponsoredCollateralRef;
    if (!ref) return witnessHex;
    const { witness } = await nexusCollateralApi.cosign(transaction.txCbor, ref, toNexusNetwork(walletStore.loggedWallet?.network));
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
