<template>
  <section class="recovery-panel glass-panel" data-test="recovery-panel">
    <div class="recovery-panel__text">
      <h2 class="t-heading">{{ $t('gerovault.detail.recovery.title') }}</h2>
      <p class="t-body-sm">{{ $t('gerovault.detail.recovery.summary') }}</p>
      <p class="t-caption" data-test="recovery-panel-status">{{ $t(status.key, { date: status.date }) }}</p>
    </div>
    <GButton :tier="staleness.stale ? 'primary' : 'secondary'" :disabled="!canExport" data-test="recovery-panel-export" @click="open = true">
      {{ $t('gerovault.detail.recovery.export') }}
    </GButton>
    <p v-if="!canExport" class="t-caption recovery-panel__why">{{ $t('gerovault.detail.recovery.candidateNoExport') }}</p>
    <RecoveryExportDialog v-if="open" :is-open="open" :record="record" @close="open = false" @exported="refresh()" />
  </section>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import type { VaultRecord } from '@/modules/gerovault/contracts';
import RecoveryExportDialog from './RecoveryExportDialog.vue';
import { readRecoveryExport, recoveryExportStaleness } from './exportRecord';

defineOptions({ name: 'RecoveryPackagePanel' });

const props = defineProps<{ record: VaultRecord; walletId: number }>();

const open = ref(false);
const tick = ref(0);
/** Only an accepted vault is exported: a candidate's keys and labels are not yet the user's word. */
const canExport = computed(() => props.record.status === 'accepted');
const staleness = computed(() => {
  void tick.value;
  return recoveryExportStaleness(readRecoveryExport(props.walletId, props.record.vaultId), props.record);
});

/** The line under the title: when this device last exported, and whether the vault changed since. */
const status = computed<{ key: string; date: string }>(() => {
  const s = staleness.value;
  if (s.stale === false) return { key: 'gerovault.detail.recovery.exportedOn', date: formatDate(s.exportedAt) };
  if (s.reason === 'NEVER_EXPORTED') return { key: 'gerovault.detail.recovery.neverExported', date: '' };
  return { key: 'gerovault.detail.recovery.stale', date: formatDate(s.exportedAt) };
});

function refresh(): void {
  tick.value++;
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
function formatDate(ms: number): string {
  return dateFormatter.format(new Date(ms));
}
</script>

<style scoped>
.recovery-panel {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
  border-radius: var(--g-r-card);
}
.recovery-panel__text {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
  flex: 1 1 280px;
}
.recovery-panel__text h2,
.recovery-panel p {
  margin: 0;
}
.recovery-panel__why {
  flex-basis: 100%;
}
</style>
