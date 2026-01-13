<template>
  <div class="welcome-root">
    <!-- Full-width crisp background image -->
    <div class="welcome-background">
      <img :src="welcomeBg" class="welcome-background-image" />
    </div>

    <!-- Main container -->
    <div class="welcome-container">
      <!-- Left column - Liquid glass panel -->
      <div class="welcome-left-column">
        <WalletCreation
          :selectedNetwork="selectedNetwork"
          :createOrImportSeedPhrase="createOrImportSeedPhrase"
          @networkChanged="onNetworkChanged"
          @createOrImportSeedPhrase="enableCreateOrImportSeedPhrase"
        />
      </div>

      <!-- Right column - Clean background, no glass effects -->
      <div class="welcome-right-column">
        <div class="right-content">
          <!-- No wallets state -->
          <div
            v-if="!createOrImportSeedPhrase && Array.isArray(availableWallets) && availableWallets.length == 0"
            class="right-panel"
          >
            <NoWalletsWelcomeCard />
          </div>

          <!-- Create/Import state -->
          <div v-else-if="createOrImportSeedPhrase" class="right-panel">
            <CreateOrImportSeedPhrase @back="disableCreateOrImportSeedPhrase" :network="selectedNetwork" />
          </div>

          <!-- Wallets list -->
          <div v-else class="right-panel">
            <WalletsListLogin />
          </div>

          <!-- Footer -->
          <LegalFooter />
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, toRefs } from 'vue';
import networks, { NetworkInfo } from '@/utils/networks';
import assets from '@/utils/assets';
import NoWalletsWelcomeCard from '@/options/modules/welcome/components/NoWalletsWelcomeCard.vue';
import { WalletType } from '@/models/types';
import WalletsListLogin from '@/options/modules/welcome/components/WalletsListLogin.vue';
import CreateOrImportSeedPhrase from '@/options/modules/welcome/components/CreateOrImportSeedPhrase.vue';
import { geroStore } from '@/stores/geroStore';
import WalletCreation from '@/modules/welcome/components/WalletCreation/WalletCreation.vue';
import LegalFooter from '@/modules/welcome/components/LegalFooter/LegalFooter.vue';

const createOrImportSeedPhrase = ref<boolean>(false);
const selectedNetwork = ref<NetworkInfo>(null);

const { wallets } = toRefs(geroStore);

const disableCreateOrImportSeedPhrase = (): void => {
  createOrImportSeedPhrase.value = false;
};
const onNetworkChanged = (network: NetworkInfo) => {
  selectedNetwork.value = network;
};
const enableCreateOrImportSeedPhrase = (): void => {
  createOrImportSeedPhrase.value = true;
};

const availableWallets = computed(() => {
  return Object.values(wallets.value)?.filter(
    (wallet: any) => networks.resolveNetwork(wallet?.chain, wallet?.network) && wallet?.type !== WalletType.Google
  );
});

const welcomeBg = computed(() => {
  if (selectedNetwork.value?.blockchain?.includes('Apex')) {
    return assets.apexBg;
  }
  return assets.cardanoBg;
});
</script>
<style scoped>
.welcome-root {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
}

.welcome-background {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  z-index: 0;
}

.welcome-background-image {
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: none;
  image-rendering: -webkit-optimize-contrast;
  image-rendering: crisp-edges;
  transform: translateY(20%);
}

.welcome-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  gap: 60px;
  z-index: 1;
  max-width: 1440px;
  margin: 0 auto;
}

/* RIGHT COLUMN - CLEAN BACKGROUND */
.welcome-right-column {
  width: 62%; /* Increased from 58.333333% to account for left column reduction */
  height: 100%;
  position: relative;
  /* NO backdrop-filter or blur effects here */
  background: transparent;
}

.right-content {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.right-panel {
  flex: 1;
  display: flex;
  align-items: flex-start;
  justify-content: center;
}

/* Fallback for browsers without backdrop-filter support */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .welcome-glass-panel {
    background-color: rgba(19, 22, 27, 0.95);
  }
}

/* Responsive */
@media (max-width: 768px) {
  .welcome-container {
    flex-direction: column;
  }

  .welcome-left-column {
    width: 100%;
    height: auto;
    min-height: 300px;
  }

  .welcome-right-column {
    width: 100%;
    height: auto;
    flex: 1;
  }
}
</style>
