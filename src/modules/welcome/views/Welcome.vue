<template>
  <div class="welcome-root">
    <!-- Full-width crisp background image -->
    <div class="welcome-background">
      <!-- Two separate images for cross-fade transition -->
      <img
        :src="assets.cardanoBg"
        class="welcome-background-image"
        :class="{ 'background-active': selectedNetwork?.blockchain?.includes('Cardano') }"
      />
      <img
        :src="assets.apexPrimeBg"
        class="welcome-background-image"
        :class="{ 'background-active': selectedNetwork?.blockchain === 'Apex Fusion Prime' }"
      />
      <img
        :src="assets.apexVectorBg"
        class="welcome-background-image"
        :class="{ 'background-active': selectedNetwork?.blockchain === 'Apex Fusion Vector' }"
      />
      <img
        :src="assets.bitcoinWavesBg"
        class="welcome-background-image"
        :class="{ 'background-active': selectedNetwork?.blockchain?.includes('Bitcoin') }"
      />
      <img
        :src="assets.midnightBg"
        class="welcome-background-image"
        :class="{ 'background-active': selectedNetwork?.blockchain?.includes('Midnight') }"
      />
    </div>

    <!-- Language Selector - Floating top-right -->
    <div class="language-selector-container">
      <LanguageSelector />
    </div>

    <!-- Main container -->
    <div class="welcome-container">
      <!-- Left column - logo + existing wallet list -->
      <div class="welcome-left-column">
        <WalletCreation
          :selectedNetwork="selectedNetwork"
          @network-change="onOnboardingNetwork"
        />
      </div>

      <!-- Right column - create / import onboarding (always shown) -->
      <div class="welcome-right-column">
        <div class="right-content">
          <div class="right-panel">
            <WalletOnboarding :network="selectedNetwork" :dev-mode="devMode" @network-change="onOnboardingNetwork" @update:dev-mode="devMode = $event" />
          </div>

          <!-- Footer -->
          <LegalFooter />
        </div>
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, watch } from 'vue';
import networks, { NetworkInfo } from '@/utils/networks';
import assets from '@/utils/assets';
import WalletOnboarding from '@/modules/welcome/components/WalletOnboarding/WalletOnboarding.vue';
import WalletCreation from '@/modules/welcome/components/WalletCreation/WalletCreation.vue';
import LegalFooter from '@/modules/welcome/components/LegalFooter/LegalFooter.vue';
import LanguageSelector from '@/modules/navigation/components/LanguageSelector.vue';

const DEV_NETWORKS_KEY = 'gero:devNetworks';

const selectedNetwork = ref<NetworkInfo>(networks.networks[0]);
const devMode = ref<boolean>(localStorage.getItem(DEV_NETWORKS_KEY) === 'true');

watch(devMode, (val) => {
  localStorage.setItem(DEV_NETWORKS_KEY, String(val));
});

const onOnboardingNetwork = (n: NetworkInfo): void => {
  selectedNetwork.value = n;
};
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
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  object-fit: cover;
  filter: none;
  image-rendering: -webkit-optimize-contrast;
  image-rendering: crisp-edges;
  opacity: 0;
  /* Pure cross-fade between chains — no vertical slide (a translateY here both
     left a black gap at the top and made the image jump on hover). */
  transition: opacity 0.3s ease;
}

.welcome-background-image.background-active {
  opacity: 1;
}

.language-selector-container {
  position: fixed;
  top: 0;
  right: 0;
  z-index: 100;
  backdrop-filter: blur(10px);
  border-radius: 8px;
  padding: 4px 8px;
}

.welcome-container {
  position: relative;
  width: 100%;
  height: 100%;
  display: flex;
  z-index: 1;
  max-width: 1440px;
  margin: 0 auto;
}

/* RIGHT COLUMN - CLEAN BACKGROUND */
.welcome-right-column {
  width: 73%;
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
    height: auto;
    min-height: 300px;
    width: 450px;
  }

  .welcome-right-column {
    width: 100%;
    height: auto;
    flex: 1;
  }
}
</style>
