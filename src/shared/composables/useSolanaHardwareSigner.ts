import { ref } from 'vue';
import type { UR } from '@keystonehq/keystone-sdk';
import { Network, WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import hardwareLoading from '@/plugins/hardwareLoading';
import { useTranslation } from '@/shared/composables/useTranslation';
import { resolveAccountIndex } from '@/shared/utils/walletAccount';
import { isSolanaHardware, solanaHardwareSignsMessages } from '@/chains/solana/solanaHardwarePolicy';
import type { SolanaTokenAccountInfo } from '@/chrome/solanaTokenSend';
import { keystoneSolanaSignRequest, parseKeystoneSolanaSignature, type KeystoneSolanaSignKind } from '@/shared/utils/solanaKeystone';

/**
 * Has the logged Solana hardware wallet sign exact bytes and returns the 64-byte ed25519
 * signature. Shared by Gero's own Send (SolanaSendForm) and the side panel's dApp prompts.
 *
 * The caller never trusts the result on its own word: the worker checks every signature
 * against the account's address over the bytes it built or previewed (solanaSend.ts,
 * isSignedByWalletOnly, the signMessage and signIn handlers) before anything leaves Gero.
 *
 * - `transaction`: the bytes are a transaction MESSAGE (what a Solana signature covers).
 * - `message`: a dApp's raw message bytes. Keystone only (solanaHardwareSignsMessages).
 *
 * Keystone is a QR round trip: `sign` waits until the host's KeystoneSignDialog (or
 * KeystoneSignSheet), driven by the `keystone` refs, scans the answer, fails or is cancelled.
 */
export class SolanaHardwareSignError extends Error {
  constructor(message: string, readonly cancelled = false) {
    super(message);
    this.name = 'SolanaHardwareSignError';
  }
}

export function useSolanaHardwareSigner(opts: { getIsBT?: () => boolean } = {}) {
  const { t } = useTranslation();
  const keystoneType = ref('');
  const keystoneCbor = ref('');
  const keystoneShow = ref(false);
  let keystoneRequestId = '';
  let keystoneResolve: ((signature: Uint8Array) => void) | null = null;
  let keystoneReject: ((e: Error) => void) | null = null;

  function settleKeystone(): void {
    keystoneShow.value = false;
    keystoneResolve = null;
    keystoneReject = null;
    keystoneRequestId = '';
  }

  function onKeystoneScan(ur: UR): void {
    const resolve = keystoneResolve;
    const reject = keystoneReject;
    try {
      const signature = parseKeystoneSolanaSignature(ur, keystoneRequestId);
      settleKeystone();
      resolve?.(signature);
    } catch (e) {
      settleKeystone();
      reject?.(e as Error);
    }
  }

  function cancelKeystone(): void {
    const reject = keystoneReject;
    settleKeystone();
    reject?.(new SolanaHardwareSignError(t('solana.hardware.cancelled'), true));
  }

  function failKeystone(message: string): void {
    const reject = keystoneReject;
    settleKeystone();
    reject?.(new SolanaHardwareSignError(message || t('wallet.keystoneQRScanError')));
  }

  /** Whether the logged wallet signs `kind` on its device. */
  function canSign(kind: KeystoneSolanaSignKind): boolean {
    const type = walletStore.loggedWallet?.type;
    return kind === 'transaction' ? isSolanaHardware(type) : solanaHardwareSignsMessages(type);
  }

  async function sign(
    bytes: Uint8Array,
    kind: KeystoneSolanaSignKind,
    /** For Trezor's screen: the token accounts a transfer names (from the worker's prepare). */
    tokenAccounts?: SolanaTokenAccountInfo[],
  ): Promise<Uint8Array> {
    const wallet = walletStore.loggedWallet;
    if (!wallet || !canSign(kind)) throw new SolanaHardwareSignError(t('solana.hardware.cannotSignMessage'));
    const accountIndex = resolveAccountIndex(wallet);
    const address = wallet.publicKey;

    if (wallet.type === WalletType.Keystone) {
      // One QR round trip at a time: a request still showing is cancelled, so its promise settles.
      if (keystoneReject) cancelKeystone();
      const request = keystoneSolanaSignRequest({ bytes, kind, accountIndex, xfp: (wallet as { xfp?: string }).xfp ?? '', address });
      keystoneRequestId = request.requestId;
      keystoneType.value = request.type;
      keystoneCbor.value = request.cbor;
      keystoneShow.value = true;
      return new Promise<Uint8Array>((resolve, reject) => {
        keystoneResolve = resolve;
        keystoneReject = reject;
      });
    }

    const device = wallet.type === WalletType.Ledger ? 'Ledger' : 'Trezor';
    hardwareLoading.begin(device, t('wallet.followHardwareInstructions', { walletType: device }));
    try {
      if (wallet.type === WalletType.Ledger) {
        const { signSolanaWithLedger } = await import('@/shared/utils/solanaLedger');
        return await signSolanaWithLedger(opts.getIsBT?.() ?? false, accountIndex, bytes);
      }
      const trezor = (await import('@/shared/utils/trezor')).default;
      return await trezor.signSolanaTransaction(accountIndex, bytes, wallet.network !== Network.MAINNET, tokenAccounts);
    } finally {
      hardwareLoading.setLoading(false);
    }
  }

  return {
    sign,
    canSign,
    keystone: { keystoneType, keystoneCbor, keystoneShow, onKeystoneScan, cancelKeystone, failKeystone },
  };
}
