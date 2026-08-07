import { Cardano } from '@cardano-sdk/core';
import { Blockchain, coin_type, purpose } from '@/models/types';
import networks from '@/utils/networks';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { SENDER, TARGET } from '@/chrome/config';
import WalletStore from '@/stores/walletStore';
import { debugLog } from '@/utils/debug';

/**
 * Document-context dispatcher for Trezor operations (WebUSB + Bridge transport).
 *
 * Mirrors the `MessageTypes.TREZOR` handler in `src/chrome/background.ts`
 * (per-`data.method` branches) FAITHFULLY, but calls `trezorWeb.*`
 * (document-context `@trezor/connect-web`, see `src/shared/utils/trezorWeb.ts`)
 * instead of `trezor.*` (service-worker / bridge-only, `src/shared/utils/trezor.ts`).
 *
 * Resolves to the SAME envelope shape the background handler's `sendResponse`
 * produces for each method (`{ data: {...}, target, sender }`), so senders that
 * currently read `response.data.xxx` from
 * `Messaging.sendToBackground*({ method: MessageTypes.TREZOR, data })` keep working
 * unchanged when flag-routed through this helper instead.
 *
 * Runs in a DOCUMENT context (sidepanel/popup/options) — all callers are Vue
 * components/composables in those contexts, where WebUSB is available.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function dispatchTrezor(data: any): Promise<any> {
  try {
    // Lazy-loaded so `@trezor/connect-web` (pulled in by trezorWeb) is only added
    // to a document bundle when Trezor WebUSB is actually dispatched, instead of
    // being statically bundled for every user of the 8 Cardano sender sites.
    const trezorWeb = (await import('@/shared/utils/trezorWeb')).default;

    if (data.method === 'initTrezor') {
      const network = networks.resolveNetwork(data.chain, data.network);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let coldWalletProps: any;
      if (network.blockchain === Blockchain.CARDANO) {
        const path = `m/${purpose.hdwallet}'/${coin_type.cardano}'/0'`;
        coldWalletProps = await trezorWeb.getXpub(path);
      } else if (network.blockchain === Blockchain.BITCOIN) {
        // Bitcoin wallet - use default SegWit address type
        coldWalletProps = await trezorWeb.initBitcoinTrezor('segwit', 0);

        // Format Bitcoin response to match expected structure
        if (coldWalletProps) {
          const { xpub, deviceLabel, firmwareVersion } = coldWalletProps;
          coldWalletProps = {
            productName: deviceLabel,
            hwPublicKey: xpub,
            keys: [{ publicKey: xpub, chainCode: '', path: "m/84'/0'/0'" }],
            btSupported: true,
            version: firmwareVersion,
          };
        }
      }

      return {
        data: { success: true, coldWalletProps },
        target: TARGET,
        sender: SENDER.extension,
      };
    } else if (data.method === 'signData') {
      const { address, payload, accountIndex } = data;
      // Document context has no `walletManager` (service-worker only). The
      // currently active wallet's chain/network are already mirrored onto
      // WalletStore (see CLAUDE.md "State Management"), so we resolve the
      // network from there instead of `walletManager.getWallet()`.
      const { loggedWallet } = WalletStore.state;
      const network = networks.resolveNetwork(loggedWallet.chain, loggedWallet.network);

      // Sign data with Trezor
      const signatureData: {
        signatureHex: string;
        signingPublicKeyHex: string;
        addressFieldHex: string;
      } = await trezorWeb.cardanoSignMessage(address, payload, network.networkId, accountIndex, WalletStore.state.keys);

      return {
        data: { success: true, signatureData },
        target: TARGET,
        sender: SENDER.extension,
      };
    } else if (data.method === 'signTx') {
      const { txCbor } = data;

      const tx = deserializeCardanoJsSdkTx(txCbor);

      // For partial transactions, strip existing witnesses before signing with Trezor
      // This prevents Trezor from seeing/including witnesses from the partial transaction
      const txWithoutWitnesses: Cardano.Tx = {
        ...tx,
        witness: {
          signatures: new Map(),
          // Preserve other witness fields that Trezor needs (scripts, datums, redeemers)
          ...(tx.witness?.scripts && { scripts: tx.witness.scripts }),
          ...(tx.witness?.datums && { datums: tx.witness.datums }),
          ...(tx.witness?.redeemers && { redeemers: tx.witness.redeemers }),
        }
      };

      const utxos = WalletStore.state.utxos as Cardano.Utxo[];

      // Get current wallet and network info (see `signData` note above re: WalletStore)
      const { loggedWallet } = WalletStore.state;
      const network = networks.resolveNetwork(loggedWallet.chain, loggedWallet.network);

      // Sign transaction with Trezor SDK (includes witness filtering)
      // Pass original CBOR to preserve exact transaction hash computation
      const signatures: Cardano.Signatures = await trezorWeb.cardanoSignTransaction(
        txWithoutWitnesses,
        WalletStore.state.keys,
        utxos,
        false,
        network,
        WalletStore.state.loggedWallet.publicKey,
        txCbor  // Pass original CBOR for correct hash computation
      );

      // Convert Map to array for consistency with the background handler's response
      // (the background handler does this to survive Chrome messaging serialization;
      // kept identical here so senders that expect an array are unaffected)
      const signaturesArray = Array.from(signatures.entries());

      return {
        data: { success: true, signatures: signaturesArray },
        target: TARGET,
        sender: SENDER.extension,
      };
    } else if (data.method === 'verifyBitcoinAddress') {
      // Verify Bitcoin address on Trezor device
      const { addressType, accountIndex, addressIndex, isChange } = data;

      const verifiedAddress = await trezorWeb.verifyBitcoinAddress(
        addressType || 'segwit',
        accountIndex || 0,
        addressIndex || 0,
        isChange || false
      );

      return {
        data: { success: true, address: verifiedAddress },
        target: TARGET,
        sender: SENDER.extension,
      };
    }

    // Unknown method - background.ts's handler simply falls through without
    // calling sendResponse for an unmatched method (the Chrome message would
    // then time out). Since dispatchTrezor is a Promise that MUST resolve,
    // it returns an explicit failure instead of hanging forever.
    return {
      data: { success: false, error: `Unknown Trezor method: ${data?.method}` },
      target: TARGET,
      sender: SENDER.extension,
    };
  } catch (err) {
    debugLog('[TREZOR WebUSB] Error:', err);
    return {
      data: { success: false, error: (err instanceof Error ? err.message : 'Trezor operation failed') },
      target: TARGET,
      sender: SENDER.extension,
    };
  }
}

export default dispatchTrezor;
