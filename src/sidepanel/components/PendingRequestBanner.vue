<template>
  <div v-if="pendingCount > 0" class="pending-request-banner" role="status">
    <v-icon size="16" class="mr-2" color="#33C7DD">mdi-connection</v-icon>
    <span class="banner-text">
      {{ domain
        ? $t('miniGero.pendingRequestBanner', { domain })
        : $t('miniGero.pendingRequestBannerNoDomain') }}
    </span>
    <span v-if="pendingCount > 1" class="banner-count">
      {{ $tc('miniGero.pendingRequestCount', pendingCount, { count: pendingCount }) }}
    </span>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { hub } from '../services/dappRequestHub';

const pendingCount = computed(
  () => (hub.currentRequest.value ? 1 : 0) + hub.requestQueue.value.length
);

const domain = computed(() => {
  const payload = hub.currentRequest.value?.payload as { website?: string } | undefined;
  const website = payload?.website;
  if (!website) return '';
  try {
    return new URL(website).hostname;
  } catch {
    return String(website);
  }
});
</script>

<style scoped>
.pending-request-banner {
  display: flex;
  align-items: center;
  gap: 4px;
  margin: 12px 16px 0;
  padding: 10px 14px;
  border-radius: 8px;
  background: #12151b;
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 13px;
  color: #b8bcc4;
}
.banner-text { flex: 1; }
.banner-count { color: #7a8088; font-size: 12px; }
</style>
