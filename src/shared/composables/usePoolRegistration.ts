import { ref, toRefs } from 'vue';
import { Cardano } from '@cardano-sdk/core';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { poolOperatorStore } from '@/stores/poolOperatorStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import snackbar from '@/plugins/snackbar';

/**
 * Pool registration/update parameters provided by the SPO
 */
export interface PoolRegistrationParams {
  pledge: bigint;                           // Pledge in lovelace
  cost: bigint;                             // Fixed cost per epoch in lovelace
  marginNumerator: number;                  // Margin fraction numerator
  marginDenominator: number;                // Margin fraction denominator (e.g., 10000 for basis points)
  metadataUrl?: string;                     // Pool metadata JSON URL (max 64 chars)
  metadataHash?: string;                    // Blake2b-256 hash of metadata JSON
  relays: Cardano.Relay[];                  // Pool relay entries
  additionalOwners?: string[];              // Additional owner reward accounts (beyond the wallet's own)
}

/**
 * Composable for handling pool registration and update transactions.
 *
 * Pool registration and pool update both use the same PoolRegistration certificate type.
 * The difference is:
 * - First registration: requires stakePoolDeposit (500 ADA)
 * - Update (re-registration): no additional deposit
 */
export function usePoolRegistration() {
  const { t } = useTranslation();

  const { loggedWallet, utxos, keys } = toRefs(walletStore);
  const { epochParams, tip } = toRefs(networkStore);

  const txData = ref<Cardano.Tx | null>(null);
  const loading = ref(false);
  const isConfirmDialogOpen = ref(false);

  /**
   * Build a pool registration or update transaction
   * @param params - Pool parameters from the registration form
   * @param isUpdate - True if updating existing pool (no deposit)
   */
  const buildPoolTransaction = async (params: PoolRegistrationParams, isUpdate = false) => {
    loading.value = true;

    try {
      if (!epochParams.value) throw new Error(t('errors.networkError'));
      if (!poolOperatorStore.poolId) throw new Error(t('poolOperator.setupColdKeyFirst'));
      if (!poolOperatorStore.vrfKeyHash) throw new Error(t('poolOperator.importVrfKey'));

      // Validate minimum cost
      const minPoolCost = BigInt(epochParams.value.minPoolCost || 170_000_000);
      if (params.cost < minPoolCost) {
        throw new Error(t('poolOperator.minCostHint'));
      }

      // Build the pool ID from cold key hash
      const poolId = Cardano.PoolId(poolOperatorStore.poolId);

      // Wallet's reward account as primary owner
      const rewardAccount = Cardano.RewardAccount(loggedWallet.value?.stakeAddress || '');

      // Collect all owners (wallet + additional)
      const owners: Cardano.RewardAccount[] = [rewardAccount];
      if (params.additionalOwners) {
        for (const owner of params.additionalOwners) {
          owners.push(Cardano.RewardAccount(owner));
        }
      }

      // Build pool parameters
      const poolParameters: Cardano.PoolParameters = {
        id: poolId,
        rewardAccount,
        pledge: params.pledge,
        cost: params.cost,
        margin: {
          numerator: params.marginNumerator,
          denominator: params.marginDenominator,
        },
        relays: params.relays,
        owners,
        vrf: poolOperatorStore.vrfKeyHash as unknown as Cardano.VrfVkHex,
      };

      // Add metadata if provided
      if (params.metadataUrl && params.metadataHash) {
        poolParameters.metadataJson = {
          url: params.metadataUrl,
          hash: params.metadataHash as any,
        };
      }

      // Build the PoolRegistration certificate
      const certificate: Cardano.PoolRegistrationCertificate = {
        __typename: Cardano.CertificateType.PoolRegistration,
        poolParameters,
      };

      // Deposit: 500 ADA for new registration, 0 for update
      const stakePoolDeposit = BigInt(epochParams.value.poolDeposit || 500_000_000);
      const implicitCoin = isUpdate ? BigInt(0) : stakePoolDeposit;

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
      console.error('Error building pool registration transaction:', error);
      if (error.message?.includes('UTxO Balance Insufficient')) {
        snackbar.setError(t('errors.insufficientBalance'));
      } else {
        snackbar.setError(error.message || t('errors.unknownError'));
      }
    } finally {
      loading.value = false;
    }
  };

  /**
   * Build pool registration transaction (new pool)
   */
  const registerPool = async (params: PoolRegistrationParams) => {
    await buildPoolTransaction(params, false);
  };

  /**
   * Build pool update transaction (existing pool)
   */
  const updatePool = async (params: PoolRegistrationParams) => {
    await buildPoolTransaction(params, true);
  };

  const closeConfirmDialog = () => {
    isConfirmDialogOpen.value = false;
    txData.value = null;
  };

  return {
    txData,
    loading,
    isConfirmDialogOpen,
    registerPool,
    updatePool,
    closeConfirmDialog,
  };
}
