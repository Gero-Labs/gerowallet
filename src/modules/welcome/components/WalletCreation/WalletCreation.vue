<template>
  <div class="welcome-glass-panel">
    <div class="welcome-content">
      <div class="logo-container">
        <div
          class="logo"
          :style="{
            backgroundImage: `url(${logo})`,
            backgroundSize: 'contain',
            backgroundRepeat: 'no-repeat',
            width: '122px',
            height: '138px',
          }"
        />
      </div>

      <div class="welcome-heading">
        <div class="welcome-title">{{ $t('welcome.welcomeMessage') }}</div>
        <!-- "Choose a wallet to sign in" only makes sense when there is a wallet
             to choose. With an empty list the right-column hero + Get Started CTA
             is the create-first-wallet path, so drop the sign-in subtitle. -->
        <div v-if="hasWallets" class="welcome-subtitle">{{ $t('welcome.chooseAWallet') }}</div>
      </div>

      <!-- The zero-wallet case never reaches this panel: Welcome.vue swaps the
           whole left column for the centered onboarding hero instead. -->
      <WalletsListLogin v-if="hasWallets" :hide-header="true" class="wallet-list-block" @network-change="onNetworkChange" />
    </div>

    <div class="footer-left">&#169; {{ new Date().getFullYear() }} {{ $t('welcome.adLabs') }}</div>
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue';
import { geroDashboardApex, geroDashboardPrime, geroDashboardVector, geroDashboardBitcoin, geroDashboard } from '@/utils/assets';
import WalletsListLogin from '@/options/modules/welcome/components/WalletsListLogin.vue';
import { NetworkInfo } from '@/utils/networks';
import { useAvailableWallets } from '@/shared/composables/useAvailableWallets';

const props = defineProps<{
  selectedNetwork: NetworkInfo;
}>();

const emit = defineEmits<{
  (e: 'network-change', n: NetworkInfo): void;
}>();

const onNetworkChange = (n: NetworkInfo): void => {
  emit('network-change', n);
};

// Shared eligibility rule, so the heading stays in sync with what the list
// actually renders.
const { hasWallets } = useAvailableWallets();

// Logo reacts to the selected network's brand colors.
const logo = computed(() => {
  const bc = props.selectedNetwork?.blockchain;
  if (bc === 'Apex Fusion Prime') return geroDashboardPrime;
  if (bc === 'Apex Fusion Vector') return geroDashboardVector;
  if (bc?.includes('Apex')) return geroDashboardApex;
  if (bc?.includes('Bitcoin')) return geroDashboardBitcoin;
  return geroDashboard;
});
</script>
<style scoped>
.welcome-left-column {
  width: 38%;
  height: 100%;
  position: relative;
}

.welcome-glass-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
  backdrop-filter: blur(20px) saturate(1.5);
  -webkit-backdrop-filter: blur(20px) saturate(1.5);
  border-right: 1px solid var(--g-hairline-3);
  box-shadow: inset 0 1px 0 var(--g-hairline-2), 4px 0 24px rgba(0, 0, 0, 0.4);
}

.welcome-glass-panel::before {
  content: '';
  position: absolute;
  top: 0;
  right: 0;
  bottom: 0;
  width: 1px;
  background: linear-gradient(180deg, transparent, var(--g-hairline-2), transparent);
  z-index: 1;
}

.welcome-content {
  flex: 1;
  /* Without min-height:0 this flex item grows to its content height (the full
     wallet list), so the list child never gets a bounded height to scroll in.
     This is the load-bearing line for the list's internal scroll. */
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start; /* logo, heading, list stack from the top */
  padding: 18px;
  position: relative;
  z-index: 2;
  max-width: 428px;
}

.logo-container {
  margin-top: 56px; /* bring the logo down from the top edge */
  margin-bottom: 16px;
}

.welcome-heading {
  text-align: center;
  margin-bottom: 20px;
}

.welcome-title {
  font-size: 32px;
  font-weight: 700;
  color: var(--g-text-1);
  line-height: 1.2;
}

.welcome-subtitle {
  font-size: 16px;
  color: var(--g-text-3);
  margin-top: 4px;
}

.wallet-list-block {
  width: 100%;
  /* Fill the space between the heading and the footer and let the list scroll
     inside it, instead of a fixed height that overflows the page on shorter
     viewports (min-height:0 lets a flex child actually shrink + scroll). */
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

.logo-container .logo {
  transition: color var(--g-dur-slow) ease, background-color var(--g-dur-slow) ease, border-color var(--g-dur-slow) ease, opacity var(--g-dur-slow) ease, transform var(--g-dur-slow) ease, box-shadow var(--g-dur-slow) ease;
}

.text-container {
  width: 100%;
  max-width: 400px;
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 0 10px;
}

.subtitle {
  font-size: 16px;
  font-weight: 300;
  margin-bottom: 4px;
}

.title {
  font-size: 32px !important;
  white-space: normal;
  margin-bottom: 20px;
  line-height: 1.2 !important;
  word-break: break-word;
  hyphens: auto;
}

.title-regular {
  font-weight: 400 !important;
  font-size: 32px !important;
  line-height: 1.2 !important;
}

.title-gradient {
  font-weight: 700 !important;
  font-size: 32px !important;
  line-height: 1.2 !important;
}

.description {
  color: var(--g-text-3);
  font-size: 16px;
  white-space: nowrap;
  margin-bottom: 20px;
}

.create-btn {
  margin-top: 12px;
  letter-spacing: normal;
  border-radius: var(--g-r-control);
  text-transform: none;
}

.footer-left {
  padding: 12px 20px;
  font-size: 11px;
  color: var(--g-text-2);
  position: relative;
  z-index: 2;
}

/* Responsive font sizing for longer text */
@media (max-width: 1200px) {
  .title {
    font-size: 32px !important;
  }

  .title-regular,
  .title-gradient {
    font-size: 32px !important;
  }
}

@media (max-width: 900px) {
  .title {
    font-size: 32px !important;
  }

  .title-regular,
  .title-gradient {
    font-size: 32px !important;
  }
}
</style>
