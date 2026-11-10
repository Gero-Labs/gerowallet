<template>
  <!-- One place for the Midnight notices above the balance (dashboard and side
       panel), so a cutover that sets off several never pushes the balance and
       Send off a 360px panel: at most MAX_NOTICES, by precedence (midnightNotices.ts).
       Renders nothing when none applies, so a parent's spacing class takes no room. -->
  <div v-if="shown.length" v-bind="$attrs" class="notice-slot" data-test="midnight-notice-slot">
    <component :is="NOTICE_COMPONENTS[id]" v-for="id in shown" :key="id" v-bind="noticeProps(id)" @send-again="emit('send-again')" />
  </div>
  <!-- Always mounted, so a notice that appears is announced: a region added
       together with its first message is often not read, so the notices carry
       none. Says each notice's sentence once when it appears (the refreshing
       one again when it stalls), never the percentage. -->
  <p class="g-sr-only" role="status" aria-live="polite" aria-atomic="true" data-test="midnight-notice-announcer">{{ announcer.message.value }}</p>
</template>

<script lang="ts">
// The spacing class goes on the notices, not on the always-mounted announcer.
export default { inheritAttrs: false };
</script>

<script setup lang="ts">
import { computed, onBeforeUnmount, watch, type Component } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { useMidnightNetworkUpgrading, useMidnightUpdateRequired } from '@/chains/midnight/midnightWriteGate';
import { MAX_NOTICES, MIDNIGHT_NOTICE_ORDER, visibleMidnightNotices, type MidnightNoticeId } from './midnightNotices';
import { isMidnightStagenetWallet } from './midnightStagenet';
import MidnightNetworkUpgradeBanner from './MidnightNetworkUpgradeBanner.vue';
import MidnightUpdateRequiredBanner from './MidnightUpdateRequiredBanner.vue';
import MidnightStagenetNotice from './MidnightStagenetNotice.vue';
import MidnightRefreshingNotice from './MidnightRefreshingNotice.vue';
import MidnightNotIncludedCard from './MidnightNotIncludedCard.vue';
import { midnightStore } from '@/stores/midnightStore';
import { notIncludedAfterReset } from '@/chains/midnight/midnightPendingSends';
import { useMidnightRefresh, useMidnightRefreshSentence } from '@/shared/composables/useMidnightRefresh';
import { usePoliteAnnouncer } from '@/shared/composables/usePoliteAnnouncer';
import { useTranslation } from '@/shared/composables/useTranslation';
import { midnightNetworkDisplayName } from '@/api/midnightApiError';

const props = withDefaults(defineProps<{
  /** `panel`: the side panel's narrow column. */
  layout?: 'page' | 'panel';
}>(), { layout: 'page' });

const NOTICE_COMPONENTS: Record<MidnightNoticeId, Component> = {
  update: MidnightUpdateRequiredBanner,
  upgrade: MidnightNetworkUpgradeBanner,
  refreshing: MidnightRefreshingNotice,
  notIncluded: MidnightNotIncludedCard,
  stagenet: MidnightStagenetNotice,
};

const network = computed(() => walletStore.loggedWallet?.network ?? '');
// One gate entry per network: update required and the upgrade never both hold.
const updateRequired = useMidnightUpdateRequired(() => network.value);
const upgrading = useMidnightNetworkUpgrading(() => network.value);
const stagenet = computed(() => isMidnightStagenetWallet(walletStore.loggedWallet));
const { refreshing } = useMidnightRefresh();
// Sends that didn't go through: only once the rebuild has ended and the lookup didn't find them.
const notIncluded = computed(() => !refreshing.value && notIncludedAfterReset(midnightStore.transactions ?? []).length > 0);

/** Send again on a send that didn't go through: the page opens its Send screen. */
const emit = defineEmits<{ (e: 'send-again'): void }>();

// Each notice said once as it appears, from the region that is always there.
// Notices that appear within a moment of each other (a cutover: the gate and the
// reset arrive separately) are said together, in slot order, so the second doesn't
// cut off the first.
const ANNOUNCE_GATHER_MS = 250;
const { t } = useTranslation();
const announcer = usePoliteAnnouncer();
let toSay: Array<{ id: MidnightNoticeId; text: string }> = [];
let sayTimer: ReturnType<typeof setTimeout> | null = null;
function say(id: MidnightNoticeId, text: string): void {
  toSay = [...toSay.filter((item) => item.id !== id), { id, text }];
  if (sayTimer) return;
  sayTimer = setTimeout(() => {
    sayTimer = null;
    const order = (id: MidnightNoticeId) => MIDNIGHT_NOTICE_ORDER.indexOf(id);
    announcer.announce([...toSay].sort((a, b) => order(a.id) - order(b.id)).map((item) => item.text).join(' '));
    toSay = [];
  }, ANNOUNCE_GATHER_MS);
}
onBeforeUnmount(() => {
  if (sayTimer) clearTimeout(sayTimer);
  sayTimer = null;
});
const refreshSentence = useMidnightRefreshSentence();
watch(updateRequired, (on) => { if (on) say('update', t('midnight.errors.updateRequired')); });
watch(upgrading, (on) => {
  if (on) say('upgrade', `${t('midnight.upgrade.title')}. ${t('midnight.errors.networkUpgrading', { network: midnightNetworkDisplayName(network.value) })}`);
});
watch(refreshSentence, (sentence) => { if (sentence) say('refreshing', sentence); });

const shown = computed(() => visibleMidnightNotices({
  update: updateRequired.value,
  upgrade: upgrading.value,
  refreshing: refreshing.value,
  notIncluded: notIncluded.value,
  stagenet: stagenet.value,
}, MAX_NOTICES));

function noticeProps(id: MidnightNoticeId): Record<string, unknown> {
  // The side panel stretches the update banner's restart button across it,
  // and its Send takes unshielded addresses only.
  if (id === 'update') return { block: props.layout === 'panel' };
  if (id === 'notIncluded') return { layout: props.layout };
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
