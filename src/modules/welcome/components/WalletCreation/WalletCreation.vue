<template>
  <div class="welcome-glass-panel glass-chrome">
    <div class="welcome-content">
      <div class="welcome-header">
        <div class="logo-container">
          <div
            class="logo"
            :style="{
              backgroundImage: `url(${logo})`,
              backgroundSize: 'contain',
              backgroundRepeat: 'no-repeat',
            }"
          />
        </div>
      </div>

      <!-- The zero-wallet case never reaches this panel: Welcome.vue swaps the
           whole left column for the centered onboarding hero instead. -->
      <WalletsListLogin v-if="hasWallets" :hide-header="true" class="wallet-list-block" @network-change="onNetworkChange" />
    </div>

    <div class="footer-left t-caption">&#169; {{ new Date().getFullYear() }} {{ $t('welcome.adLabs') }}</div>
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

// Use the same eligibility rule as the shared wallet list.
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
/* The sign-in panel is the welcome screen's frame: the glass-chrome material
   (the nav drawer's), which draws its own blur and right-hand hairline. */
.welcome-glass-panel {
  width: 100%;
  height: 100%;
  display: flex;
  flex-direction: column;
  position: relative;
}

.welcome-content {
  flex: 1;
  width: 100%;
  align-self: center;
  /* Without min-height:0 this flex item grows to its content height (the full
     wallet list), so the list child never gets a bounded height to scroll in.
     This is the load-bearing line for the list's internal scroll. */
  min-height: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: flex-start;
  padding: var(--g-s-4);
  position: relative;
  max-width: 428px;
}

.welcome-header { display: flex; flex-direction: column; align-items: center; flex: none; width: 100%; }
.logo { width: 72px; height: 81px; }

.logo-container {
  margin: var(--g-s-2) 0 var(--g-s-3);
}

.wallet-list-block {
  width: 100%;
  /* Fill the space between the logo and the footer and let the list scroll
     inside it, instead of a fixed height that overflows the page on shorter
     viewports (min-height:0 lets a flex child actually shrink + scroll). */
  flex: 1 1 auto;
  min-height: 0;
  display: flex;
  flex-direction: column;
}

/* Type comes from the ramp class in the markup. */
.footer-left {
  padding: var(--g-s-3) var(--g-s-5);
}
</style>
