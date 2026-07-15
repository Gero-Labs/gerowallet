<template>
  <!-- Backup reminder as a hero-row card (empty-mainnet mode). Same message
       and i18n keys as the BackupReminderStrip; amber-tinted glass panel so
       it reads urgent without shouting across the full page width. -->
  <div class="fill-height d-flex flex-column glass-panel backup-card">
    <div class="backup-card__head">
      <span class="backup-card__badge g-mono">!</span>
      <h3 class="backup-card__title">{{ $t('dashboard.backupStripTitle') }}</h3>
    </div>
    <p class="backup-card__body t-body-sm">{{ $t('dashboard.backupStripBody') }}</p>
    <GButton tier="secondary" compact block class="backup-card__cta" @click="$emit('backup')">
      {{ $t('dashboard.backupStripCta') }} →
    </GButton>
  </div>
</template>

<script setup lang="ts">
import GButton from '@/shared/components/GButton/GButton.vue';

defineEmits(['backup']);
</script>

<style scoped>
/* Surface from shared .glass-panel; the amber urgency wash layers above it,
   same overlay pattern as the perk-teaser hue washes. */
.backup-card {
  position: relative;
  padding: var(--g-s-4);
}

.backup-card::before {
  content: '';
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--g-warning) 14%, transparent),
    transparent 72%
  );
  pointer-events: none;
}

.backup-card > * {
  position: relative;
}

.backup-card__head {
  display: flex;
  align-items: center;
  gap: 10px;
}

.backup-card__badge {
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

.backup-card__title {
  font-size: 15px;
  font-weight: 600;
  color: var(--g-warning);
}

.backup-card__body {
  margin: 6px 0 0;
}

.backup-card__cta {
  /* GButton's sanctioned foreground seam — amber text, no cascade fight. */
  --g-btn-fg: var(--g-warning);
  margin-top: auto;
  /* Vuetify's .v-btn--block sets flex: 1 0 auto; as a direct child of this
     column flex card that grows the button to fill the card. Pin it. */
  flex: 0 0 auto;
}
</style>
