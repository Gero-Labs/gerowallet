import { ref, toRefs } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import { nexusTxApi, cardanoUtxoToNexusInput, type BuildStakeRegistrationTxRequest } from '@/api/nexus-tx-api';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import snackbar from '@/plugins/snackbar';
import { isStakeKeyRegistered, StakeAccountError } from '@/shared/utils/stakeRegistration';
import { refreshStakeAccount, assertStakeWalletUnchanged } from '@/shared/composables/refreshStakeAccount';
import { Blockchain } from '@/models/types';

/**
 * Composable for handling Cardano unstaking (deregistration) transactions
 * Shared logic used by StakingCard.vue
 */
export function useUnstake() {
  const { t } = useTranslation();

  const { loggedWallet, utxos, keys } = toRefs(walletStore);
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

      if (!loggedWallet.value) throw new Error(t(StakeAccountError.WalletChanged));
      const wallet = { ...loggedWallet.value };
      const stakingAccount = await refreshStakeAccount(wallet, t);
      if (!isStakeKeyRegistered(stakingAccount)) {
        throw new Error(t('common.cannotUnstake'));
      }

      // Check if keys are loaded
      if (!keys.value || !keys.value.stake || keys.value.stake.length === 0) {
        throw new Error(t('common.walletKeysNotAvailable'));
      }

      // Conway pre-flight (issue 951): deregistration requires a ZERO reward
      // balance, and withdrawing those rewards requires DRep delegation.
      // With pending rewards and no DRep the unstake tx cannot succeed in
      // either shape (with the withdrawal the node rejects the withdrawal;
      // without it, the deregistration). Open the dialog in its blocked
      // state (warning + Go to Governance) instead of building a doomed tx.
      const isCardano = loggedWallet.value?.chain === Blockchain.CARDANO;
      const hasPendingRewards = Number(stakingAccount.withdrawable_amount || 0) > 0;
      if (isCardano && hasPendingRewards && !stakingAccount.drep_id) {
        txData.value = null;
        unstakeDialog.value = true;
        return;
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
      if (stakingAccount.withdrawable_amount && Number(stakingAccount.withdrawable_amount) > 0) {
        withdrawals.push({
          stakeAddress: loggedWallet.value.stakeAddress,
          quantity: BigInt(stakingAccount.withdrawable_amount),
        });
      }

      // Phase 1 Nexus migration: build the deregistration server-side when the flag is on
      // and there are no pending rewards (the /build/stake-registration endpoint has no
      // `withdrawals` field). A deregistration that also claims rewards stays on the
      // client-side @cardano-sdk builder below.
      const useNexus =
        featureFlagsStore.isNexusUnstakeEnabled() &&
        withdrawals.length === 0;

      if (useNexus) {
        const request: BuildStakeRegistrationTxRequest = {
          stakeAddress: loggedWallet.value.stakeAddress,
          changeAddress: keys.value.payment[0].address,
          utxos: (utxos.value as Cardano.Utxo[]).map(cardanoUtxoToNexusInput),
          deregister: true,
        };
        const { tx_cbor } = await nexusTxApi.buildStakeRegistrationTx(request, loggedWallet.value.network);
        assertStakeWalletUnchanged(wallet, t);
        if (!tx_cbor) throw new Error(t(StakeAccountError.EmptyTransaction));
        txData.value = Serialization.Transaction.fromCbor(HexBlob(tx_cbor)).toCore();
      } else {
        // Build the unstaking transaction with wallet context for accurate fee estimation
        // For unstaking, deposit is returned (negative implicit coin)
        const built = await buildCardanoTransaction({
          certificates,
          withdrawals,
          utxos: utxos.value as Cardano.Utxo[],
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
        assertStakeWalletUnchanged(wallet, t);
        txData.value = built;
      }

      unstakeDialog.value = true;
    } catch (error: unknown) {
      console.error('Error building unstake transaction:', error);
      const message = error instanceof Error ? error.message : t('errors.unknownError');
      snackbar.setError(t('errors.buildTransactionFailed') + ': ' + message);
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
