<template>
  <!-- Empty-wallet hero sidekick: sits in the RecentTransactionsCard slot while
       there is nothing to transact. Solid raised surface per the glass canon
       (static card, not floating chrome). A plain div, not v-card, so no
       Vuetify cascade fight and no override flags. -->
  <div class="fill-height d-flex flex-column funding-card">
    <h3 class="t-heading">{{ $t('portfolio.fundingTitle') }}</h3>
    <p class="funding-card__sub t-body-sm">{{ $t('portfolio.fundingSub') }}</p>

    <div class="funding-card__actions">
      <GButton v-if="buySupported" tier="primary" block @click="$emit('buy')">
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
.funding-card {
  border-radius: var(--g-r-card);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
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
