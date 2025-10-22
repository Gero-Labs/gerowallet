<template>
  <v-card outlined class="card-container justify-center liquid-glass">
    <v-card-title class="subtitle-1">Welcome to Gero Dashboard</v-card-title>

    <section v-if="!hasAssets" class="mb-10">
      <p class="display-1">Let's start by getting some {{ assetType }} into your wallet!</p>
      <p class="subtitle-1" v-if="assetType === Blockchain.APEX_PRIME">
        Claim your {{ assetType }} tokens with your Wallet by using the DApp below
      </p>
      <v-btn class="claim-apex-button" v-if="assetType === Blockchain.APEX_PRIME"></v-btn>
    </section>

    <section
      class="text-center d-flex align-center justify-center flex-column stake-apex-section"
      :class="{ 'no-apex': !hasAssets }"
    >
      <div class="stake-apex-info">
        <h1 class="display-1">Stake Your {{ assetType }} and Earn Rewards</h1>
        <v-card-text class="subtitle-1" v-if="loggedWallet"
          >Earn rewards by staking your {{ assetType }} tokens with {{ loggedWallet?.chain }}'s extensive network of
          stake pools.</v-card-text
        >
        <p class="subtitle-1 support-us-text" v-if="geroPoolExists">
          Consider supporting us by delegating your stake to GERO and start earning as soon as current epoch!
        </p>

        <div class="d-flex align-center justify-center flex-column">
          <v-btn class="stake-button-gero" v-if="geroPoolExists" @click="delegateToGero">Stake with GERO</v-btn>
          <v-btn class="stake-button-pools" to="/staking">Browse Stake Pools</v-btn>
        </div>
      </div>

      <h2 class="error-message">You need to have {{ assetType }} in your wallet before staking!</h2>
    </section>
    <DelegateDialog
      :isOpen="isDelegateDialogOpen"
      @close="isDelegateDialogOpen = false"
      @utxo-spent="markUtxoAsSpent"
      @tx-success="clearSpentUtxos"
      :pool="selectedPool"
      :tx="txData"
    ></DelegateDialog>
  </v-card>
</template>
<script setup lang="ts">
import { computed, ref, toRefs } from 'vue';
import { Blockchain } from '@/models/types';
import networks from '@/utils/networks';
import { Cardano } from '@cardano-sdk/core';
import DelegateDialog from '@/modules/staking/dialogs/DelegateDialog.vue';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import stakingStore from '@/stores/stakingStore';
import { buildCardanoTransaction } from '@/shared/utils/builder';
import snackbar from '@/plugins/snackbar';

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
      snackbar.setError('Failed to load GERO pool information');
      return;
    }

    selectedPool.value = stakingStore.state.currentPool;

    // Check if we have epoch parameters
    if (!epochParams.value) {
      throw new Error('Epoch parameters not available');
    }

    // Filter out spent UTXOs from localStorage
    const SPENT_UTXOS_KEY = 'gero_spent_utxos';
    let availableUtxos = utxos.value;

    console.log('🔍 Starting UTXO filtering for GERO delegation');
    console.log('   Total UTXOs available:', utxos.value.length);
    console.log('   UTXO IDs:', utxos.value.map(u => `${u[0].txId}#${u[0].index}`));

    try {
      const stored = localStorage.getItem(SPENT_UTXOS_KEY);
      console.log('   localStorage spent UTXOs raw:', stored);

      if (stored) {
        const spentUtxosArray = JSON.parse(stored);
        console.log('   Parsed spent UTXOs:', spentUtxosArray);

        if (spentUtxosArray.length > 0) {
          const spentUtxosSet = new Set(spentUtxosArray);
          console.log('🚫 Filtering out spent UTXOs for GERO delegation:', Array.from(spentUtxosSet));

          availableUtxos = utxos.value.filter(u => {
            const utxoId = `${u[0].txId}#${u[0].index}`;
            const isSpent = spentUtxosSet.has(utxoId);
            if (isSpent) {
              console.log('   ❌ Excluding spent UTXO:', utxoId);
            }
            return !isSpent;
          });
          console.log('🔍 Available UTXOs after filtering:', availableUtxos.length);
        } else {
          console.log('   No spent UTXOs in localStorage');
        }
      } else {
        console.log('   No spent UTXOs localStorage key found');
      }
    } catch (e) {
      console.warn('Failed to load spent UTXOs from localStorage:', e);
    }

    if (availableUtxos.length === 0) {
      throw new Error('No available UTXOs. Please refresh the page (F5) to sync your wallet.');
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

    // Build the delegation transaction with filtered UTXOs
    txData.value = await buildCardanoTransaction({
      certificates,
      utxos: availableUtxos,
      epochParams: epochParams.value,
      changeAddress: keys.value.payment[0].address,
      tip: tip.value,
      implicitCoin,
    });

    isDelegateDialogOpen.value = true;
  } catch (error: any) {
    console.error('Error building delegation transaction:', error);
    if (error.message?.includes('UTxO Balance Insufficient')) {
      snackbar.setError('Insufficient ADA to complete staking transaction');
    } else {
      snackbar.setError('Failed to build delegation transaction: ' + (error.message || 'Unknown error'));
    }
  }
};

