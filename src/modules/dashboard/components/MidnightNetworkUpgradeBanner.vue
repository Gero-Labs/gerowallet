<template>
  <!-- Sends and DUST registration on this network are paused for a network
       upgrade (midnightWriteGate.ts). Reads, Receive and history are unaffected. -->
  <div v-if="paused" class="upgrade-banner" role="status" data-test="midnight-upgrade-banner">
    <v-icon size="20" color="warning" class="upgrade-banner__icon">mdi-pause-circle-outline</v-icon>
    <div class="upgrade-banner__body">
      <div class="upgrade-banner__title t-body">{{ t('midnight.upgrade.title') }}</div>
      <div class="upgrade-banner__text t-body-sm">{{ t('midnight.errors.networkUpgrading', { network }) }}</div>
    </div>
    <a
      class="upgrade-banner__link t-body-sm"
      :href="LEARN_MORE_URL"
      target="_blank"
      rel="noopener noreferrer"
    >
      {{ t('common.learnMore') }}
      <v-icon size="13">mdi-open-in-new</v-icon>
    </a>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { useMidnightNetworkUpgrading } from '@/chains/midnight/midnightWriteGate';
import { midnightNetworkDisplayName } from '@/api/midnightApiError';

/** Midnight's own news, where network upgrades are announced. */
const LEARN_MORE_URL = 'https://midnight.network/blog';

const { t } = useTranslation();
const walletNetwork = computed(() => walletStore.loggedWallet?.network ?? '');
/** "Midnight Preprod": the name the network list shows. */
const network = computed(() => midnightNetworkDisplayName(walletNetwork.value));
const paused = useMidnightNetworkUpgrading(() => walletNetwork.value);
</script>

<style scoped lang="scss">
/* A banner: the warning glyph on the muted warning pair (fill and line), per the design system. */
.upgrade-banner {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  border-radius: var(--g-r-card);
}

.upgrade-banner__icon {
  margin-top: 2px;
}

.upgrade-banner__body {
  flex: 1;
  min-width: 0;
}

.upgrade-banner__title {
  color: var(--g-text-1);
  font-weight: 600;
}

.upgrade-banner__text {
  color: var(--g-text-2);
}

.upgrade-banner__link {
  color: var(--g-accent);
  white-space: nowrap;
  text-decoration: none;
}
</style>
