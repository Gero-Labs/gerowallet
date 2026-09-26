/**
 * Places a RealFi order from inside Gero: build on Nexus, sign here, submit.
 *
 * UI-free on purpose. The signer is passed in — in the app it is the wallet's shared
 * native signer, which covers password, PassKey, Ledger, Trezor and Keystone wallets —
 * so this sequence can be tested without any of those prompts.
 *
 * The transaction is kept OPAQUE end to end: the CBOR Nexus returns is exactly what is
 * signed and what the background submits, with only the witness set added. Cancels
 * spend a Plutus script, and re-encoding the body would break its script-data hash.
 */

import { ref } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { walletStore } from '@/stores/walletStore';
import { debugLog } from '@/utils/debug';
import { utxoToCip30Hex } from '@/modules/swap/composables/utxoToCip30Hex';
import { REALFI_ASSETS } from '../assets';
import {
  buildOrder,
  RealFiOrderError,
  selectBuildUtxos,
  type RealFiBuildRequest,
  type RealFiOrderKind,
} from '../services/realfiOrders';

export type RealFiOrderStage = 'idle' | 'building' | 'signing' | 'submitting' | 'done' | 'error';

export interface RealFiOrderSigner {
  /** Returns the witness-set CBOR hex for the given unsigned transaction. */
  signTx(unsignedTxCbor: string): Promise<string>;
}

/** Thrown by a prompt the user dismissed. Not a failure: the flow just stops. */
export class SigningCancelled extends Error {
  constructor() {
    super('Signing cancelled');
    this.name = 'SigningCancelled';
  }
}

/**
 * Dismissals that reach us as plain errors, matched on the exact text their sources
 * throw. Keep these in step with those sources; a mismatch turns "the user changed
 * their mind" into a "signing failed" dialog.
 */
const DISMISSED = new Set([
  // useNativeSwapSigner.cancelKeystone
  'Keystone signing cancelled',
  // webauthn-prf.ts evaluatePrfForWallet, on NotAllowedError/AbortError
  'PassKey authentication was cancelled',
  // PassKeyAuth.vue popup (side panel), relayed by PassKeyAuthButton
  'User cancelled',
]);

const REALFI_ASSET_IDS = Object.values(REALFI_ASSETS).flatMap((n) => [n.usdr, n.susdr]);

const BUSY: readonly RealFiOrderStage[] = ['building', 'signing', 'submitting'];

export function useRealFiOrder(signer: RealFiOrderSigner) {
  const stage = ref<RealFiOrderStage>('idle');
  const kind = ref<RealFiOrderKind | null>(null);
  const error = ref<RealFiOrderError | null>(null);
  /** The submitted transaction's id, once the chain has accepted it. */
  const txId = ref<string | null>(null);

  function reset(): void {
    stage.value = 'idle';
    kind.value = null;
    error.value = null;
    txId.value = null;
  }

  function fail(err: RealFiOrderError): null {
    debugLog('[RealFi] order failed', err.reason, err.message);
    error.value = err;
    stage.value = 'error';
    return null;
  }

  /**
   * Place one order. Resolves to the submitted tx id, or null when it failed (see
   * `error`) or the user dismissed the signing prompt (`stage` back to idle).
   */
  async function run(req: RealFiBuildRequest): Promise<string | null> {
    if (BUSY.includes(stage.value)) return null;
    reset();
    kind.value = req.kind;

    const wallet = walletStore.loggedWallet;
    const changeAddress = wallet?.baseAddress;
    if (!wallet || !changeAddress) return fail(new RealFiOrderError('build-failed'));
    const utxos = (walletStore.utxos || []) as Cardano.Utxo[];

    stage.value = 'building';
    let built;
    try {
      built = await buildOrder(req, {
        network: wallet.network,
        changeAddress,
        utxos: selectBuildUtxos(utxos, REALFI_ASSET_IDS, utxoToCip30Hex),
      });
    } catch (err) {
      return fail(err instanceof RealFiOrderError ? err : new RealFiOrderError('build-failed'));
    }

    stage.value = 'signing';
    let witnessHex: string;
    try {
      witnessHex = await signer.signTx(built.txCbor);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof SigningCancelled || DISMISSED.has(message)) {
        reset();
        return null;
      }
      const reason = message === 'Invalid spending password' ? 'wrong-password' : 'sign-failed';
      return fail(new RealFiOrderError(reason, null, message));
    }

    stage.value = 'submitting';
    try {
      const res = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SUBMIT_TX,
        data: { txCbor: built.txCbor, witnessHex, utxos },
      })) as { data?: { txId?: string; error?: string } };
      if (!res?.data?.txId) {
        return fail(new RealFiOrderError('submit-failed', null, res?.data?.error));
      }
      txId.value = res.data.txId;
    } catch (err) {
      return fail(
        new RealFiOrderError('submit-failed', null, err instanceof Error ? err.message : undefined),
      );
    }

    stage.value = 'done';
    return txId.value;
  }

  return { stage, kind, error, txId, run, reset };
}