/**
 * Marks a UTXO as spent in localStorage to prevent it from being used in future transactions.
 */
const markUtxoAsSpent = (utxoId: string) => {
  const SPENT_UTXOS_KEY = 'gero_spent_utxos';
  console.log('📝 markUtxoAsSpent called with:', utxoId);
  try {
    const stored = localStorage.getItem(SPENT_UTXOS_KEY);
    console.log('   Current localStorage value:', stored);
    const spentUtxosArray = stored ? JSON.parse(stored) : [];
    console.log('   Current spent UTXOs array:', spentUtxosArray);
    const spentUtxosSet = new Set(spentUtxosArray);
    spentUtxosSet.add(utxoId);
    const updatedArray = Array.from(spentUtxosSet);
    console.log('   Updated spent UTXOs array:', updatedArray);
    localStorage.setItem(SPENT_UTXOS_KEY, JSON.stringify(updatedArray));
    console.log('✅ Marked UTXO as spent in localStorage:', utxoId);

    // Verify it was written
    const verification = localStorage.getItem(SPENT_UTXOS_KEY);
    console.log('   Verification read:', verification);
  } catch (e) {
    console.warn('Failed to mark UTXO as spent in localStorage:', e);
  }
};

/**
 * Clears spent UTXOs that are no longer in the current UTXO set.
 */
const clearSpentUtxos = () => {
  const SPENT_UTXOS_KEY = 'gero_spent_utxos';
  try {
    const stored = localStorage.getItem(SPENT_UTXOS_KEY);
    if (!stored) return;

    const spentUtxosArray = JSON.parse(stored);
    if (spentUtxosArray.length === 0) return;

    console.log('🧹 Cleaning up spent UTXOs list');

    // Build a Set of current UTXO IDs for O(1) lookup
    const currentUtxoIds = new Set(
      utxos.value.map(u => `${u[0].txId}#${u[0].index}`)
    );

    // Only remove spent UTXOs that are no longer in wallet state
    const remainingUtxos = spentUtxosArray.filter((utxoId: string) => currentUtxoIds.has(utxoId));

    if (remainingUtxos.length === 0) {
      localStorage.removeItem(SPENT_UTXOS_KEY);
      console.log('✅ All spent UTXOs confirmed removed from wallet state');
    } else if (remainingUtxos.length < spentUtxosArray.length) {
      localStorage.setItem(SPENT_UTXOS_KEY, JSON.stringify(remainingUtxos));
      console.log(`✅ Removed ${spentUtxosArray.length - remainingUtxos.length} confirmed spent UTXOs from tracking`);
    }
  } catch (e) {
    console.warn('Failed to clean up spent UTXOs from localStorage:', e);
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
