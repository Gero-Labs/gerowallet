import type { Cardano } from '@cardano-sdk/core';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import type { Wallet, Key } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { signsOnDevice, useHardwareTxSigner } from '@/shared/composables/useHardwareTxSigner';
import { utxoToCip30Hex } from './utxoToCip30Hex';
import { cosignLentCollateral, lendPoolCollateral } from './swapCollateral';

/**
 * Native `Signer` for the embedded `<gero-swap>` widget — dispatches signing across
 * all 5 wallet types, mirroring the exact branches in the (now-retired) SwapSheet.vue:
 * password (SwapSheet.vue:1043-1102) and PRF/PassKey (:1117-1160) here, and Ledger,
 * Trezor and Keystone through useHardwareTxSigner.
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
   * UI toggle every other Ledger-signing flow exposes (SendSheet.vue, CastVoteDialog.vue,
   * etc.) and defaults to USB (false). Return the user's choice, never
   * `loggedWallet.btSupported`: that says the device CAN use Bluetooth, not that it is
   * connected that way. GeroSwapEmbed.vue asks before each Ledger signature.
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
  utxos: Cardano.Utxo[];
  addresses: unknown;
  mergeWitnesses: false;
  password?: string;
  privateKeyBytes?: number[];
}

export function useNativeSwapSigner(opts: NativeSwapSignerOptions) {
  // Ledger, Trezor and Keystone. The host renders KeystoneSignDialog off `keystone`'s refs.
  const hardware = useHardwareTxSigner({ getIsBT: opts.getIsBT });

  async function getAddresses() {
    const keys = walletStore.keys;
    const used = [...(keys?.payment || []), ...(keys?.change || [])].map((k: Key) => k.address);
    return { used, change: walletStore.loggedWallet?.baseAddress };
  }

  async function getUtxos() {
    return cardanoUtxos().map(utxoToCip30Hex);
  }

  // Collateral for a Plutus script spend (order-cancel): the smallest ADA-only wallet UTxO
  // holding at least 5 ADA, else one borrowed from the Nexus pool (the wallet covers its
  // users' collateral, as it does for trusted dApps through CIP-30). Returns CIP-30 hex
  // TransactionUnspentOutput(s), or [] when the pool cannot lend either (the widget then
  // prompts the user to set collateral aside).
  async function getCollateral() {
    const COLLATERAL_MIN = 5_000_000n;
    const own = cardanoUtxos()
      .filter((u) => {
        const value = u[1]?.value;
        const adaOnly = !value?.assets || value.assets.size === 0;
        return adaOnly && (value?.coins ?? 0n) >= COLLATERAL_MIN;
      })
      .sort((a, b) => Number((a[1].value.coins ?? 0n) - (b[1].value.coins ?? 0n))) // smallest first
      .slice(0, 1)
      .map(utxoToCip30Hex);
    if (own.length) return own;
    try {
      return [await lendPoolCollateral(walletStore.loggedWallet?.network)];
    } catch {
      return [];
    }
  }

  // ── Password / PRF (background SIGN_TX) — SwapSheet.vue:1043-1102 / :1117-1160 ──
  async function signPasswordOrPrf(cbor: string): Promise<string> {
    const w = walletStore.loggedWallet;
    const data: SignTxData = {
      txCbor: cbor,
      partialSign: true,
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

  async function signTx(unsignedTxCbor: string): Promise<string> {
    // Hardware wallets sign in the page, so a collateral input borrowed from the Nexus pool
    // gets its co-signature here; password and PRF wallets get it in the worker's SIGN_TX.
    if (signsOnDevice(walletStore.loggedWallet?.type)) {
      return cosignLentCollateral(unsignedTxCbor, await hardware.sign(unsignedTxCbor), walletStore.loggedWallet?.network);
    }
    return signPasswordOrPrf(unsignedTxCbor); // Normal (password) + PRF flag on Normal
  }

  const signer = { getAddresses, getUtxos, getCollateral, signTx, meta: { name: 'Gero' } };

  return { signer, keystone: hardware.keystone };
}
