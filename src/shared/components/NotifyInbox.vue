<template>
  <v-card outlined class="notifications-card notify-inbox" role="dialog" :aria-label="$t('navigation.notifications')">
    <!-- Header: title, "N new" pill, mark-all -->
    <div class="notify-inbox__head">
      <div class="notify-inbox__title">
        <span class="notify-inbox__heading">{{ $t('navigation.notifications') }}</span>
        <span v-if="unread" class="notify-inbox__pill g-mono">{{ $t('notify.inbox.new', { n: unread }) }}</span>
      </div>
      <button v-if="unread" type="button" class="notify-inbox__link" @click="markAllRead()">{{ $t('notify.inbox.markAllRead') }}</button>
      <button v-else-if="items.length" type="button" class="notify-inbox__link" @click="clearAll()">{{ $t('notify.inbox.clear') }}</button>
    </div>

    <div class="notify-inbox__list">
      <!-- Needs you: sticky security items and the SPO key warning -->
      <template v-if="needsYou.length || kesVisible">
        <div class="t-label notify-inbox__section">{{ $t('notify.inbox.needsYou') }}</div>
        <button v-if="kesVisible" type="button" class="notify-inbox__row" @click="$emit('kes')">
          <span class="notify-inbox__tile notify-inbox__tile--warn"><v-icon size="15" color="var(--g-warning)">mdi-key-chain</v-icon></span>
          <span class="notify-inbox__text">
            <span class="notify-inbox__row-title" style="color: var(--g-warning)">{{ $t('poolOperator.kesWarningTitle', { remaining: kesRemaining }) }}</span>
            <span class="notify-inbox__row-body">{{ $t('poolOperator.kesWarningSubtitle') }}</span>
          </span>
          <span class="notify-inbox__meta"><span class="notify-inbox__dot notify-inbox__dot--warn" aria-hidden="true"></span></span>
        </button>
        <button v-for="item in needsYou" :key="item.e" type="button" class="notify-inbox__row" :class="{ 'notify-inbox__row--read': item.readAt !== null }" @click="open(item)">
          <span class="notify-inbox__tile"><v-icon size="15" color="var(--g-text-1)">{{ iconFor(item) }}</v-icon></span>
          <span class="notify-inbox__text">
            <span class="notify-inbox__row-title">{{ item.title }}</span>
            <span class="notify-inbox__row-body">{{ item.body }}</span>
          </span>
          <span class="notify-inbox__meta">
            <span class="notify-inbox__time g-mono">{{ when(item.ts) }}</span>
            <span v-if="item.readAt === null" class="notify-inbox__dot" aria-hidden="true"></span>
          </span>
        </button>
      </template>

      <!-- Activity: everything else, newest first -->
      <template v-if="activity.length">
        <div class="t-label notify-inbox__section">{{ $t('notify.inbox.activity') }}</div>
        <button v-for="item in activity" :key="item.e" type="button" class="notify-inbox__row" :class="{ 'notify-inbox__row--read': item.readAt !== null }" @click="open(item)">
          <span class="notify-inbox__tile"><v-icon size="15" color="var(--g-text-1)">{{ iconFor(item) }}</v-icon></span>
          <span class="notify-inbox__text">
            <span class="notify-inbox__row-title">{{ item.title }}</span>
            <span class="notify-inbox__row-body">{{ item.body }}</span>
          </span>
          <span class="notify-inbox__meta">
            <span class="notify-inbox__time g-mono">{{ when(item.ts) }}</span>
            <span v-if="item.readAt === null" class="notify-inbox__dot" aria-hidden="true"></span>
          </span>
        </button>
      </template>

      <div v-if="!items.length && !kesVisible" class="notify-inbox__empty">
        <v-icon small color="var(--g-text-3)" class="mr-1">mdi-bell-check-outline</v-icon>
        {{ $t('navigation.nothingNew') }}
      </div>
    </div>

    <!-- Footer: where pushes go, and the way to the settings tab -->
    <div class="notify-inbox__foot">
      <span class="notify-inbox__status">
        <v-icon size="14" :color="pushOn ? 'var(--g-accent)' : 'var(--g-text-3)'">{{ pushOn ? 'mdi-bell-ring-outline' : 'mdi-bell-off-outline' }}</v-icon>
        {{ pushOn ? $t('notify.inbox.pushOn') : $t('notify.inbox.pushOff') }}
      </span>
      <button type="button" class="notify-inbox__link" @click="$emit('settings')">{{ $t('settings.settings') }}</button>
    </div>
  </v-card>
</template>

