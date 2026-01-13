import { ref, toRefs } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import snackbar from '@/plugins/snackbar';

/**
 * Composable for handling Cardano staking reward withdrawals
 * Shared logic between StakingCard.vue and StakingCard2.vue
 */
export function useWithdrawal() {
  const { t } = useTranslation();

  const { loggedWallet, account, utxos, keys } = toRefs(walletStore);
  const { epochParams, tip } = toRefs(networkStore);

  const txData = ref<Cardano.Tx | null>(null);
  const withdrawalDialog = ref(false);

  /**
   * Build and prepare withdrawal-only transaction
   */
  const withdraw = async () => {
    try {
      // Check if user has DRep delegation
      if (!account.value?.drep_id) {
        console.warn('Cannot withdraw: DRep delegation required');
        // Dialog will still open and show the warning with "Go to Governance" button
        withdrawalDialog.value = true;
        return;
      }

      // Prepare withdrawals if there are any rewards
      const withdrawals: Cardano.Withdrawal[] = [];
      if (account.value?.withdrawable_amount && Number(account.value.withdrawable_amount) > 0) {
        withdrawals.push({
          stakeAddress: loggedWallet.value.stakeAddress,
          quantity: BigInt(account.value.withdrawable_amount),
        });
      }

      // Build the withdrawal transaction with wallet context for accurate fee estimation
      txData.value = await buildCardanoTransaction({
        withdrawals,
        utxos: utxos.value,
        epochParams: epochParams.value,
        changeAddress: keys.value.payment[0].address,
        tip: tip.value,
        walletContext: {
          keys: keys.value,
          stakeAddress: loggedWallet.value?.stakeAddress || '',
          accountIndex: 0,
        }
      });

      withdrawalDialog.value = true;
    } catch (error: any) {
      console.error('Error building withdrawal transaction:', error);
      snackbar.setError(t('errors.buildTransactionFailed') + ': ' + (error.message || t('errors.unknownError')));
    }
  };

  /**
   * Close the withdrawal dialog and reset state
   */
  const closeWithdrawalDialog = () => {
    withdrawalDialog.value = false;
    txData.value = null;
  };

  return {
    // State
    txData,
    withdrawalDialog,

    // Methods
    withdraw,
    closeWithdrawalDialog,
  };
}