<template>
  <div v-if="loading || failed || stale" class="help-content-status">
    <p v-if="loading" class="t-body-sm" role="status">{{ t('help.loadingContent') }}</p>
    <p v-else-if="failed" class="t-body-sm" role="status">{{ t(hasRemote ? 'help.staleContent' : 'help.basicFallback') }} <button type="button" class="status-retry" @click="$emit('retry')">{{ t('help.retryContent') }}</button></p>
    <p v-else class="t-body-sm" role="status">{{ t('help.staleContent') }}</p>
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';

defineProps<{ loading: boolean; failed: boolean; stale: boolean; hasRemote: boolean }>();
defineEmits<{ (e: 'retry'): void }>();
const { t } = useTranslation();
</script>

<style scoped>
.help-content-status p { margin: 0; }
.status-retry { color: var(--g-accent); text-decoration: underline; text-underline-offset: 2px; }
</style>
