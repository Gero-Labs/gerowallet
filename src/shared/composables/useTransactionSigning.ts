import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ref, ComputedRef, toRefs, ref, computed } from 'vue';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { BackgroundResponse, Messaging, SignTxResponse, VerifyPasswordResponse } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Blockchain, WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { remoteSigningStore } from '@/stores/remoteSigningStore';
import ledgerUtils from '@/shared/utils/ledger';
import { createKeystoneSignRequest, KeystoneSignRequestResponse, parseSignature } from '@/shared/utils/keystone';
import networks from '@/utils/networks';
import rules from '@/utils/rules';
import snackbar from '@/plugins/snackbar';
import { useTranslation } from './useTranslation';
import { UR } from '@keystonehq/keystone-sdk';

export interface TransactionSigningOptions {
  tx: Ref<Cardano.Tx | undefined> | ComputedRef<Cardano.Tx | undefined>;
  successMessageKey: string;
  onSuccess?: (txId: string) => void;
  onClose?: () => void;
}

export interface TransactionSigningReturn {
  // State
  loading: Ref<boolean>;
  spendingPassword: Ref<string>;
  isSubmit: Ref<boolean>;
  isBT: Ref<boolean>;
  txCbor: Ref<string>;
  txWitnesses: Ref<string | null>;
  valid: Ref<boolean>;
  passwordRules: Ref<any[]>;
  privateKeyBytes: Ref<Uint8Array | null>;
  isPrfWallet: ComputedRef<boolean>;
  isBTSupported: ComputedRef<boolean>;
  canSignOnAnotherDevice: ComputedRef<boolean>;
  requiresRemoteForSend: ComputedRef<boolean>;
  // Keystone state
  overlay: Ref<boolean>;
  keystoneScan: Ref<boolean>;
  keystoneType: Ref<string>;
  keystoneCbor: Ref<string>;

  // Methods
  signTx: () => Promise<boolean>;
  signLedgerTx: () => Promise<boolean>;
  submitTx: () => Promise<void>;
  signOnAnotherDevice: () => Promise<void>;
  handleSign: (formRef?: { validate: () => boolean }) => Promise<void>;
  resetState: () => void;
  handlePassKeySuccess: () => void;
  handlePassKeyError: (error: string) => void;
  handlePassKeyAuthSuccess: (pkBytes: Uint8Array) => void;
  handlePassKeyAuthError: (error: Error) => void;
  setPasswordFieldRef: (ref: any) => void;
  // Keystone methods
  onKeystoneScan: (ur: UR) => Promise<void>;
  onKeystoneError: (error: string) => void;
  onKeystoneProgress: (progress: number) => void;
  backScan: () => void;
}

