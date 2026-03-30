import { ref, toRefs, computed, Ref } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { serializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { walletStore } from '@/stores/walletStore';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import rules from '@/utils/rules';
import snackbar from '@/plugins/snackbar';
import { useTranslation } from './useTranslation';

/**
 * Composable for handling pool operator transaction signing.
 *
 * Pool operator transactions require both wallet keys (payment + stake)
 * and the cold key. This composable handles:
 * - Software cold key: sends SIGN_TX_WITH_POOL_KEYS message to background
 * - Ledger cold key: TODO Phase 3 — two-step Ledger signing
 */
export function usePoolSigning(options: {
  tx: Ref<Cardano.Tx | undefined | null>;
  successMessageKey: string;
  onSuccess?: (txId: string) => void;
}) {
  const { t } = useTranslation();
  const { loggedWallet, utxos, keys } = toRefs(walletStore);

  const loading = ref(false);
  const spendingPassword = ref('');
  const passwordRules = ref([rules.required()]);
  const valid = ref(false);
  const txCbor = ref('');
  const txWitnesses = ref<string | null>(null);
  const coldKeyWitness = ref<{ vkey: string; signature: string } | null>(null);
  const isSubmit = ref(false);
  const privateKeyBytes = ref<Uint8Array | null>(null);

  const isPrfWallet = computed(() => loggedWallet.value?.encryptionMethod === 'prf');
  const isLedgerColdKey = computed(() => poolOperatorStore.coldKeySource === 'ledger');

  /**
   * Sign the pool operator transaction
   */
  const signTx = async (): Promise<boolean> => {
    loading.value = true;
    try {
      const tx = options.tx.value;
      if (!tx) throw new Error(t('common.noTransactionToSign'));

      // Serialize transaction to CBOR
      txCbor.value = serializeCardanoJsSdkTx(tx);

      if (isLedgerColdKey.value) {
        // TODO: Ledger cold key signing (Phase 3)
        throw new Error('Ledger cold key signing not yet implemented. Use software cold key.');
      }

      // Software cold key: sign with wallet keys + cold key in one background call
      const signingData: any = {
        txCbor: txCbor.value,
        password: spendingPassword.value,
        accountIndex: 0,
        utxos: utxos.value,
        addresses: keys.value,
      };

      if (isPrfWallet.value && privateKeyBytes.value) {
        signingData.privateKeyBytes = Array.from(privateKeyBytes.value);
      }

      const result = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SIGN_TX_WITH_POOL_KEYS,
        data: signingData,
      })) as { data: { witnesses?: string; coldKeyWitness?: any; error?: string } };

      if (result.data.error) {
        throw new Error(result.data.error);
      }

      txWitnesses.value = result.data.witnesses || null;
      coldKeyWitness.value = result.data.coldKeyWitness || null;
      return true;
    } catch (e: any) {
      console.error('Error signing pool operator transaction:', e);
      snackbar.setError(e.message || t('errors.unknownError'));
      return false;
    } finally {
      loading.value = false;
    }
  };

  /**
   * Submit the signed transaction
   */
  const submitTx = async (): Promise<void> => {
    loading.value = true;
    try {
      // Submit via background
      const result = (await Messaging.sendToBackgroundFromOptions({
        method: MessageTypes.SUBMIT_TX,
        data: {
          txCbor: txCbor.value,
          witnessHex: txWitnesses.value,
          coldKeyWitness: coldKeyWitness.value,
          utxos: utxos.value,
        },
      })) as { data: { txId?: string; error?: string } };

      if (result.data.error) {
        throw new Error(result.data.error);
      }

      isSubmit.value = true;
      snackbar.fireSuccess(t(options.successMessageKey));

      if (options.onSuccess && result.data.txId) {
        options.onSuccess(result.data.txId);
      }
    } catch (e: any) {
      console.error('Error submitting pool operator transaction:', e);
      snackbar.setError(e.message || t('errors.unknownError'));
    } finally {
      loading.value = false;
    }
  };

  /**
   * Full sign + submit flow
   */
  const handleSign = async () => {
    const signed = await signTx();
    if (signed) {
      await submitTx();
    }
  };

  const resetState = () => {
    spendingPassword.value = '';
    txCbor.value = '';
    txWitnesses.value = null;
    coldKeyWitness.value = null;
    isSubmit.value = false;
    privateKeyBytes.value = null;
    loading.value = false;
  };

  return {
    loading,
    spendingPassword,
    passwordRules,
    valid,
    isSubmit,
    isPrfWallet,
    isLedgerColdKey,
    privateKeyBytes,
    signTx,
    submitTx,
    handleSign,
    resetState,
  };
}
