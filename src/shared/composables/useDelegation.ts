import { ref, toRefs, computed } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { isCardanoTx } from '@/models/transaction.types';
import { HexBlob } from '@cardano-sdk/util';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import stakingStore from '@/stores/stakingStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import { nexusTxApi, walletUtxosToNexusInputs } from '@/api/nexus-tx-api';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import snackbar from '@/plugins/snackbar';
import networks from '@/utils/networks';
import { WalletType } from '@/models/types';
import { isStakeKeyRegistered, StakeAccountError } from '@/shared/utils/stakeRegistration';
import { delegationCertificates, signsSeparateStakeCertificates } from '@/shared/utils/stakeCertificates';
import { refreshStakeAccount, assertStakeWalletUnchanged } from '@/shared/composables/refreshStakeAccount';
import { getErrorMessage } from '@/shared/utils/errorHandler';

interface DelegationPool {
  pool_id_bech32: string;
}

/**
 * Composable for handling Cardano staking delegation transactions and the
 * shared "delegation pending" state used by the staking UI (Staking.vue).
 */
export function useDelegation() {
  const { t } = useTranslation();

  const { loggedWallet, utxos, keys } = toRefs(walletStore);
  const { epochParams, tip } = toRefs(networkStore);

  const selectedPool = ref<DelegationPool | null>(null);
  const txData = ref<Cardano.Tx | null>(null);
  const isDelegateDialogOpen = ref(false);

  // Stake-pool delegation certificates (excludes DRep-only VoteDelegation /
  // VoteRegistrationDelegation — those don't delegate stake to a pool).
  const POOL_DELEGATION_CERTS: Cardano.CertificateType[] = [
    Cardano.CertificateType.StakeDelegation,
    Cardano.CertificateType.StakeRegistrationDelegation,
    Cardano.CertificateType.StakeVoteRegistrationDelegation,
    Cardano.CertificateType.StakeVoteDelegation,
  ];

  /**
   * True while a stake-pool delegation transaction is submitted but not yet
   * confirmed on-chain (a pending tx carrying a pool-delegation certificate).
   * Lets the staking UI show a "delegation pending" state instead of the
   * delegate CTA until `account.pool_id` updates on confirmation (#499).
   */
  const isDelegationPending = computed(() =>
    (walletStore.transactions ?? []).some(
      (tx) =>
        tx.pending &&
        isCardanoTx(tx) &&
        (tx.body?.certificates ?? []).some((c) => POOL_DELEGATION_CERTS.includes(c.__typename)),
    ),
  );

  /**
   * Delegate to the Gero pool (official wallet pool)
   */
  const delegateToGero = async () => {
    if (!loggedWallet.value) return;

    try {
      const poolId = networks.resolvePool(loggedWallet.value?.chain, loggedWallet.value?.network);
      await stakingStore.loadPoolById(loggedWallet.value, poolId);

      if (!stakingStore.state.currentPool) {
        snackbar.setError(t('errors.unknownError'));
        return;
      }

      // Delegate to the loaded Gero pool
      await delegate(stakingStore.state.currentPool);
    } catch (error: unknown) {
      console.error('Error delegating to Gero pool:', error);
      snackbar.setError(t('errors.unknownError'));
    }
  };

  /**
   * Build and prepare delegation transaction for any pool
   * @param pool - The stake pool to delegate to
   */
  const delegate = async (pool: DelegationPool) => {
    selectedPool.value = pool;

    try {
      // Check if we have epoch parameters
      if (!epochParams.value) {
        throw new Error(t('errors.networkError'));
      }

      if (!loggedWallet.value) throw new Error(t(StakeAccountError.WalletChanged));
      const wallet = { ...loggedWallet.value };
      const stakingAccount = await refreshStakeAccount(wallet, t);
      const isRegistered = isStakeKeyRegistered(stakingAccount);

      // Trezor can't sign the combined Conway certs (StakeVoteDelegCert /
      // StakeVoteRegDelegCert) that nexus emits, so it always uses the client-side
      // @cardano-sdk builder below. Software + Ledger use nexus. Trezor and Ledger
      // get separate certs: Ledger's Cardano app 7 refuses the combined ones (#1431).
      const isTrezorWallet = loggedWallet.value?.type === WalletType.Trezor;
      const separate = signsSeparateStakeCertificates(loggedWallet.value?.type);
      // Already registered with a DRep → pool-only stake delegation. Otherwise the
      // first delegation also abstains, registering the stake key when inactive.
      const hasDrep = isRegistered && !!stakingAccount.drep_id;
      const poolId = Cardano.PoolId(selectedPool.value.pool_id_bech32);

      // Nexus migration: build the delegation server-side for software + Ledger.
      if (featureFlagsStore.isNexusDelegateEnabled() && !isTrezorWallet) {
        const nexusReq = {
          stakeAddress: loggedWallet.value.stakeAddress,
          changeAddress: keys.value.payment[0].address,
          utxos: walletUtxosToNexusInputs(utxos.value as Cardano.Utxo[], walletStore.collateral),
        };
        const { tx_cbor } = hasDrep
          ? await nexusTxApi.buildDelegationTx(
              { ...nexusReq, poolId },
              loggedWallet.value.network
            )
          // Pool + abstain vote, matching the client's certificates below. Deposit is
          // folded server-side.
          : await nexusTxApi.buildVoteDelegationTx(
              {
                ...nexusReq,
                poolId,
                drepId: 'drep_always_abstain',
                includeStakeRegistration: !isRegistered,
                ...(separate && { certificateEncoding: 'separate' as const }),
              },
              loggedWallet.value.network
            );
        assertStakeWalletUnchanged(wallet, t);
        if (!tx_cbor) throw new Error(t(StakeAccountError.EmptyTransaction));
        txData.value = Serialization.Transaction.fromCbor(HexBlob(tx_cbor)).toCore();
        isDelegateDialogOpen.value = true;
        return;
      }

      // Create stake credential from the key hash
      const stakeCredential: Cardano.Credential = {
        type: Cardano.CredentialType.KeyHash,
        hash: keys.value.stake[0].cred,
      };

      // Use proper deposit from epoch parameters - ensure BigInt conversion
      const stakeKeyDepositLovelace = BigInt(epochParams.value.stakeKeyDeposit);
      const certificates = delegationCertificates({
        stakeCredential,
        registrationDeposit: isRegistered ? undefined : stakeKeyDepositLovelace,
        poolId,
        dRep: hasDrep ? undefined : ({ __typename: 'AlwaysAbstain' } as Cardano.AlwaysAbstain),
        separate,
      });
      const implicitCoin = isRegistered ? 0n : stakeKeyDepositLovelace; // Deposit required

      // Build the delegation transaction with wallet context for accurate fee estimation
      const built = await buildCardanoTransaction({
        certificates,
        utxos: utxos.value as Cardano.Utxo[],
        epochParams: epochParams.value,
        changeAddress: keys.value.payment[0].address,
        tip: tip.value,
        implicitCoin,
        walletContext: {
          keys: keys.value,
        }
      });
      assertStakeWalletUnchanged(wallet, t);
      txData.value = built;
      isDelegateDialogOpen.value = true;
    } catch (error: unknown) {
      console.error('Error building delegation transaction:', error);
      const message = getErrorMessage(error, t('errors.unknownError'));
      if (message.includes('UTxO Balance Insufficient')) {
        snackbar.setError(t('errors.insufficientBalance'));
      } else {
        snackbar.setError(t('errors.buildTransactionFailed') + ': ' + message);
      }
    }
  };

  /**
   * Close the delegation dialog and reset state
   */
  const closeDelegateDialog = () => {
    isDelegateDialogOpen.value = false;
    txData.value = null;
    selectedPool.value = null;
  };

  return {
    // State
    selectedPool,
    txData,
    isDelegateDialogOpen,
    isDelegationPending,

    // Methods
    delegateToGero,
    delegate,
    closeDelegateDialog,
  };
}
