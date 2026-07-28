import { ref, toRefs } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { networkStore, isBitcoinTip } from '@/stores/networkStore';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import snackbar from '@/plugins/snackbar';

/**
 * Composable for handling pool retirement transactions.
 *
 * Pool retirement schedules the pool to stop producing blocks after a specified epoch.
 * The stakePoolDeposit (500 ADA) is returned to the reward address after the retirement epoch.
 *
 * Constraints:
 * - Retirement epoch must be > current epoch
 * - Retirement epoch must be <= current epoch + poolRetireMaxEpoch (eMax)
 */
export function usePoolRetirement() {
  const { t } = useTranslation();

  const { loggedWallet, utxos, keys } = toRefs(walletStore);
  const { epochParams, tip } = toRefs(networkStore);

  const txData = ref<Cardano.Tx | null>(null);
  const loading = ref(false);
  const isConfirmDialogOpen = ref(false);

  /**
   * Build a pool retirement transaction
   * @param retirementEpoch - The epoch at which the pool should retire
   */
  const retirePool = async (retirementEpoch: number) => {
    loading.value = true;

    try {
      if (!epochParams.value) throw new Error(t('errors.networkError'));
      if (!poolOperatorStore.poolId) throw new Error(t('poolOperator.setupColdKeyFirst'));

      // Pool retirement is Cardano-only; a height-only BTC tip has no epoch.
      const currentTip = tip.value;
      const currentEpoch = currentTip && !isBitcoinTip(currentTip) ? (currentTip.epoch || 0) : 0;
      const eMax = epochParams.value.poolRetirementEpochBound || 18;

      // Validate epoch constraints
      if (retirementEpoch <= currentEpoch) {
        throw new Error(t('poolOperator.retirementEpochHint', { min: currentEpoch + 1, max: currentEpoch + eMax }));
      }
      if (retirementEpoch > currentEpoch + eMax) {
        throw new Error(t('poolOperator.retirementEpochHint', { min: currentEpoch + 1, max: currentEpoch + eMax }));
      }

      const poolId = Cardano.PoolId(poolOperatorStore.poolId);

      // Build the PoolRetirement certificate
      const certificate: Cardano.PoolRetirementCertificate = {
        __typename: Cardano.CertificateType.PoolRetirement,
        poolId,
        epoch: Cardano.EpochNo(retirementEpoch),
      };

      // Deposit return: -stakePoolDeposit (will be returned after retirement epoch)
      const stakePoolDeposit = BigInt(epochParams.value.poolDeposit || 500_000_000);
      const implicitCoin = -stakePoolDeposit; // Negative = deposit return

      // Build the transaction
      txData.value = await buildCardanoTransaction({
        certificates: [certificate],
        utxos: utxos.value as Cardano.Utxo[],
        epochParams: epochParams.value,
        changeAddress: keys.value.payment[0].address,
        tip: tip.value,
        implicitCoin,
        walletContext: {
          keys: keys.value,
          stakeAddress: loggedWallet.value?.stakeAddress || '',
          accountIndex: 0,
        },
      });

      isConfirmDialogOpen.value = true;
    } catch (error: any) {
      console.error('Error building pool retirement transaction:', error);
      snackbar.setError(error.message || t('errors.unknownError'));
    } finally {
      loading.value = false;
    }
  };

  const closeConfirmDialog = () => {
    isConfirmDialogOpen.value = false;
    txData.value = null;
  };

  return {
    txData,
    loading,
    isConfirmDialogOpen,
    retirePool,
    closeConfirmDialog,
  };
}