<script setup lang="ts">
// The bell's dropdown (B-M3), after the "In-wallet notifications" artboard of the GeroVault
// design board: header with the unread pill, "Needs you" and "Activity" sections, 28px icon
// tiles, mono timestamps, an accent dot per unread row, and a footer that says where pushes go.
// Rows come from notifyInboxStore (the worker's notifyInbox key); the SPO key warning keeps
// its place at the top as a "Needs you" row.
import { computed, getCurrentInstance, onMounted, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { notifyInboxStore, type NotifyInboxItem } from '@/stores/notifyInboxStore';
import { notifySettingsStore } from '@/stores/notifySettingsStore';
import { walletStore } from '@/stores/walletStore';
import { routeFor } from '@/services/notify/notifyRender';

const props = defineProps<{ open: boolean; kesVisible?: boolean; kesRemaining?: number | null }>();
const emit = defineEmits<{ (e: 'kes'): void; (e: 'settings'): void; (e: 'close'): void }>();
const { t } = useTranslation();
const router = getCurrentInstance()?.proxy?.$router;

const items = computed(() => notifyInboxStore.state.items);
const unread = computed(() => notifyInboxStore.unread());
const needsYou = computed(() => items.value.filter((i) => i.needsYou));
const activity = computed(() => items.value.filter((i) => !i.needsYou));
const pushOn = computed(() => !!notifySettingsStore.device()?.browserEnabled);

const ICONS: Record<string, string> = {
  funds: 'mdi-arrow-down-circle-outline', staking: 'mdi-chart-timeline-variant', swap: 'mdi-swap-horizontal',
  remoteSigning: 'mdi-cellphone-link', adam: 'mdi-robot-outline', governance: 'mdi-vote-outline', system: 'mdi-bell-outline',
};
function iconFor(item: NotifyInboxItem): string { return ICONS[item.c] ?? 'mdi-bell-outline'; }

/** 2m · 3h · 1d, then a short date, as on the artboard. */
function when(ts: number): string {
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60_000);
  if (m < 1) return t('notify.inbox.justNow');
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d`;
  return new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function markAllRead() { void notifyInboxStore.markRead(null); }
function clearAll() { void notifyInboxStore.clear(); }

/** Same routing as a notification click (B4): another wallet asks before switching. */
function open(item: NotifyInboxItem) {
  void notifyInboxStore.markRead(item.e);
  emit('close');
  const loggedId = (walletStore.loggedWallet as { id?: number } | null)?.id ?? null;
  if (item.walletId !== null && loggedId !== null && item.walletId !== loggedId) {
    void chrome.storage.local.set({ notifyPendingOpen: { walletId: item.walletId, d: item.d, ...(item.x ? { x: item.x } : {}), at: Date.now() } });
    return;
  }
  const route = routeFor(item.d, item.x as Parameters<typeof routeFor>[1], true);
  if (route.settingsTab) void chrome.storage.local.set({ openSettingsOnLoad: { tab: route.settingsTab } });
  if (router && router.currentRoute.fullPath !== route.dashboard) router.push(route.dashboard).catch(() => undefined);
}

onMounted(() => notifyInboxStore.init());
// Opening the menu refreshes the push status line (cheap: the worker's stored state, no /config).
watch(() => props.open, (isOpen) => { if (isOpen) void notifySettingsStore.refresh(false); }, { immediate: true });
</script>

<style scoped lang="scss">
.notify-inbox {
  width: 360px;
  max-height: 560px;
  display: flex;
  flex-direction: column;
}
.notify-inbox__head,
.notify-inbox__foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-2);
  padding: 12px 14px;
}
.notify-inbox__head { border-bottom: 1px solid var(--g-hairline-1); }
.notify-inbox__foot { border-top: 1px solid var(--g-hairline-1); padding-top: 10px; padding-bottom: 10px; }
.notify-inbox__title { display: flex; align-items: center; gap: var(--g-s-2); }
.notify-inbox__heading { font-size: 14px; font-weight: 600; color: var(--g-text-1); }
.notify-inbox__pill {
  display: inline-flex;
  align-items: center;
  height: 20px;
  padding: 0 8px;
  border-radius: var(--g-r-chip);
  /* The accent at 12% / 25%, like the semantic *-fill / *-line tints, without a second accent token. */
  background: color-mix(in srgb, var(--g-accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--g-accent) 25%, transparent);
  color: var(--g-accent);
  font-size: 11px;
  font-weight: 500;
  line-height: 1;
  white-space: nowrap;
  word-break: normal;
}
.notify-inbox__link {
  padding: 0 4px;
  border: 0;
  background: none;
  color: var(--g-accent);
  font: inherit;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  white-space: nowrap;
}
.notify-inbox__list { overflow-y: auto; flex: 1 1 auto; min-height: 0; }
.notify-inbox__section { padding: 8px 14px 4px; }
.notify-inbox__row {
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: 100%;
  padding: 10px 14px;
  border: 0;
  border-bottom: 1px solid var(--g-hairline-1);
  background: none;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--g-dur-fast);
  &:hover { background: var(--g-hairline-1); }
  &--read { opacity: 0.72; }
}
.notify-inbox__tile {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-2);
  &--warn { background: var(--g-warning-fill); border-color: var(--g-warning-line); }
}
.notify-inbox__text { display: flex; flex-direction: column; gap: 2px; flex: 1 1 auto; min-width: 0; }
.notify-inbox__row-title { font-size: 13px; font-weight: 500; color: var(--g-text-1); }
.notify-inbox__row-body { font-size: 12px; color: var(--g-text-3); }
.notify-inbox__meta { display: flex; flex-direction: column; align-items: flex-end; gap: 6px; flex-shrink: 0; }
.notify-inbox__time { font-size: 11px; color: var(--g-text-3); line-height: 1.2; word-break: normal; }
.notify-inbox__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--g-r-pill);
  background: var(--g-accent);
  &--warn { background: var(--g-warning); }
}
.notify-inbox__empty {
  padding: 16px;
  text-align: center;
  font-size: 13px;
  color: var(--g-text-3);
}
.notify-inbox__status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--g-text-3); }
</style>
