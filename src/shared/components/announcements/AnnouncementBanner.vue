<template>
  <div v-if="item && text" class="announce-banner" role="alert">
    <v-icon size="20" color="var(--g-error)" class="announce-banner__icon">mdi-alert-octagon-outline</v-icon>
    <span class="announce-banner__text">
      <span class="announce-banner__title">{{ text.title }}</span>
      <span class="announce-banner__body">{{ text.summary }}</span>
    </span>
    <GButton tier="tertiary" compact @click="details()">{{ $t('common.details') }}</GButton>
    <button type="button" class="announce-banner__dismiss" :aria-label="$t('announce.banner.dismiss')" @click="dismiss()">
      <v-icon size="16" color="var(--g-text-2)">mdi-close</v-icon>
    </button>
  </div>
</template>

<script setup lang="ts">
// The dashboard banner, after the "Dashboard" artboard: only for a critical service notice, and one
// at most (announcementsStore.banner picks the newest that was not dismissed). Dismissing hides the
// banner for this announcement; the notice itself stays under the bell until it ends.
import { computed } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { announcementsStore } from '@/stores/announcementsStore';

announcementsStore.init();
const item = computed(() => announcementsStore.banner());
const text = computed(() => (item.value ? announcementsStore.text(item.value) : null));

function details(): void { if (item.value) announcementsStore.open(item.value.document.id); }
function dismiss(): void { if (item.value) void announcementsStore.dismissBanner(item.value.document.id); }
</script>

<style scoped lang="scss">
/* The muted error pair, as the app's other banners use: a tint, not a surface of its own. */
.announce-banner {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  margin: var(--g-s-2);
  padding: 10px var(--g-s-4);
  border-radius: var(--g-r-card);
  background: var(--g-error-fill);
  border: 1px solid var(--g-error-line);
  color: var(--g-text-1);
}
.announce-banner__icon { flex-shrink: 0; }
.announce-banner__text { flex: 1 1 auto; min-width: 0; font-size: 14px; overflow-wrap: anywhere; }
.announce-banner__title { font-weight: 600; margin-right: 6px; }
.announce-banner__body { color: var(--g-text-2); }
.announce-banner__dismiss {
  width: 32px;
  height: 32px;
  flex-shrink: 0;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--g-r-control);
  background: none;
  cursor: pointer;
  &:hover { background: var(--g-hairline-1); }
}
</style>
