<template>
  <!-- Empty-wallet hero sidekick: sits in the RecentTransactionsCard slot while
       there is nothing to transact. Shared glass-panel material (user request
       2026-07-15). A plain div, not v-card, so no Vuetify cascade fight. -->
  <div class="fill-height d-flex flex-column glass-panel funding-card">
    <h3 class="t-heading">{{ $t('portfolio.fundingTitle') }}</h3>
    <p class="funding-card__sub t-body-sm">{{ $t('portfolio.fundingSub') }}</p>

    <div class="funding-card__actions">
      <GButton v-if="buySupported" tier="primary" block class="funding-card__buy" @click="$emit('buy')">
        {{ $t('dashboard.buy') }} {{ currencyTicker }}
      </GButton>
      <GButton tier="secondary" compact block @click="$emit('receive')">
        {{ $t('dashboard.receiveAction') }}
      </GButton>
    </div>

    <button
      v-if="truncatedAddress"
      type="button"
      class="funding-card__addr g-mono"
      :title="$t('dashboard.copyAddress')"
      @click="copyAddress"
    >
      {{ copiedFeedback ? $t('dashboard.copied') : truncatedAddress }}
      <v-icon size="12" color="var(--g-text-3)">{{ copiedFeedback ? 'mdi-check' : 'mdi-content-copy' }}</v-icon>
    </button>
  </div>
</template>

<script setup lang="ts">
import { toRefs, ref, computed } from 'vue';
import { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';
import GButton from '@/shared/components/GButton/GButton.vue';

defineEmits(['buy', 'receive']);

const { loggedWallet } = toRefs(walletStore);

const currencyTicker = computed(() =>
  networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network));

const buySupported = computed(() =>
  networks.resolveBuySupported(loggedWallet.value?.chain, loggedWallet.value?.network));

const walletAddress = computed(() => loggedWallet.value?.baseAddress || '');

const truncatedAddress = computed(() => {
  const a = walletAddress.value;
  if (!a) return '';
  return a.length > 16 ? `${a.slice(0, 9)}…${a.slice(-5)}` : a;
});

const copiedFeedback = ref(false);

const copyAddress = async () => {
  if (!walletAddress.value) return;
  try {
    await navigator.clipboard.writeText(walletAddress.value);
  } catch (err) {
    const textArea = document.createElement('textarea');
    textArea.value = walletAddress.value;
    document.body.appendChild(textArea);
    textArea.select();
    document.execCommand('copy');
    document.body.removeChild(textArea);
  }
  copiedFeedback.value = true;
  setTimeout(() => { copiedFeedback.value = false; }, 2000);
};
</script>

<style scoped>
/* Surface comes from the shared .glass-panel material; only layout here. */
.funding-card {
  padding: var(--g-s-4);
}

.funding-card__sub {
  margin: 2px 0 0;
}

.funding-card__actions {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin-top: auto;
}

/* Ambient sheen on the primary CTA: one sweep every ~4s (user-requested loop
   on this surface, 2026-07-15 — mostly rest, killed under reduced motion). */
.funding-card__buy {
  position: relative;
  overflow: hidden;
}

.funding-card__buy::after {
  content: '';
  position: absolute;
  top: 0;
  bottom: 0;
  left: -55%;
  width: 40%;
  background: linear-gradient(105deg, transparent, rgba(255, 255, 255, 0.22), transparent);
  transform: skewX(-18deg);
  pointer-events: none;
  animation: fc-sheen 4200ms var(--g-ease) infinite;
}

@keyframes fc-sheen {
  0% { transform: translateX(0) skewX(-18deg); }
  16% { transform: translateX(420%) skewX(-18deg); }
  100% { transform: translateX(420%) skewX(-18deg); }
}

@media (prefers-reduced-motion: reduce) {
  .funding-card__buy::after { animation: none; }
}

.funding-card__addr {
  appearance: none;
  background: none;
  border: none;
  font-family: var(--g-font-mono);
  font-size: 12px;
  color: var(--g-text-3);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  cursor: pointer;
  margin-top: var(--g-s-2);
  transition: color var(--g-dur-fast) var(--g-ease);
}

.funding-card__addr:hover { color: var(--g-accent); }
</style>
