import { ref } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { UR } from '@keystonehq/keystone-sdk';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
import type { Wallet, Key } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import ledgerUtils from '@/shared/utils/ledger';
import { dispatchTrezor } from '@/shared/utils/trezorDispatch';
import { createKeystoneSignRequest, parseSignature } from '@/shared/utils/keystone';
import networks from '@/utils/networks';
import { utxoToCip30Hex } from './utxoToCip30Hex';

/**
 * Native `Signer` for the embedded `<gero-swap>` widget — dispatches signing across
 * all 5 wallet types, mirroring the exact branches in the (now-retired) SwapSheet.vue:
 * password (SwapSheet.vue:1043-1102), PRF/PassKey (:1117-1160), Ledger (:1176-1219),
 * Trezor (:1230-1270), Keystone (:1284-1335).
 *
 * OPAQUE CBOR INVARIANT: `unsignedTxCbor` is exactly what the widget will submit
 * (cbor + witness-set hex, aggregator co-signs). HW branches that need a Cardano.Tx
 * object (Ledger/Keystone) derive it from this SAME cbor for signing purposes only —
 * they never re-encode the tx body that gets submitted.
 */
export interface NativeSwapSignerOptions {
  /** Host prompts for the spending password (password wallets only). */
  getPassword: () => Promise<string>;
  /** Host runs the PassKey/PRF popup and returns the raw private key bytes. */
  getPrfBytes: () => Promise<Uint8Array>;
  /**
   * Whether to use the Bluetooth Ledger transport instead of USB. Mirrors the `isBT`
   * UI toggle every other Ledger-signing flow exposes (SwapSheet.vue:549, SendSheet.vue:635,
   * etc.) — the swap widget has no such toggle yet, so this defaults to USB (false).
   * Gap: if/when the embed adds a BT toggle, wire it through here.
   */
  getIsBT?: () => boolean;
}

function isPrfWallet(w: Wallet | null | undefined): boolean {
  return w?.encryptionMethod === 'prf' || (!!w?.prfEncryptedPrivateKey && !!w?.webAuthnCredentialId);
}

/** The signer only ever runs for Cardano wallets (the swap widget is Cardano-only). */
function cardanoUtxos(): Cardano.Utxo[] {
  return (walletStore.utxos || []) as Cardano.Utxo[];
}

interface SignTxData {
  txCbor: string;
  partialSign: true;
  accountIndex: number;
  utxos: Cardano.Utxo[];
  addresses: unknown;
  mergeWitnesses: false;
  password?: string;
  privateKeyBytes?: number[];
}

export function useNativeSwapSigner(opts: NativeSwapSignerOptions) {
  // Keystone QR state — the host wrapper renders KeystoneSignDialog off these refs,
  // exactly like SwapSheet.vue does with its own keystoneType/keystoneCbor/showKeystoneDialog.
  const keystoneType = ref('');
  const keystoneCbor = ref('');
  const keystoneShow = ref(false);
  let keystoneResolve: ((witnessHex: string) => void) | null = null;
  let keystoneReject: ((e: Error) => void) | null = null;

  async function getAddresses() {
    const keys = walletStore.keys;
    const used = [...(keys?.payment || []), ...(keys?.change || [])].map((k: Key) => k.address);
    return { used, change: walletStore.loggedWallet?.baseAddress };
  }

  async function getUtxos() {
    return cardanoUtxos().map(utxoToCip30Hex);
  }

  // Collateral for a Plutus script spend (order-cancel): the smallest ADA-only wallet UTxO
  // holding at least 5 ADA. Returns CIP-30 hex TransactionUnspentOutput(s), or [] when none
  // (the widget then prompts the user to receive ~5 ADA).
  async function getCollateral() {
    const COLLATERAL_MIN = 5_000_000n;
    return cardanoUtxos()
      .filter((u) => {
        const value = u[1]?.value;
        const adaOnly = !value?.assets || value.assets.size === 0;
        return adaOnly && (value?.coins ?? 0n) >= COLLATERAL_MIN;
      })
      .sort((a, b) => Number((a[1].value.coins ?? 0n) - (b[1].value.coins ?? 0n))) // smallest first
      .slice(0, 1)
      .map(utxoToCip30Hex);
  }

  // ── Password / PRF (background SIGN_TX) — SwapSheet.vue:1043-1102 / :1117-1160 ──
  async function signPasswordOrPrf(cbor: string): Promise<string> {
    const w = walletStore.loggedWallet;
    const data: SignTxData = {
      txCbor: cbor,
      partialSign: true,
      accountIndex: 0,
      utxos: cardanoUtxos(),
      addresses: walletStore.keys,
      mergeWitnesses: false,
    };

    if (isPrfWallet(w)) {
      const pk = await opts.getPrfBytes();
      data.privateKeyBytes = Array.from(pk);
    } else {
      const password = await opts.getPassword();
      const verify = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.VERIFY_SPENDING_PASSWORD,
        data: { password },
      })) as { data?: { success?: boolean } };
      if (!verify?.data?.success) throw new Error('Invalid spending password');
      data.password = password;
    }

    const res = (await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_TX,
      data,
    })) as { data?: { witnesses?: string; error?: string } };

    if (!res?.data?.witnesses) throw new Error(res?.data?.error || 'Signing failed');
    return res.data.witnesses;
  }

  // ── Ledger (client-side) — SwapSheet.vue:1176-1219 ──
  async function signLedger(cbor: string): Promise<string> {
    const w = walletStore.loggedWallet;
    // Derive the Tx CORE from the SAME opaque cbor the widget will submit — signing input
    // only, never a re-encoded body (mirrors SwapSheet's txSerialized.toCore() exactly).
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

  // ── Trezor (client-side, via background message) — SwapSheet.vue:1230-1270 ──
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

  // ── Keystone (QR round-trip) — SwapSheet.vue:1284-1335 ──
  async function signKeystone(cbor: string): Promise<string> {
    // Same opaque cbor, parsed (not re-encoded) for the QR sign request.
    const txSerialized = Serialization.Transaction.fromCbor(cbor as never);
    const signRequestResponse = createKeystoneSignRequest(
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

  async function signTx(unsignedTxCbor: string): Promise<string> {
    const type = walletStore.loggedWallet?.type;
    if (type === WalletType.Ledger) return signLedger(unsignedTxCbor);
    if (type === WalletType.Trezor) return signTrezor(unsignedTxCbor);
    if (type === WalletType.Keystone) return signKeystone(unsignedTxCbor);
    return signPasswordOrPrf(unsignedTxCbor); // Normal (password) + PRF flag on Normal
  }

  const signer = { getAddresses, getUtxos, getCollateral, signTx, meta: { name: 'Gero' } };

  return {
    signer,
    keystone: { keystoneType, keystoneCbor, keystoneShow, onKeystoneScan, cancelKeystone, failKeystone },
  };
}