export function useTransactionSigning(options: TransactionSigningOptions): TransactionSigningReturn {
  const { t } = useTranslation();
  const { loggedWallet, utxos, keys, config } = toRefs(walletStore);

  // State
  const loading = ref(false);
  const spendingPassword = ref('');
  const passwordField = ref<any>(null);
  const valid = ref(false);
  const passwordRules = ref([rules.required()]);
  const isBT = ref(false);
  const txCbor = ref<string>('');
  const txWitnesses = ref<string | null>(null);
  const isSubmit = ref(false);
  const privateKeyBytes = ref<Uint8Array | null>(null);
  // Keystone state
  const overlay = ref(false);
  const keystoneScan = ref(false);
  const keystoneType = ref('');
  const keystoneCbor = ref('');

  // PRF wallet detection
  const isPrfWallet = computed(() => {
    return loggedWallet.value?.encryptionMethod === 'prf' ||
           (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId);
  });

  // Bluetooth support detection for Ledger/Trezor
  const isBTSupported = computed(() => {
    return (loggedWallet.value?.type === WalletType.Ledger || loggedWallet.value?.type === WalletType.Trezor) &&
      !isSubmit.value &&
      loggedWallet.value?.btSupported;
  });

  // Keep the per-wallet remote-signing settings warm so the gates below are live.
  void remoteSigningStore.ensureLoaded();

  const isCardanoSoftwareWallet = computed(() =>
    loggedWallet.value?.chain === Blockchain.CARDANO &&
    loggedWallet.value?.type === WalletType.Normal,
  );

  // Cross-device signing button: server flag + this wallet's opt-in + at least one
  // trusted, signing-capable device to actually answer. Dark by default.
  const canSignOnAnotherDevice = computed(() => {
    return featureFlagsStore.isCrossDeviceSigningEnabled() &&
      isCardanoSoftwareWallet.value &&
      remoteSigningStore.isEnabled() &&
      remoteSigningStore.hasTrustedSigner();
  });

  // When the policy is "require remote", local signing for a Send is disabled and
  // the user must approve on a trusted device (a genuine second factor).
  const requiresRemoteForSend = computed(() => {
    return featureFlagsStore.isCrossDeviceSigningEnabled() &&
      isCardanoSoftwareWallet.value &&
      remoteSigningStore.requiresRemoteForSend();
  });

  const setPasswordFieldRef = (ref: any) => {
    passwordField.value = ref;
  };

  const resetState = () => {
    spendingPassword.value = '';
    isSubmit.value = false;
    txCbor.value = '';
    txWitnesses.value = null;
    privateKeyBytes.value = null;
    loading.value = false;
  };

  const signTx = async (): Promise<boolean> => {
    loading.value = true;
    try {
      const tx = options.tx.value;
      if (!tx) {
        throw new Error(t('common.noTransactionToSign'));
      }

      // For password-based wallets, verify password via background message
      if (!isPrfWallet.value) {
        const passwordVerification = (await Messaging.sendToBackgroundFromOptions({
          method: MessageTypes.VERIFY_SPENDING_PASSWORD,
          data: { password: spendingPassword.value },
        })) as BackgroundResponse<VerifyPasswordResponse>;

        if (!passwordVerification.data.success) {
          passwordField.value?.showError(t('wallet.wrongSpendingPassword'));
          loading.value = false;
          return false;
        }
      }

      // Serialize the Cardano.Tx to CBOR
      txCbor.value = serializeCardanoJsSdkTx(tx);

      // Prepare signing data
      const signingData: any = {
        txCbor: txCbor.value,
        partialSign: false,
        password: spendingPassword.value,
        accountIndex: 0,
        utxos: utxos.value,
        addresses: keys.value,
        mergeWitnesses: false,
      };

      // For PRF wallets, pass the already-decrypted privateKeyBytes
      if (isPrfWallet.value && privateKeyBytes.value) {
        signingData.privateKeyBytes = Array.from(privateKeyBytes.value);
      }

      // Sign the transaction via background message
      const witnessResult = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SIGN_TX,
        data: signingData,
      })) as { data: { witnesses?: any; error?: string } };

      if (witnessResult.data.error) {
        throw new Error(witnessResult.data.error);
      }

      txWitnesses.value = witnessResult.data.witnesses;
      return true;
    } catch (e) {
      console.error('Error signing transaction:', e);
      snackbar.setError(e instanceof Error ? e.message : t('errors.unknownError'));
      return false;
    } finally {
      loading.value = false;
    }
  };

  const signLedgerTx = async (): Promise<boolean> => {
    loading.value = true;
    try {
      const tx = options.tx.value;
      if (!tx) {
        throw new Error(t('common.noTransactionToSign'));
      }

      txCbor.value = serializeCardanoJsSdkTx(tx);

      const signatures: Cardano.Signatures = await ledgerUtils.txToLedger(
        tx,
        keys.value,
        utxos.value as Cardano.Utxo[],
        !isBT.value, // isUsb flag (inverted from isBT)
        networks.resolveNetwork(loggedWallet.value.chain, loggedWallet.value.network)
      );

      const transactionWitnessSet: Serialization.TransactionWitnessSet = Serialization.TransactionWitnessSet.fromCore({
        signatures,
      });

      txWitnesses.value = transactionWitnessSet.toCbor();
      return true;
    } catch (e) {
      ledgerUtils.ledgerErrorHandling(e);
      return false;
    } finally {
      loading.value = false;
    }
  };

  const signTrezorTx = async (): Promise<boolean> => {
    loading.value = true;
    try {
      const tx = options.tx.value;
      if (!tx) {
        throw new Error(t('common.noTransactionToSign'));
      }

      txCbor.value = serializeCardanoJsSdkTx(tx);

      // Send serialized transaction to background for Trezor signing
      const response = await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.TREZOR,
        data: {
          method: 'signTx',
          txCbor: txCbor.value
        },
      }) as BackgroundResponse<SignTxResponse>;

      if (!response.data.success) {
        throw new Error(response.data.error || t('wallet.trezorSigningFailed'));
      }

      // Get signatures from Trezor response (comes as array from Chrome messaging)
      // Validate that signatures is an array before converting to Map
      if (!Array.isArray(response.data.signatures)) {
        throw new Error(t('wallet.trezorInvalidSignatureFormat'));
      }
      // Validate array contains valid tuples
      if (!response.data.signatures.every(
        item => Array.isArray(item) && item.length === 2 &&
                typeof item[0] === 'string' && typeof item[1] === 'string'
      )) {
        throw new Error(t('wallet.trezorInvalidSignatureFormat'));
      }
      const signatures: Cardano.Signatures = new Map(response.data.signatures);

      const transactionWitnessSet: Serialization.TransactionWitnessSet = Serialization.TransactionWitnessSet.fromCore({
        signatures,
      });

      txWitnesses.value = transactionWitnessSet.toCbor();
      return true;
    } catch (e) {
      console.error('Error signing transaction with Trezor:', e);
      if (e instanceof Error) {
        if (e.message.includes('Failure_ActionCancelled') || e.message.includes('cancelled') || e.message.includes('aborted')) {
          snackbar.setError(t('wallet.trezorTransactionCancelled'));
        } else if (e.message.toLowerCase().includes('device')) {
          snackbar.setError(t('wallet.trezorDeviceError', { message: e.message }));
        } else {
          snackbar.setError(e.message);
        }
      } else {
        snackbar.setError(t('errors.unknownError'));
      }
      return false;
    } finally {
      loading.value = false;
    }
  };

  const signKeystoneTx = async (): Promise<boolean> => {
    try {
      const tx = options.tx.value;
      if (!tx) {
        throw new Error(t('common.noTransactionToSign'));
      }

      // Validate that xfp exists for Keystone wallet
      if (!loggedWallet.value.xfp) {
        throw new Error(t('wallet.keystoneRequiresXfp'));
      }

      // Serialize transaction to CBOR
      txCbor.value = serializeCardanoJsSdkTx(tx);

      // Convert Cardano.Tx to Serialization.Transaction for Keystone
      const txSerialized = Serialization.Transaction.fromCbor(txCbor.value);

      // Create signing request UR from SDK (NOT stored in reactive ref to avoid Vue Observer wrapping)
      const signRequestResponse: KeystoneSignRequestResponse = createKeystoneSignRequest(txSerialized, loggedWallet.value, utxos.value as Cardano.Utxo[], keys.value);

      // Extract type and cbor as plain strings to avoid Vue reactivity wrapping
      keystoneType.value = signRequestResponse.ur.type;
      keystoneCbor.value = signRequestResponse.ur.cbor.toString('hex');

      // Show overlay with animated QR code
      overlay.value = true;
      keystoneScan.value = false;

      return true; // Return true to indicate QR is ready (not signed yet)
    } catch (e) {
      console.error('Error creating Keystone sign request:', e);
      snackbar.setError(e instanceof Error ? e.message : t('errors.unknownError'));
      return false;
    }
  };

  const onKeystoneScan = async (ur: UR) => {
    try {
      const signature = parseSignature(ur);

      // Validate witness set before using it
      if (!signature?.witnessSet || typeof signature.witnessSet !== 'string') {
        throw new Error(t('wallet.invalidKeystoneSignature'));
      }

      // Get witness set from signature (already a hex string)
      txWitnesses.value = signature.witnessSet;

      // Close overlay
      overlay.value = false;
      keystoneScan.value = false;

      // Submit if txAutoSubmit is enabled
      if (config.value?.txAutoSubmit) {
        await submitTx();
      } else {
        isSubmit.value = true;
      }
    } catch (error) {
      console.error('[Keystone] Error processing QR code:', error);
      snackbar.setError(error instanceof Error ? error.message : t('wallet.keystoneQRScanError'));
      overlay.value = false;
      keystoneScan.value = false;
    }
  };

  const onKeystoneError = (error: string) => {
    console.error('[Keystone] Scanner error:', error);
    snackbar.setError(error || t('wallet.keystoneScanError'));
  };

  const onKeystoneProgress = (progress: number) => {
    // Progress tracking
  };

  const backScan = () => {
    if (keystoneScan.value) {
      keystoneScan.value = false;
    } else {
      overlay.value = false;
    }
  };

  const submitTx = async (): Promise<void> => {
    try {
      loading.value = true;

      const submitResult = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SUBMIT_TX,
        data: {
          txCbor: txCbor.value,
          witnessHex: txWitnesses.value,
          utxos: utxos.value,
        },
      })) as { data: { txId?: string; error?: string } };

      if (submitResult.data.error) {
        throw new Error(submitResult.data.error);
      }

      snackbar.fireSuccess(t(options.successMessageKey, { txId: submitResult.data.txId }));
      options.onSuccess?.(submitResult.data.txId || '');
      options.onClose?.();
    } catch (e) {
      console.error('Error submitting transaction:', e);
      snackbar.setError(e instanceof Error ? e.message : t('errors.unknownError'));
    } finally {
      loading.value = false;
      isSubmit.value = false;
    }
  };

  // Cross-device signing: this device proposes an unsigned tx and another
  // registered device approves + signs it locally. On approval the returned
  // witness set is routed into the existing submit path (which re-checks the
  // tx body hash before broadcasting).
  const signOnAnotherDevice = async (): Promise<void> => {
    loading.value = true;
    try {
      const tx = options.tx.value;
      if (!tx) {
        throw new Error(t('common.noTransactionToSign'));
      }

      // Serialize the ORIGINAL unsigned tx and hand it to the other device.
      txCbor.value = serializeCardanoJsSdkTx(tx);
      const result = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.REQUEST_CROSS_DEVICE_SIGNATURE,
        data: {
          unsignedCbor: txCbor.value,
          intent: t('crossDevice.intentSign'),
          stakeAddress: loggedWallet.value?.stakeAddress,
          ttlMs: 180000,
        },
      })) as { data: { decision?: string; witnessSetCbor?: string; reason?: string } };

      if (result.data.decision === 'approved' && result.data.witnessSetCbor) {
        txWitnesses.value = result.data.witnessSetCbor;
        await submitTx();
      } else if (result.data.reason === 'expired') {
        snackbar.setError(t('crossDevice.requestExpired'));
      } else {
        snackbar.setError(t('crossDevice.requestRejected'));
      }
    } catch (e) {
      console.error('Error signing on another device:', e);
      snackbar.setError(e instanceof Error ? e.message : t('crossDevice.requestRejected'));
    } finally {
      loading.value = false;
    }
  };

  const handleSign = async (formRef?: { validate: () => boolean }): Promise<void> => {
    if (isSubmit.value) {
      await submitTx();
    } else if (requiresRemoteForSend.value) {
      // Policy gate: local signing is disabled; the Send must be approved on a
      // trusted device. Covers every local path (password, PassKey/PRF, autofill)
      // since they all funnel through handleSign.
      snackbar.setError(t('crossDevice.settings.policyRequireHint'));
    } else {
      if (loggedWallet.value?.type === WalletType.Normal) {
        if (!formRef || formRef.validate()) {
          const isValid = await signTx();
          if (!isValid) return;

          if (config.value?.txAutoSubmit) {
            await submitTx();
          } else {
            isSubmit.value = true;
          }
        }
      } else if (loggedWallet.value?.type === WalletType.Keystone) {
        await signKeystoneTx();
        // Keystone shows overlay - signing continues via QR scan
      } else if (loggedWallet.value?.type === WalletType.Ledger) {
        const isValid = await signLedgerTx();
        if (!isValid) return;

        if (config.value?.txAutoSubmit) {
          await submitTx();
        } else {
          isSubmit.value = true;
        }
      } else if (loggedWallet.value?.type === WalletType.Trezor) {
        const isValid = await signTrezorTx();
        if (!isValid) return;

        if (config.value?.txAutoSubmit) {
          await submitTx();
        } else {
          isSubmit.value = true;
        }
      }
    }
  };

  const handlePassKeySuccess = () => {
    setTimeout(() => {
      handleSign();
    }, 300);
  };

  const handlePassKeyError = (error: string) => {
    console.error('PassKey autofill error:', error);
    snackbar.setError(error || t('security.passKeyAuthFailed'));
  };

  const handlePassKeyAuthSuccess = (pkBytes: Uint8Array) => {
    privateKeyBytes.value = pkBytes;
    // Automatically proceed to sign after successful authentication
    setTimeout(() => {
      handleSign();
    }, 300);
  };

  const handlePassKeyAuthError = (error: Error) => {
    console.error('PassKey authentication error:', error);
    snackbar.setError(error.message || t('security.passKeyAuthFailed'));
    privateKeyBytes.value = null;
  };

  return {
    // State
    loading,
    spendingPassword,
    isSubmit,
    isBT,
    txCbor,
    txWitnesses,
    valid,
    passwordRules,
    privateKeyBytes,
    isPrfWallet,
    isBTSupported,
    canSignOnAnotherDevice,
    requiresRemoteForSend,
    // Keystone state
    overlay,
    keystoneScan,
    keystoneType,
    keystoneCbor,

    // Methods
    signTx,
    signLedgerTx,
    submitTx,
    signOnAnotherDevice,
    handleSign,
    resetState,
    handlePassKeySuccess,
    handlePassKeyError,
    handlePassKeyAuthSuccess,
    handlePassKeyAuthError,
    setPasswordFieldRef,
    // Keystone methods
    onKeystoneScan,
    onKeystoneError,
    onKeystoneProgress,
    backScan,
  };
}
