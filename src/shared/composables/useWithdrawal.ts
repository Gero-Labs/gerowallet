import { ref, toRefs, computed } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import snackbar from '@/plugins/snackbar';
import { Blockchain } from '@/models/types';
import { governanceStore } from '@/stores/governanceStore';

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
  /** CIP-0149: Whether user chose to skip donation for this withdrawal */
  const skipCompensation = ref(false);

  /** CIP-0149: Computed compensation info for display */
  const compensationInfo = computed(() => {
    const bps = governanceStore.currentCompensationBps;
    if (!bps || skipCompensation.value) return null;
    const withdrawableAmount = Number(account.value?.withdrawable_amount || 0);
    const donationLovelace = Math.floor(withdrawableAmount * bps / 1000);
    const minUtxo = Number(epochParams.value?.coinsPerUtxoByte || 4310) * 200; // Rough min UTXO estimate
    if (donationLovelace < minUtxo) return { bps, donationLovelace, belowMinimum: true, minUtxo };
    return { bps, donationLovelace, belowMinimum: false, minUtxo };
  });

  /**
   * Build and prepare withdrawal-only transaction
   */
  const withdraw = async () => {
    try {
      // Check if user has DRep delegation (Cardano only)
      const isCardano = loggedWallet.value?.chain === Blockchain.CARDANO;
      if (isCardano && !account.value?.drep_id) {
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

      // CIP-0149: Add donation output if compensation is active and not skipped
      const outputs: Cardano.TxOut[] = [];
      const comp = compensationInfo.value;
      if (comp && !comp.belowMinimum && !skipCompensation.value && governanceStore.currentDRep) {
        // Resolve DRep payment address from metadata
        const drepPaymentAddress = governanceStore.currentDRep?.metadata?.meta_json?.body?.paymentAddress;
        // Validate address format before using (must be valid bech32 Cardano address)
        if (drepPaymentAddress && (drepPaymentAddress.startsWith('addr1') || drepPaymentAddress.startsWith('addr_test1'))) {
          outputs.push({
            address: drepPaymentAddress as Cardano.PaymentAddress,
            value: { coins: BigInt(comp.donationLovelace) }
          });
        }
      }

      // Build the withdrawal transaction with wallet context for accurate fee estimation
      txData.value = await buildCardanoTransaction({
        withdrawals,
        outputs,
        utxos: utxos.value as Cardano.Utxo[],
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
    } catch (error: unknown) {
      console.error('Error building withdrawal transaction:', error);
      const message = error instanceof Error ? error.message : t('errors.unknownError');
      snackbar.setError(t('errors.buildTransactionFailed') + ': ' + message);
    }
  };

  /**
   * Close the withdrawal dialog and reset state
   */
  const closeWithdrawalDialog = () => {
    withdrawalDialog.value = false;
    txData.value = null;
    skipCompensation.value = false;
  };

  return {
    // State
    txData,
    withdrawalDialog,
    skipCompensation,
    compensationInfo,

    // Methods
    withdraw,
    closeWithdrawalDialog,
  };
}
