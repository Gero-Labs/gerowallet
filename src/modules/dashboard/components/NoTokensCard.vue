<template>
  <v-card outlined class="card-container justify-center liquid-glass">
    <v-card-title class="subtitle-1">{{ $t('dashboard.welcomeToDashboard') }}</v-card-title>

    <section v-if="!hasAssets" class="mb-10">
      <p class="display-1">{{ $t('dashboard.letsGetStarted', { assetType }) }}</p>
      <p class="subtitle-1" v-if="assetType === Blockchain.APEX_PRIME">
        {{ $t('dashboard.claimYourTokens', { assetType }) }}
      </p>
      <v-btn class="claim-apex-button" v-if="assetType === Blockchain.APEX_PRIME"></v-btn>
    </section>

    <section
      class="text-center d-flex align-center justify-center flex-column stake-apex-section"
      :class="{ 'no-apex': !hasAssets }"
    >
      <div class="stake-apex-info">
        <h1 class="display-1">{{ $t('dashboard.stakeYourAssets', { assetType }) }}</h1>
        <v-card-text class="subtitle-1" v-if="loggedWallet">
          {{ $t('dashboard.earnRewardsByStaking', { assetType, chain: loggedWallet?.chain }) }}
        </v-card-text>
        <p class="subtitle-1 support-us-text" v-if="geroPoolExists">
          {{ $t('dashboard.considerSupportingUs') }}
        </p>

        <div class="d-flex align-center justify-center flex-column">
          <v-btn class="stake-button-gero" v-if="geroPoolExists" @click="delegateToGero">{{ $t('dashboard.stakeWithGero') }}</v-btn>
          <v-btn class="stake-button-pools" to="/staking">{{ $t('dashboard.browseStakePools') }}</v-btn>
        </div>
      </div>

      <h2 class="error-message">{{ $t('dashboard.needTokensBeforeStaking', { assetType }) }}</h2>
    </section>
    <DelegateDialog
      :isOpen="isDelegateDialogOpen"
      @close="isDelegateDialogOpen = false"
      :pool="selectedPool"
      :tx="txData"
    ></DelegateDialog>
  </v-card>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { computed, ref, toRefs, getCurrentInstance } from 'vue';
import { Blockchain } from '@/models/types';
import networks from '@/utils/networks';
import { Cardano } from '@cardano-sdk/core';
import DelegateDialog from '@/modules/staking/dialogs/DelegateDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import stakingStore from '@/stores/stakingStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import snackbar from '@/plugins/snackbar';


const { t } = useTranslation();

const { loggedWallet, account, utxos, keys } = toRefs(walletStore);
const { epochParams, tip } = toRefs(networkStore);

const isDelegateDialogOpen = ref(false);
const selectedPool = ref<any>(null);
const txData = ref<Cardano.Tx | null>(null);
const geroPoolExists = computed(() => {
  if (loggedWallet.value) {
    return !!networks.resolvePool(loggedWallet.value?.chain, loggedWallet.value?.network);
  }
  return false;
});

const assetType = computed(() => {
  if (!loggedWallet.value) {
    return '';
  }
  return networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);
});

const hasAssets = computed(() => {
  return !!account.value;
});

const delegateToGero = async () => {
  if (!loggedWallet.value) return;

  try {
    const poolId = networks.resolvePool(loggedWallet.value?.chain, loggedWallet.value?.network);
    await stakingStore.loadPoolById(loggedWallet.value, poolId);

    if (!stakingStore.state.currentPool) {
      snackbar.setError(t('errors.unknownError'));
      return;
    }

    selectedPool.value = stakingStore.state.currentPool;

    // Check if we have epoch parameters
    if (!epochParams.value) {
      throw new Error(t('errors.networkError'));
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

    let certificate;
    let implicitCoin = BigInt(0);

    if (!account.value?.active) {
      // Need to register a stake key first, then delegate
      certificate = {
        __typename: Cardano.CertificateType.StakeRegistrationDelegation,
        stakeCredential,
        poolId: poolIdBech32,
        deposit: stakeKeyDepositLovelace,
      };
      implicitCoin = stakeKeyDepositLovelace; // Deposit required
    } else {
      // Just delegate, no registration needed
      certificate = {
        __typename: Cardano.CertificateType.StakeDelegation,
        stakeCredential,
        poolId: poolIdBech32,
      };
    }
    certificates.push(certificate);

    // Build the delegation transaction
    txData.value = await buildCardanoTransaction({
      certificates,
      utxos: utxos.value,
      epochParams: epochParams.value,
      changeAddress: keys.value.payment[0].address,
      tip: tip.value,
      implicitCoin,
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
</script>
<style scoped>
.card-container {
  display: flex;
  align-items: center;
  text-align: center;
  flex-direction: column;
  padding: 0 20px;
  height: 100%;

  .claim-apex-button {
    width: 320px;
    opacity: 0.7;
    height: 110px;
    transition: 0.2s all ease-in-out;
    background-image: url('../assets/claim_ap3x_button.png');
    background-size: contain;

    &:hover {
      opacity: 1;
    }

    & img {
      box-shadow: 0px 5px 10px 7px rgba(0, 0, 0, 0.5);
      height: 100%;
      width: 100%;
    }
  }

  .stake-apex-section {
    .support-us-text {
      color: #00dff3;
    }

    .stake-button-gero,
    .stake-button-pools {
      margin: 10px 0;
      width: 200px;
      font-family: Inter;
      font-size: 12px;
    }

    .stake-button-gero {
      background: linear-gradient(to right, #00c7f3, #00ffd1);
      color: black;
    }

    .stake-button-pools {
      border: 1px solid #ffffff;
      background-color: transparent !important;
    }

    .error-message {
      position: absolute;
      color: #ff7777;
      padding: 10px;
      display: none;
      &:hover {
        display: block;
      }
    }

    &.no-apex {
      .stake-apex-info {
        opacity: 0.2;
        pointer-events: none;
      }

      &:hover {
        .stake-apex-info {
          filter: blur(4px);
        }

        & > .error-message {
          display: block;
        }
      }
    }
  }
}
</style>
