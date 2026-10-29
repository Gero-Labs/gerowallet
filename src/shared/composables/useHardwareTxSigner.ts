import { ref } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import type { UR } from '@keystonehq/keystone-sdk';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import ledgerUtils from '@/shared/utils/ledger';
import { dispatchTrezor } from '@/shared/utils/trezorDispatch';
import { createKeystoneSignRequest, parseSignature } from '@/shared/utils/keystone';
import networks from '@/utils/networks';

/**
 * Signs exact transaction bytes on the logged wallet's hardware device and returns the
 * witness set CBOR. Shared by the swap widget's signer (useNativeSwapSigner) and Gero's own
 * Send of a CIP-113 token (useCip113Send).
 *
 * OPAQUE CBOR INVARIANT: the bytes passed in are the bytes that get submitted. Ledger and
 * Keystone parse them to build the device request; nothing here re-encodes the body.
 *
 * Each device path asks the worker first, as every hardware signature does: txToLedger and
 * createKeystoneSignRequest call the CIP-113 preflight, and Trezor goes through
 * dispatchTrezor or the worker's TREZOR handler. A refusal throws CIP113_SIGN_REFUSAL_MESSAGE.
 *
 * Keystone is a QR round trip: `sign` waits until the host's KeystoneSignDialog, driven by
 * the `keystone` refs, scans the device's answer, fails or is cancelled.
 */
export interface HardwareTxSignerOptions {
  /**
   * Whether to use the Bluetooth Ledger transport instead of USB: the user's choice for this
   * signature, never `loggedWallet.btSupported` (that says the device CAN use Bluetooth, not
   * that it is connected that way). Defaults to USB.
   */
  getIsBT?: () => boolean;
}

const HARDWARE_TYPES: readonly string[] = [WalletType.Ledger, WalletType.Trezor, WalletType.Keystone];

/** Whether this wallet type signs on a device (Ledger, Trezor, Keystone). */
export function signsOnDevice(type: string | null | undefined): boolean {
  return typeof type === 'string' && HARDWARE_TYPES.includes(type);
}

function cardanoUtxos(): Cardano.Utxo[] {
  return (walletStore.utxos || []) as Cardano.Utxo[];
}

export function useHardwareTxSigner(opts: HardwareTxSignerOptions = {}) {
  // Keystone QR state: the host renders KeystoneSignDialog off these refs.
  const keystoneType = ref('');
  const keystoneCbor = ref('');
  const keystoneShow = ref(false);
  let keystoneResolve: ((witnessHex: string) => void) | null = null;
  let keystoneReject: ((e: Error) => void) | null = null;

  async function signLedger(cbor: string): Promise<string> {
    const w = walletStore.loggedWallet;
    // The Tx CORE comes from the SAME opaque cbor, for the signing request only; txToLedger
    // is handed the cbor itself so the device signs these bytes' body.
    const txSerialized = Serialization.Transaction.fromCbor(cbor as never);
    const txCore = txSerialized.toCore();

    const signatures: Cardano.Signatures = await ledgerUtils.txToLedger(
      txCore,
      walletStore.keys,
      cardanoUtxos(),
      !(opts.getIsBT?.() ?? false),
      networks.resolveNetwork(w?.chain, w?.network),
      cbor,
    );
    const transactionWitnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures });
    return transactionWitnessSet.toCbor() as unknown as string;
  }

  async function signTrezor(cbor: string): Promise<string> {
    const data = { method: 'signTx', txCbor: cbor };
    const response = (featureFlagsStore.state.flags.isTrezorWebUsbEnabled
      ? await dispatchTrezor(data)
      : await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.TREZOR,
        data,
      })) as { data?: { success?: boolean; error?: string; signatures?: Array<[string, string]> } };

    if (!response?.data?.success) throw new Error(response?.data?.error || 'Trezor signing failed');

    const signatures: Cardano.Signatures = new Map(response.data.signatures || []);
    const transactionWitnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures });
    return transactionWitnessSet.toCbor() as unknown as string;
  }

  async function signKeystone(cbor: string): Promise<string> {
    // Same opaque cbor, parsed (not re-encoded) for the QR sign request.
    const txSerialized = Serialization.Transaction.fromCbor(cbor as never);
    const signRequestResponse = await createKeystoneSignRequest(
      txSerialized,
      walletStore.loggedWallet,
      cardanoUtxos(),
      walletStore.keys,
    );
    keystoneType.value = signRequestResponse.ur.type;
    keystoneCbor.value = signRequestResponse.ur.cbor.toString('hex');
    keystoneShow.value = true;

    return new Promise<string>((resolve, reject) => {
      keystoneResolve = resolve;
      keystoneReject = reject;
    });
  }

  function onKeystoneScan(ur: UR) {
    try {
      const signature = parseSignature(ur);
      if (!signature?.witnessSet || typeof signature.witnessSet !== 'string') {
        throw new Error('Invalid Keystone signature');
      }
      keystoneShow.value = false;
      keystoneResolve?.(signature.witnessSet);
    } catch (e) {
      keystoneShow.value = false;
      keystoneReject?.(e as Error);
    } finally {
      keystoneResolve = null;
      keystoneReject = null;
    }
  }

  function cancelKeystone() {
    keystoneShow.value = false;
    keystoneReject?.(new Error('Keystone signing cancelled'));
    keystoneResolve = null;
    keystoneReject = null;
  }

  function failKeystone(msg: string) {
    keystoneShow.value = false;
    keystoneReject?.(new Error(msg || 'Keystone signing failed'));
    keystoneResolve = null;
    keystoneReject = null;
  }

  /** Sign on the logged wallet's device. Throws for a wallet that does not sign on one. */
  function sign(cbor: string): Promise<string> {
    switch (walletStore.loggedWallet?.type) {
      case WalletType.Ledger: return signLedger(cbor);
      case WalletType.Trezor: return signTrezor(cbor);
      case WalletType.Keystone: return signKeystone(cbor);
      default: return Promise.reject(new Error('This wallet does not sign on a hardware device'));
    }
  }

  return {
    sign,
    keystone: { keystoneType, keystoneCbor, keystoneShow, onKeystoneScan, cancelKeystone, failKeystone },
  };
}
