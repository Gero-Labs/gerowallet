<template>
  <span class="announce-signed">
    <template v-if="tier === 'feed'">
      <v-icon :size="compact ? 14 : 16" color="var(--g-text-3)">mdi-newspaper-variant-outline</v-icon>
      {{ $t('announce.fromBlog') }}
    </template>
    <template v-else>
      <v-icon :size="compact ? 14 : 16" color="var(--g-success)">mdi-shield-check-outline</v-icon>
      {{ $t('announce.signed') }}
    </template>
  </span>
</template>

<script setup lang="ts">
// The provenance line under every announcement. It is true by construction: a page only ever
// renders what the worker verified against the keys pinned in this build.
//
// The two tiers do not get the same words. An editorial announcement was signed with a key that is
// never on a server, and says so. A headline was posted automatically from the blog and signed with
// the key gero-sync holds: it is verified too, but "Signed by Gero" is a promise it should not borrow.
import type { AnnouncementTier } from '@/services/announcements/announcementRules';

defineProps<{ tier: AnnouncementTier; compact?: boolean }>();
</script>

<style scoped lang="scss">
.announce-signed { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--g-text-2); }
</style>
