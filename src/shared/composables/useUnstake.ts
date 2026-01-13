import { ref, toRefs } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import snackbar from '@/plugins/snackbar';

/**
 * Composable for handling Cardano unstaking (deregistration) transactions
 * Shared logic between StakingCard.vue and StakingCard2.vue
 */
export function useUnstake() {
  const { t } = useTranslation();

  const { loggedWallet, account, utxos, keys } = toRefs(walletStore);
  const { epochParams, tip } = toRefs(networkStore);

  const txData = ref<Cardano.Tx | null>(null);
  const unstakeDialog = ref(false);

  /**
   * Build and prepare unstaking (deregistration) transaction
   * Includes withdrawal of any pending rewards
   */
  const unstake = async () => {
    try {
      // Check if we have epoch parameters
      if (!epochParams.value) {
        throw new Error(t('common.epochParametersNotAvailable'));
      }

      // Check if stake key is registered
      if (!account.value?.active) {
        throw new Error(t('common.cannotUnstake'));
      }

      // Check if keys are loaded
      if (!keys.value || !keys.value.stake || keys.value.stake.length === 0) {
        throw new Error(t('common.walletKeysNotAvailable'));
      }

      const certificates: Cardano.Certificate[] = [];

      // Create stake credential from the key hash
      const stakeCredential: Cardano.Credential = {
        type: Cardano.CredentialType.KeyHash,
        hash: keys.value.stake[0].cred,
      };

      // Use proper deposit from epoch parameters - ensure BigInt conversion
      const stakeKeyDepositLovelace = BigInt(epochParams.value.stakeKeyDeposit);

      // Conway-era unregistration certificate (returns deposit to user)
      const certificate: Cardano.Certificate = {
        __typename: Cardano.CertificateType.Unregistration,
        stakeCredential,
        deposit: stakeKeyDepositLovelace,
      };
      certificates.push(certificate);

      // Prepare withdrawals if there are any rewards
      const withdrawals: Cardano.Withdrawal[] = [];
      if (account.value?.withdrawable_amount && Number(account.value.withdrawable_amount) > 0) {
        withdrawals.push({
          stakeAddress: loggedWallet.value.stakeAddress,
          quantity: BigInt(account.value.withdrawable_amount),
        });
      }

      // Build the unstaking transaction with wallet context for accurate fee estimation
      // For unstaking, deposit is returned (negative implicit coin)
      txData.value = await buildCardanoTransaction({
        certificates,
        withdrawals,
        utxos: utxos.value,
        epochParams: epochParams.value,
        changeAddress: keys.value.payment[0].address,
        tip: tip.value,
        implicitCoin: -stakeKeyDepositLovelace, // Deposit is returned
        walletContext: {
          keys: keys.value,
          stakeAddress: loggedWallet.value?.stakeAddress || '',
          accountIndex: 0,
        }
      });

      unstakeDialog.value = true;
    } catch (error: any) {
      console.error('Error building unstake transaction:', error);
      snackbar.setError(t('errors.buildTransactionFailed') + ': ' + (error.message || t('errors.unknownError')));
    }
  };

  /**
   * Close the unstake dialog and reset state
   */
  const closeUnstakeDialog = () => {
    unstakeDialog.value = false;
    txData.value = null;
  };

  return {
    // State
    txData,
    unstakeDialog,

    // Methods
    unstake,
    closeUnstakeDialog,
  };
}
