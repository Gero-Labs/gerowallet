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
        :src="assets.midnightLoginBg"
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

      <!-- Right column - intro hero → onboarding (revealed on Get Started) -->
      <div class="welcome-right-column">
        <div class="right-content">
          <transition name="onboarding-reveal" mode="out-in">
            <!-- Intro: showcase hero + Get Started CTA -->
            <div v-if="!started" key="intro" class="right-panel">
              <div class="welcome-intro">
                <NoWalletsWelcomeCard />
                <v-btn
                  class="geroButton get-started-btn"
                  rounded
                  x-large
                  depressed
                  @click="started = true"
                >
                  {{ $t('welcome.getStarted') }}
                  <v-icon right>mdi-arrow-right</v-icon>
                </v-btn>
              </div>
            </div>

            <!-- Onboarding flow -->
            <div v-else key="onboarding" class="right-panel">
              <WalletOnboarding :network="selectedNetwork" :dev-mode="devMode" @network-change="onOnboardingNetwork" @update:dev-mode="devMode = $event" />
            </div>
          </transition>

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
import NoWalletsWelcomeCard from '@/options/modules/welcome/components/NoWalletsWelcomeCard.vue';

const DEV_NETWORKS_KEY = 'gero:devNetworks';

// Onboarding is gated behind the Get Started CTA so the welcome screen opens on
// the showcase hero rather than the full blockchain/method form.
const started = ref<boolean>(false);
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
  border-radius: var(--g-r-control);
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

/* Intro state: compact showcase hero with the Get Started CTA overlaid on it */
.welcome-intro {
  position: relative;
  width: 100%;
  max-width: 460px;
  align-self: center; /* vertically centered within the right column */
  margin: 0 auto;
}

.get-started-btn {
  position: absolute;
  left: 50%;
  bottom: 0;
  transform: translate(-50%, 50%); /* straddle the card's bottom edge */
  min-width: 176px;
  height: 44px !important;
  font-size: 14px;
  font-weight: 700;
  text-transform: none;
  z-index: 5;
}

/* Reveal transition: only the intro fades OUT. The onboarding card mounts fully
   opaque — animating its opacity makes Chrome drop the liquid-glass
   backdrop-filter for a few frames (card flashes transparent then snaps in). */
.onboarding-reveal-leave-active {
  transition: opacity 0.25s ease;
}

.onboarding-reveal-leave-to {
  opacity: 0;
}

/* Fallback for browsers without backdrop-filter support */
@supports not ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .welcome-glass-panel {
    background-color: var(--g-raised);
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
