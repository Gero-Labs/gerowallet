<template>
  <!-- One place for the Midnight notices above the balance (dashboard and side
       panel), so a cutover that sets off several never pushes the balance and
       Send off a 360px panel: at most MAX_NOTICES, by precedence (midnightNotices.ts).
       Renders nothing when none applies, so a parent's spacing class takes no room. -->
  <div v-if="shown.length" class="notice-slot" data-test="midnight-notice-slot">
    <component :is="NOTICE_COMPONENTS[id]" v-for="id in shown" :key="id" v-bind="noticeProps(id)" />
  </div>
</template>

<script setup lang="ts">
import { computed, type Component } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { useMidnightNetworkUpgrading } from '@/chains/midnight/midnightWriteGate';
import { MAX_NOTICES, visibleMidnightNotices, type MidnightNoticeId } from './midnightNotices';
import { isMidnightStagenetWallet } from './midnightStagenet';
import MidnightNetworkUpgradeBanner from './MidnightNetworkUpgradeBanner.vue';
import MidnightStagenetNotice from './MidnightStagenetNotice.vue';

withDefaults(defineProps<{
  /** `panel`: the side panel's narrow column. */
  layout?: 'page' | 'panel';
}>(), { layout: 'page' });

const NOTICE_COMPONENTS: Record<MidnightNoticeId, Component> = {
  upgrade: MidnightNetworkUpgradeBanner,
  stagenet: MidnightStagenetNotice,
};

const network = computed(() => walletStore.loggedWallet?.network ?? '');
const upgrading = useMidnightNetworkUpgrading(() => network.value);
const stagenet = computed(() => isMidnightStagenetWallet(walletStore.loggedWallet));

const shown = computed(() => visibleMidnightNotices({
  upgrade: upgrading.value,
  stagenet: stagenet.value,
}, MAX_NOTICES));

function noticeProps(_id: MidnightNoticeId): Record<string, unknown> {
  return {};
}
</script>

<style scoped lang="scss">
.notice-slot {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
</style>
