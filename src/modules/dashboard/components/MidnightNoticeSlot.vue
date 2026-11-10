<template>
  <!-- One place for the Midnight notices above the balance (dashboard and side
       panel), so a cutover that sets off several never pushes the balance and
       Send off a 360px panel: at most MAX_NOTICES, by precedence (midnightNotices.ts).
       Renders nothing when none applies, so a parent's spacing class takes no room. -->
  <div v-if="shown.length" v-bind="$attrs" class="notice-slot" data-test="midnight-notice-slot">
    <component :is="NOTICE_COMPONENTS[id]" v-for="id in shown" :key="id" v-bind="noticeProps(id)" />
  </div>
  <!-- Always mounted, so the start of a refresh is announced: a region added
       together with its first message is often not read. Says the refreshing
       sentence once when it starts or changes (stalled), never the percentage. -->
  <p class="g-sr-only" role="status" aria-live="polite" aria-atomic="true" data-test="midnight-notice-announcer">{{ announcer.message.value }}</p>
</template>

<script lang="ts">
// The spacing class goes on the notices, not on the always-mounted announcer.
export default { inheritAttrs: false };
</script>

<script setup lang="ts">
import { computed, watch, type Component } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { useMidnightNetworkUpgrading, useMidnightUpdateRequired } from '@/chains/midnight/midnightWriteGate';
import { MAX_NOTICES, visibleMidnightNotices, type MidnightNoticeId } from './midnightNotices';
import { isMidnightStagenetWallet } from './midnightStagenet';
import MidnightNetworkUpgradeBanner from './MidnightNetworkUpgradeBanner.vue';
import MidnightUpdateRequiredBanner from './MidnightUpdateRequiredBanner.vue';
import MidnightStagenetNotice from './MidnightStagenetNotice.vue';
import MidnightRefreshingNotice from './MidnightRefreshingNotice.vue';
import { useMidnightRefresh, useMidnightRefreshSentence } from '@/shared/composables/useMidnightRefresh';
import { usePoliteAnnouncer } from '@/shared/composables/usePoliteAnnouncer';

const props = withDefaults(defineProps<{
  /** `panel`: the side panel's narrow column. */
  layout?: 'page' | 'panel';
}>(), { layout: 'page' });

const NOTICE_COMPONENTS: Record<MidnightNoticeId, Component> = {
  update: MidnightUpdateRequiredBanner,
  upgrade: MidnightNetworkUpgradeBanner,
  refreshing: MidnightRefreshingNotice,
  stagenet: MidnightStagenetNotice,
};

const network = computed(() => walletStore.loggedWallet?.network ?? '');
// One gate entry per network: update required and the upgrade never both hold.
const updateRequired = useMidnightUpdateRequired(() => network.value);
const upgrading = useMidnightNetworkUpgrading(() => network.value);
const stagenet = computed(() => isMidnightStagenetWallet(walletStore.loggedWallet));
const { refreshing } = useMidnightRefresh();

// The refresh's start (and a stall) said once, from a region that is always there.
const announcer = usePoliteAnnouncer();
const refreshSentence = useMidnightRefreshSentence();
watch(refreshSentence, (sentence) => { if (sentence) announcer.announce(sentence); });

const shown = computed(() => visibleMidnightNotices({
  update: updateRequired.value,
  upgrade: upgrading.value,
  refreshing: refreshing.value,
  stagenet: stagenet.value,
}, MAX_NOTICES));

function noticeProps(id: MidnightNoticeId): Record<string, unknown> {
  // The side panel stretches the update banner's restart button across it.
  return id === 'update' ? { block: props.layout === 'panel' } : {};
}
</script>

<style scoped lang="scss">
.notice-slot {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
</style>
