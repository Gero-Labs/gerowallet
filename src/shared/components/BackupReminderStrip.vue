<template>
  <!-- Emphasized ledger annotation: mono, amber, unmissable. Visibility is the
       parent's call (v-if on its shouldBackup state) so there is exactly one
       gate per surface. -->
  <button type="button" class="backup-strip g-mono" @click="$emit('backup')">
    <span class="backup-strip__badge">!</span>
    <span class="backup-strip__text">
      <span class="backup-strip__title">{{ $t('dashboard.backupStripTitle') }}</span>
      <span class="backup-strip__body"> · {{ $t('dashboard.backupStripBody') }}</span>
    </span>
    <span class="backup-strip__cta">{{ $t('dashboard.backupStripCta') }} →</span>
  </button>
</template>

<script setup lang="ts">
defineEmits(['backup']);
</script>

<style scoped>
.backup-strip {
  appearance: none;
  font-family: var(--g-font-mono);
  width: 100%;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 13px 16px;
  border-radius: var(--g-r-control);
  background: color-mix(in srgb, var(--g-warning) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--g-warning) 40%, transparent);
  font-size: 13px;
  color: var(--g-warning);
  letter-spacing: 0.01em;
  text-align: left;
  cursor: pointer;
  transition: border-color var(--g-dur-fast) var(--g-ease), background var(--g-dur-fast) var(--g-ease);
}

.backup-strip:hover {
  border-color: color-mix(in srgb, var(--g-warning) 65%, transparent);
  background: color-mix(in srgb, var(--g-warning) 14%, transparent);
}

.backup-strip__badge {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--g-warning);
  color: var(--g-canvas);
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 700;
  font-size: 13px;
  flex-shrink: 0;
}

.backup-strip__text { flex: 1; min-width: 0; }

.backup-strip__title {
  text-transform: uppercase;
  font-weight: 700;
}

.backup-strip__body { color: var(--g-text-2); }

.backup-strip__cta {
  white-space: nowrap;
  font-weight: 700;
  text-transform: uppercase;
}
</style>
