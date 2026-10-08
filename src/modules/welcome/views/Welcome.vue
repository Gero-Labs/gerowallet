<template>
  <div class="welcome-root">
    <!-- Full-width crisp background image -->
    <div class="welcome-background">
      <!-- Two separate images for cross-fade transition -->
      <img
        :src="assets.cardanoBg"
        class="welcome-background-image welcome-background-image--cardano"
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
      <GButton compact tier="tertiary" @click="enterHelp(false)">{{ $t('help.title') }}</GButton>
      <GButton compact tier="tertiary" @click="enterHelp(true)">{{ $t('help.contact') }}</GButton>
      <LanguageSelector />
    </div>

    <!-- Main container -->
    <p v-if="helpOpenFailed" role="status" class="welcome-help-error t-body-sm">
      {{ $t('help.openFailed') }}
      <a :href="helpFallbackPath" target="_blank" rel="noopener noreferrer">{{ $t('help.openNewTab') }}</a>
    </p>
    <div class="welcome-container">
      <!-- Left column - logo + existing wallet list. With zero wallets there
           is nothing to sign in to, so the whole panel yields to the
           centered onboarding hero. -->
      <div v-if="hasWallets" class="welcome-left-column">
        <WalletCreation
          :selectedNetwork="selectedNetwork"
          @network-change="onWalletListNetwork"
        />
      </div>

      <!-- Right column - intro hero → onboarding (revealed on Get Started) -->
      <div class="welcome-right-column" :class="{ 'welcome-right-column--full': !hasWallets }">
        <div class="right-content">
          <transition name="onboarding-reveal" mode="out-in">
            <!-- Intro: the same showcase hero in both states. First-run leads
                 with logo + Welcome! + create CTA; the storefront variant
                 (wallets exist, signed out) leads with the product pitch,
                 since the left sign-in panel already carries the branding. -->
            <div v-if="!started" key="intro" class="right-panel">
              <OnboardingHero
                :variant="hasWallets ? 'storefront' : 'first-run'"
                @get-started="started = true"
              />
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
import OnboardingHero from '@/modules/welcome/components/onboarding/OnboardingHero.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useRouter } from 'vue-router/composables';
import { openWelcomeHelp } from '@/modules/navigation/helpAccess';
import { useAvailableWallets } from '@/shared/composables/useAvailableWallets';
import { applyChainAccent } from '@/shared/composables/useChainAccent';

const helpRouter = useRouter();
const helpOpenFailed = ref(false);
const helpFallbackPath = ref('#/help');
const enterHelp = async (support: boolean) => {
  helpFallbackPath.value = support ? '#/help?support=1' : '#/help';
  helpOpenFailed.value = !await openWelcomeHelp(started.value, support, path => helpRouter.push(path));
};

const DEV_NETWORKS_KEY = 'gero:devNetworks';

// Onboarding is gated behind the Get Started CTA so the welcome screen opens on
// the showcase hero rather than the full blockchain/method form.
const started = ref<boolean>(false);
const selectedNetwork = ref<NetworkInfo>(networks.networks[0]);

// Shared eligibility rule: zero wallets flips the layout from the split
// sign-in view to the full-width onboarding hero.
const { hasWallets } = useAvailableWallets();
const devMode = ref<boolean>(localStorage.getItem(DEV_NETWORKS_KEY) === 'true');

watch(devMode, (val) => {
  localStorage.setItem(DEV_NETWORKS_KEY, String(val));
});

// Pre-login, useChainAccent is dormant (it keys on loggedWallet, and none is
// signed in yet), so the chain accent slots stay at the Cardano default while
// the welcome background already follows the previewed network. Drive the same
// --g-* slots here from selectedNetwork so the Get Started CTA gradient and any
// accent-tinted chrome match the chosen chain (teal Prime, orange Vector, …).
watch(selectedNetwork, (n) => applyChainAccent(n?.blockchain), { immediate: true });

const onOnboardingNetwork = (n: NetworkInfo): void => {
  selectedNetwork.value = n;
};

// The left wallet list previews a chain's theme on hover (nice on the intro hero).
// But once Get Started is open the user is explicitly choosing a chain/network in
// the dialog — hovering a wallet must NOT hijack that choice or the theme/logo.
// So wallet-list-driven network changes only apply before onboarding starts.
const onWalletListNetwork = (n: NetworkInfo): void => {
  if (!started.value) selectedNetwork.value = n;
};
</script>
<style scoped lang="scss">
.welcome-help-error {
  position: absolute;
  top: calc(var(--g-s-6) * 3);
  right: var(--g-s-6);
  z-index: 100;
  max-width: min(440px, 90vw);
  padding: var(--g-s-4);
  color: var(--g-text-1);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-card);
  a { color: var(--g-accent); }
}
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

/* cardanoBg.png ships pre-flipped on both axes for the dashboard backdrop;
   the welcome canvas wants the original orientation. */
.welcome-background-image--cardano {
  transform: scale(-1, -1);
}

.language-selector-container {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: var(--g-s-2);
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

/* Zero wallets: the sign-in panel is gone, the hero owns the full width */
.welcome-right-column--full {
  width: 100%;
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
  min-height: 0;
  overflow-y: auto; /* the onboarding hero can exceed short viewports */
  padding: 16px;
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
