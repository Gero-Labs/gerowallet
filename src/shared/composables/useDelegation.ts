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
import { isStakeKeyRegistered } from '@/shared/utils/stakeRegistration';

/**
 * Composable for handling Cardano staking delegation transactions and the
 * shared "delegation pending" state used by the staking UI (Staking.vue).
 */
export function useDelegation() {
  const { t } = useTranslation();

  const { loggedWallet, account, utxos, keys } = toRefs(walletStore);
  const { epochParams, tip } = toRefs(networkStore);

  const selectedPool = ref<any>(null);
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
    } catch (error: any) {
      console.error('Error delegating to Gero pool:', error);
      snackbar.setError(t('errors.unknownError'));
    }
  };

  /**
   * Build and prepare delegation transaction for any pool
   * @param pool - The stake pool to delegate to
   */
  const delegate = async (pool: any) => {
    selectedPool.value = pool;

    try {
      // Check if we have epoch parameters
      if (!epochParams.value) {
        throw new Error(t('errors.networkError'));
      }

      // Trezor can't sign the combined Conway certs (StakeVoteDelegCert /
      // StakeVoteRegDelegCert) that nexus emits, so it always uses the client-side
      // @cardano-sdk builder below (separate certs). Software + Ledger use nexus.
      const isTrezorWallet = loggedWallet.value?.type === WalletType.Trezor;

      // Nexus migration: build the delegation server-side for software + Ledger.
      if (featureFlagsStore.isNexusDelegateEnabled() && !isTrezorWallet) {
        const isRegistered = isStakeKeyRegistered(account.value);
        const hasDrep = !!account.value?.drep_id;
        const poolId = Cardano.PoolId(selectedPool.value.pool_id_bech32);
        const nexusReq = {
          stakeAddress: loggedWallet.value.stakeAddress,
          changeAddress: keys.value.payment[0].address,
          utxos: walletUtxosToNexusInputs(utxos.value as Cardano.Utxo[], walletStore.collateral),
        };
        const { tx_cbor } = isRegistered && hasDrep
          // Already registered with a DRep → pool-only stake delegation.
          ? await nexusTxApi.buildDelegationTx(
              { ...nexusReq, poolId },
              loggedWallet.value.network
            )
          // First delegation (register the stake key when inactive) → combined pool +
          // abstain vote, matching the client's StakeVoteRegistrationDelegation /
          // StakeVoteDelegation. Deposit is folded server-side.
          : await nexusTxApi.buildVoteDelegationTx(
              { ...nexusReq, poolId, drepId: 'drep_always_abstain', includeStakeRegistration: !isRegistered },
              loggedWallet.value.network
            );
        if (!tx_cbor) throw new Error('Nexus returned an empty transaction CBOR');
        txData.value = Serialization.Transaction.fromCbor(HexBlob(tx_cbor)).toCore();
        isDelegateDialogOpen.value = true;
        return;
      }

      const certificates: Cardano.Certificate[] = [];

      // Create stake credential from the key hash
      const stakeCredential: Cardano.Credential = {
        type: Cardano.CredentialType.KeyHash,
        hash: keys.value.stake[0].cred,
      };

      const poolIdBech32 = Cardano.PoolId(selectedPool.value.pool_id_bech32);

      // Use proper deposit from epoch parameters - ensure BigInt conversion
      const stakeKeyDepositLovelace = BigInt(epochParams.value.stakeKeyDeposit);

      let implicitCoin = BigInt(0);

      if (!isStakeKeyRegistered(account.value)) {
        // Need to register a stake key first, then delegate
        if (isTrezorWallet) {
          // Trezor: Use separate certificates
          // 1. Registration
          certificates.push({
            __typename: Cardano.CertificateType.Registration,
            stakeCredential,
            deposit: stakeKeyDepositLovelace,
          });
          // 2. Pool delegation
          certificates.push({
            __typename: Cardano.CertificateType.StakeDelegation,
            stakeCredential,
            poolId: poolIdBech32,
          });
          // 3. Vote delegation (abstain by default)
          certificates.push({
            __typename: Cardano.CertificateType.VoteDelegation,
            stakeCredential,
            dRep: {
              __typename: 'AlwaysAbstain',
            } as Cardano.AlwaysAbstain,
          });
        } else {
          // Other wallets: Use combined Conway certificate
          certificates.push({
            __typename: Cardano.CertificateType.StakeVoteRegistrationDelegation,
            stakeCredential,
            poolId: poolIdBech32,
            dRep: {
              __typename: 'AlwaysAbstain',
            } as Cardano.AlwaysAbstain,
            deposit: stakeKeyDepositLovelace,
          });
        }
        implicitCoin = stakeKeyDepositLovelace; // Deposit required
      } else if (!account.value?.drep_id) {
        // Delegate to pool and abstain by default
        if (isTrezorWallet) {
          // Trezor: Use separate certificates
          // 1. Pool delegation
          certificates.push({
            __typename: Cardano.CertificateType.StakeDelegation,
            stakeCredential,
            poolId: poolIdBech32,
          });
          // 2. Vote delegation (abstain by default)
          certificates.push({
            __typename: Cardano.CertificateType.VoteDelegation,
            stakeCredential,
            dRep: {
              __typename: 'AlwaysAbstain',
            } as Cardano.AlwaysAbstain,
          });
        } else {
          // Other wallets: Use combined Conway certificate
          certificates.push({
            __typename: Cardano.CertificateType.StakeVoteDelegation,
            stakeCredential,
            poolId: poolIdBech32,
            dRep: {
              __typename: 'AlwaysAbstain',
            } as Cardano.AlwaysAbstain,
          });
        }
      } else {
        // Just delegate to pool, no registration needed (works for all wallets)
        certificates.push({
          __typename: Cardano.CertificateType.StakeDelegation,
          stakeCredential,
          poolId: poolIdBech32,
        });
      }

      // Build the delegation transaction with wallet context for accurate fee estimation
      txData.value = await buildCardanoTransaction({
        certificates,
        utxos: utxos.value as Cardano.Utxo[],
        epochParams: epochParams.value,
        changeAddress: keys.value.payment[0].address,
        tip: tip.value,
        implicitCoin,
        walletContext: {
          keys: keys.value,
          stakeAddress: loggedWallet.value?.stakeAddress || '',
          accountIndex: 0,
        }
      });

      isDelegateDialogOpen.value = true;
    } catch (error: any) {
      console.error('Error building delegation transaction:', error);
      if (error.message?.includes('UTxO Balance Insufficient')) {
        snackbar.setError(t('errors.insufficientBalance'));
      } else {
        snackbar.setError(t('errors.buildTransactionFailed') + ': ' + (error.message || t('errors.unknownError')));
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
