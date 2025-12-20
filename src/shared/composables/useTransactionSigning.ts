import { ref, toRefs, Ref, ComputedRef } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import ledgerUtils from '@/shared/utils/ledger';
import networks from '@/utils/networks';
import rules from '@/utils/rules';
import snackbar from '@/plugins/snackbar';
import { useTranslation } from './useTranslation';

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

  // Methods
  signTx: () => Promise<boolean>;
  signLedgerTx: () => Promise<boolean>;
  submitTx: () => Promise<void>;
  handleSign: (formRef?: { validate: () => boolean }) => Promise<void>;
  resetState: () => void;
  handlePassKeySuccess: () => void;
  handlePassKeyError: (error: string) => void;
  setPasswordFieldRef: (ref: any) => void;
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

  const setPasswordFieldRef = (ref: any) => {
    passwordField.value = ref;
  };

  const resetState = () => {
    spendingPassword.value = '';
    isSubmit.value = false;
    txCbor.value = '';
    txWitnesses.value = null;
    loading.value = false;
  };

  const signTx = async (): Promise<boolean> => {
    loading.value = true;
    try {
      const tx = options.tx.value;
      if (!tx) {
        throw new Error(t('common.noTransactionToSign'));
      }

      // Verify password via background message
      const passwordVerification = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.VERIFY_SPENDING_PASSWORD,
        data: { password: spendingPassword.value },
      })) as { data: { isValid: boolean; error?: string } };

      if (!passwordVerification.data.isValid) {
        passwordField.value?.showError(t('wallet.wrongSpendingPassword'));
        loading.value = false;
        return false;
      }

      // Serialize the Cardano.Tx to CBOR
      txCbor.value = serializeCardanoJsSdkTx(tx);

      // Sign the transaction via background message
      const witnessResult = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SIGN_TX,
        data: {
          txCbor: txCbor.value,
          partialSign: false,
          password: spendingPassword.value,
          accountIndex: 0,
          utxos: utxos.value,
          addresses: keys.value,
          mergeWitnesses: false,
        },
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
        utxos.value,
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

  const handleSign = async (formRef?: { validate: () => boolean }): Promise<void> => {
    if (isSubmit.value) {
      await submitTx();
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
      } else if (loggedWallet.value?.type === WalletType.Ledger) {
        const isValid = await signLedgerTx();
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
    console.log('✅ PassKey autofill successful - triggering sign');
    setTimeout(() => {
      handleSign();
    }, 300);
  };

  const handlePassKeyError = (error: string) => {
    console.error('PassKey autofill error:', error);
    snackbar.setError(error || t('security.passKeyAuthFailed'));
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

    // Methods
    signTx,
    signLedgerTx,
    submitTx,
    handleSign,
    resetState,
    handlePassKeySuccess,
    handlePassKeyError,
    setPasswordFieldRef,
  };
}
