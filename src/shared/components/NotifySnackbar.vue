<template>
  <div class="notify-snack-host" aria-live="polite">
    <transition-group name="notify-snack" tag="div" class="notify-snack-stack">
      <div v-for="snack in items" :key="snack.id" class="notify-snack" role="status">
        <span v-if="snack.assets && snack.assets.length" class="notify-snack__tile">
          <NotifyAssetIcons :assets="snack.assets" :wallet-id="snack.walletId" />
        </span>
        <!-- A broadcast announcement: its kind's icon, toned by severity (the title says the rest). -->
        <span v-else-if="snack.announcementId" class="notify-snack__tile" :class="`notify-snack__tile--${tone(snack)}`">
          <v-icon size="15" :color="toneColor(tone(snack))">{{ icon(snack) }}</v-icon>
        </span>
        <div class="notify-snack__text">
          <span v-if="tone(snack) !== 'neutral'" class="d-sr-only">{{ severityWord(snack) }}</span>
          <span class="notify-snack__title">{{ snack.title }}</span>
          <span class="notify-snack__body" :class="{ 'notify-snack__body--clamp': !!snack.announcementId }">{{ snack.body }}</span>
          <button type="button" class="notify-snack__open" @click="open(snack)">
            {{ label(snack) }}
            <!-- A headline has no page in the wallet: its one action names the site it opens. -->
            <v-icon v-if="headlineHost(snack)" size="13" color="var(--g-accent)">mdi-open-in-new</v-icon>
          </button>
        </div>
        <button type="button" class="notify-snack__close" :aria-label="$t('common.close')" @click="dismiss(snack.id)">
          <v-icon size="16" color="var(--g-text-2)">mdi-close</v-icon>
        </button>
      </div>
    </transition-group>
  </div>
</template>

<script setup lang="ts">
// Top-right stack for pushes that arrive while this page is focused (B8). Same material as the
// app's other snackbars, its own host so the two never move each other. "Open" follows the
// push's route the way a notification click does. An announcement's "Read" opens the dialog (or the
// side panel's sheet) through announcementsStore; a blog headline opens its page on gerowallet.io.
import { computed, getCurrentInstance } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { notifySnackStore, type NotifySnack } from '@/stores/notifySnackStore';
import { announcementsStore, isHeadline } from '@/stores/announcementsStore';
import NotifyAssetIcons from '@/shared/components/NotifyAssetIcons.vue';
import { iconOf, openGeroUrl, toneColor, toneOf, type AnnouncementTone } from '@/shared/components/announcements/announcementView';
import { requestSettingsTabOnLoad } from '@/services/notify/notifyStorage';

const { t } = useTranslation();
const items = computed(() => notifySnackStore.state.items);
const router = getCurrentInstance()?.proxy?.$router;

function dismiss(id: number) { notifySnackStore.dismiss(id); }

const announcement = (snack: NotifySnack) => announcementsStore.byId(snack.announcementId ?? null);
function tone(snack: NotifySnack): AnnouncementTone { const item = announcement(snack); return item ? toneOf(item) : 'neutral'; }
function icon(snack: NotifySnack): string { const item = announcement(snack); return item ? iconOf(item) : 'mdi-bell-outline'; }
/** "Warning" or "Critical", for a screen reader: the tile's colour and shape say it to the eye. */
function severityWord(snack: NotifySnack): string { const item = announcement(snack); return item ? t(`announce.severity.${item.document.severity}`) : ''; }
/** The host a headline's action opens, or null when this snack is not a headline. */
function headlineHost(snack: NotifySnack): string | null {
  const item = announcement(snack);
  const url = item && isHeadline(item) ? announcementsStore.safeUrl(item) : null;
  try { return url ? new URL(url).host : null; } catch { return null; }
}
function label(snack: NotifySnack): string {
  if (!snack.announcementId) return t('notify.inbox.open');
  const host = headlineHost(snack);
  return host ? t('announce.action.readOn', { host }) : t('announce.action.read');
}

function open(snack: NotifySnack) {
  if (snack.announcementId) {
    const item = announcement(snack);
    if (item && isHeadline(item)) {
      void announcementsStore.markRead(item.document.id);
      openGeroUrl(announcementsStore.safeUrl(item));
    } else {
      announcementsStore.open(snack.announcementId);
    }
    dismiss(snack.id);
    return;
  }
  if (snack.settingsTab) void requestSettingsTabOnLoad({ tab: snack.settingsTab });
  if (router && router.currentRoute.value.fullPath !== snack.path) router.push(snack.path).catch(() => undefined);
  dismiss(snack.id);
}
</script>

<style scoped lang="scss">
.notify-snack-host {
  position: fixed;
  top: 16px;
  right: 16px;
  z-index: var(--g-z-toast);
  width: max-content;
  max-width: min(420px, calc(100vw - 32px));
  pointer-events: none;
}
.notify-snack-stack { display: flex; flex-direction: column; gap: var(--g-s-2); }
.notify-snack {
  // Popover material: solid enough to read over charts and tables (same call as the app's other snackbars).
  @include g-glass-overlay();
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-2);
  padding: 12px 16px;
  border: 1px solid var(--g-hairline-3);
  border-radius: var(--g-r-card);
  box-shadow: var(--g-shadow-menu);
  color: var(--g-text-1);
  font-size: 14px;
  pointer-events: auto;
}
.notify-snack__tile {
  width: 28px;
  height: 28px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-2);
  &--warning { background: var(--g-warning-fill); border-color: var(--g-warning-line); }
  &--error { background: var(--g-error-fill); border-color: var(--g-error-line); }
}
/* Grows, so the close button stays at the right edge when a shorter snack is stretched to the stack's width. */
.notify-snack__text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1 1 auto; }
.notify-snack__title { font-weight: 600; }
.notify-snack__body { color: var(--g-text-2); overflow-wrap: anywhere; }
/* An announcement's summary can run to 200 characters: two lines, the rest is in the dialog. */
.notify-snack__body--clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.notify-snack__open {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  align-self: flex-start;
  margin-top: 4px;
  padding: 0;
  border: 0;
  background: none;
  color: var(--g-accent);
  font: inherit;
  font-weight: 600;
  cursor: pointer;
}
.notify-snack__close {
  flex-shrink: 0;
  width: 24px;
  height: 24px;
  margin: -4px -6px 0 0;
  padding: 0;
  border: 0;
  border-radius: var(--g-r-control);
  background: none;
  cursor: pointer;
  &:hover { background: var(--g-hairline-1); }
}
.notify-snack-enter-active,
.notify-snack-leave-active { transition: opacity var(--g-dur-base), transform var(--g-dur-base); }
.notify-snack-enter-from,
.notify-snack-leave-to { opacity: 0; transform: translateY(-6px); }
</style>
