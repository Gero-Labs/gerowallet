import { computed, onScopeDispose, provide, ref, watch, type Ref } from 'vue';
import { authorizationScopeKey } from '@/shared/composables/authorizationScope';
import { signsOnDevice } from '@/shared/composables/useHardwareTxSigner';
import {
  PREPARED_TX_SIGN_FAILED,
  type PreparedTxCredentials,
  type PreparedTxFailure,
  type PreparedTxStage,
} from '@/shared/composables/usePreparedTxFlow';
import { walletStore } from '@/stores/walletStore';
import { WalletType } from '@/models/types';

/**
 * The credentials half of a transaction the background worker prepared, for the host that shows
 * the review and signs it: Gero's own Send of a CIP-113 token (ProgrammableSendFlow) and the
 * rescue of a closed marketplace's listings (LegacyCancelDialog) both use it with
 * usePreparedTxFlow. The flow owns prepare, sign and submit; this owns what the user must give
 * it and what keeps that safe:
 *
 *  - which credential the logged wallet signs with: the spending password (password wallets), a
 *    PassKey (PRF wallets), nothing to type (Google wallets, which sign with the unlocked
 *    session), or a device (Ledger, Trezor, Keystone), with the hint and icon for the device;
 *  - the password handoff: the typed password leaves the field before it is passed on and is
 *    never kept, and a PassKey result that cannot be used has its key bytes zeroed;
 *  - the PassKey staleness epoch (`authorizationScopeKey`): a PassKey result belongs to the
 *    transaction on screen when the ceremony started, so a new build, a change of screen or a
 *    wallet switch makes it stale (PassKeyAuthButton checks before emitting);
 *  - the wallet-switch guard: a transaction belongs to the wallet it was built for, so another
 *    wallet resets the flow (the worker would refuse to sign it anyway), checked again when a
 *    request settles because a switch while one is in flight cannot reset it then.
 *
 * Call it in the host's `setup`, after creating the flow: it provides the epoch to the PassKey
 * controls below the host and is disposed with it. The markup is PreparedTxCredentials.vue.
 */

/** What this needs of a usePreparedTxFlow result. */
export interface PreparedTxCredentialsFlow {
  stage: Ref<PreparedTxStage>;
  prepared: Ref<{ txId: string } | null>;
  failure: Ref<PreparedTxFailure | null>;
  signAndSubmit: (credentials?: PreparedTxCredentials) => Promise<boolean>;
  reset: () => void;
}

export interface PreparedTxCredentialsOptions {
  /** Ledger only: Bluetooth when the user picks it. Created by the host before the flow, which reads it. */
  isBT: Ref<boolean>;
  /**
   * What the host shows. 'review' is the screen that asks for credentials: nothing is signed
   * from any other, and a change of screen makes a pending PassKey result stale.
   */
  screen: () => string;
  /** Which hardware wallet types may sign here. Default: every type that signs on a device. */
  allowsDevice?: (walletType: string | null | undefined) => boolean;
  /** Whether the host is showing a transaction; a wallet switch is ignored while it is not. Default: always. */
  isActive?: () => boolean;
  /** Runs after a wallet switch reset the flow and cleared the password. */
  onWalletSwitch?: () => void;
}

export function usePreparedTxCredentials(flow: PreparedTxCredentialsFlow, options: PreparedTxCredentialsOptions) {
  const { isBT, screen } = options;
  const allowsDevice = options.allowsDevice ?? (() => true);
  const isActive = options.isActive ?? (() => true);

  const password = ref('');
  const wallet = computed(() => walletStore.loggedWallet);
  const busy = computed(() => flow.stage.value === 'preparing' || flow.stage.value === 'signing' || flow.stage.value === 'submitting');

  const isPrfWallet = computed(() =>
    wallet.value?.type === WalletType.Normal && (
      wallet.value?.encryptionMethod === 'prf'
      || (!!wallet.value?.prfEncryptedPrivateKey && !!wallet.value?.webAuthnCredentialId)
    ),
  );
  const usesPassword = computed(() => wallet.value?.type === WalletType.Normal && !isPrfWallet.value);
  /** The device that signs, for a hardware wallet allowed here; null otherwise. */
  const deviceType = computed(() => (signsOnDevice(wallet.value?.type) && allowsDevice(wallet.value?.type) ? wallet.value?.type ?? null : null));
  /** A hardware wallet that signs on a device but is not allowed here: the host says so instead of building anything. */
  const deviceBlocked = computed(() => signsOnDevice(wallet.value?.type) && !allowsDevice(wallet.value?.type));
  const deviceIcon = computed(() => {
    if (deviceType.value === WalletType.Keystone) return 'mdi-qrcode-scan';
    return deviceType.value === WalletType.Ledger && isBT.value ? 'mdi-bluetooth' : 'mdi-usb';
  });
  const deviceHintKey = computed(() => {
    switch (deviceType.value) {
      case WalletType.Ledger: return 'miniGero.connectLedger';
      case WalletType.Trezor: return 'miniGero.connectTrezor';
      default: return 'miniGero.keystoneSign';
    }
  });

  // A PassKey result belongs to the transaction on screen when the ceremony started: a new build,
  // a change of screen or a wallet switch makes it stale (PassKeyAuthButton checks before emitting).
  let epoch = 0;
  let disposed = false;
  provide(authorizationScopeKey, {
    capture() {
      const captured = epoch;
      return () => !disposed && captured === epoch;
    },
  });
  watch(() => [flow.prepared.value?.txId, screen(), wallet.value?.id] as const, () => { epoch++; }, { flush: 'sync' });
  onScopeDispose(() => { disposed = true; epoch++; });

  // A transaction belongs to the wallet it was built for: another wallet starts over (the worker
  // would refuse to sign it anyway). Checked again when a request settles, since a switch while
  // one is in flight cannot reset it then.
  let builtForWalletId: number | undefined;
  watch(() => [wallet.value?.id, busy.value] as const, ([id, isBusy]) => {
    if (!isActive() || isBusy || builtForWalletId === undefined || id === builtForWalletId) return;
    builtForWalletId = undefined;
    password.value = '';
    flow.reset();
    options.onWalletSwitch?.();
  });

  /** The host is about to build a transaction: no password carried over, and it is built for the logged wallet. */
  function begin(): void {
    password.value = '';
    builtForWalletId = wallet.value?.id;
  }

  function clearPassword(): void {
    password.value = '';
  }

  function setPassword(value: string): void {
    password.value = value;
  }

  function setIsBT(value: boolean): void {
    isBT.value = value;
  }

  /** Sign and submit with the spending password, or with the session or device for wallets that type nothing. */
  async function send(): Promise<void> {
    if (busy.value || screen() !== 'review') return;
    if (usesPassword.value) {
      if (!password.value) return;
      const typed = password.value;
      // OX Agent: Sensitive Data Protection prevented by taking the typed password out of the field before signing; it is never logged or kept
      password.value = '';
      await flow.signAndSubmit({ password: typed });
      return;
    }
    // Google wallets sign with the unlocked session and hardware wallets on the device:
    // nothing to type.
    await flow.signAndSubmit();
  }

  async function sendWithPassKey(privateKeyBytes: Uint8Array): Promise<void> {
    if (busy.value || screen() !== 'review') {
      privateKeyBytes.fill(0);
      return;
    }
    await flow.signAndSubmit({ privateKeyBytes });
  }

  function onPassKeyError(): void {
    flow.failure.value = { code: PREPARED_TX_SIGN_FAILED };
  }

  return {
    wallet, busy, password, isBT,
    isPrfWallet, usesPassword, deviceType, deviceBlocked, deviceIcon, deviceHintKey,
    begin, clearPassword, setPassword, setIsBT,
    send, sendWithPassKey, onPassKeyError,
  };
}

export type PreparedTxCredentialsState = ReturnType<typeof usePreparedTxCredentials>;
