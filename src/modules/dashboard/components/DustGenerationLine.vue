<template>
  <div class="dust-line" :class="[`dust-line--${variant}`, `dust-line--${statusKey}`]">
    <!-- Charging-battery particle field from the Midnight DUST battery, reused
         as a thin horizontal strip. Absolute-positioned; the row content sits
         above it. -->
    <DustParticleCanvas class="dust-line-canvas" :active="animate" :fillPct="fillPct" />

    <div class="dust-line-body">
      <span class="dust-line-label">{{ label }}</span>

      <v-btn
        v-if="canSetUp"
        text
        x-small
        class="dust-line-cta"
        @click.stop="$emit('setup')"
      >
        {{ t('midnight.dustLineSetUp') }}
        <v-icon x-small right>mdi-chevron-right</v-icon>
      </v-btn>
    </div>

    <v-btn icon x-small class="dust-line-close" :title="t('common.remove')" @click.stop="$emit('dismiss')">
      <v-icon x-small>mdi-close</v-icon>
    </v-btn>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue';
import DustParticleCanvas from '@/shared/components/DustParticleCanvas.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useCnightDustRegistration } from '@/shared/composables/useCnightDustRegistration';

const props = withDefaults(defineProps<{
  /** 'row' = table sub-row (half height); 'drawer' = token detail panel section. */
  variant?: 'row' | 'drawer';
}>(), { variant: 'row' });

defineEmits<{
  (e: 'setup'): void;
  (e: 'dismiss'): void;
}>();

const { t } = useTranslation();
const { registrationStatus, refreshStatus } = useCnightDustRegistration();

// Fetch the real status (and reconcile the local pending guard) on mount so the
// line reflects Pending/Generating, not just the initial Unknown.
onMounted(() => { refreshStatus(); });

const canSetUp = computed(() =>
  registrationStatus.value === 'Unregistered' || registrationStatus.value === 'Unknown');

const statusKey = computed(() => {
  switch (registrationStatus.value) {
    case 'Registered': return 'registered';
    case 'Pending': return 'pending';
    default: return 'unregistered';
  }
});

// The particle field always animates. The fill boundary sets the character:
// when GENERATING (registered), a near-full fill makes the "power" streaks
// dominate the strip (the DUST battery's charged look); Pending sits mid; and
// unregistered shows a low fill so dust drifts across a mostly-empty band,
// inviting setup.
const fillPct = computed(() => {
  switch (registrationStatus.value) {
    case 'Registered': return 88;
    case 'Pending': return 45;
    default: return 12;
  }
});
const animate = computed(() => true);

const label = computed(() => {
  switch (registrationStatus.value) {
    case 'Registered': return t('midnight.dustLineGenerating');
    case 'Pending': return t('midnight.dustLinePending');
    default: return t('midnight.dustLinePromo');
  }
});

void props;
</script>

<style scoped>
.dust-line {
  position: relative;
  display: flex;
  align-items: center;
  overflow: hidden;
}

/* Table sub-row: half-height continuation of the NIGHT row above it. No top
   border (so it reads as attached to NIGHT, not a separate row); the content
   is indented to sit under the token-name column, and the gold tint fades in
   from that indent. A neutral divider below matches the table's row lines so
   SNEK still separates cleanly. */
.dust-line--row {
  height: 100%;
  min-height: 24px;
  /* No right padding: the close button gets a 36px box flush to the edge, the
     same span as the table's rightmost watchlist (star) column, so the X lands
     centered under the stars. */
  padding: 0 0 0 68px;
  background:
    linear-gradient(90deg,
      rgba(232, 199, 137, 0.13) 0%,
      rgba(232, 199, 137, 0.05) 55%,
      rgba(232, 199, 137, 0.015) 100%);
  border-bottom: 1px solid var(--g-hairline-1);
}

/* Drawer: a bit taller, full-width card band inside the panel. */
.dust-line--drawer {
  height: 40px;
  padding: 0 14px;
  background:
    linear-gradient(90deg,
      rgba(232, 199, 137, 0.10) 0%,
      rgba(232, 199, 137, 0.05) 45%,
      rgba(232, 199, 137, 0.02) 100%);
  border-top: 1px solid rgba(232, 199, 137, 0.18);
  border-bottom: 1px solid rgba(232, 199, 137, 0.18);
  border-radius: var(--g-r-control);
  border: 1px solid rgba(232, 199, 137, 0.22);
}

.dust-line-canvas {
  z-index: 0;
}

.dust-line-body {
  position: relative;
  z-index: 1;
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1 1 auto;
}

.dust-line-label {
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  color: rgb(245, 224, 178);
  white-space: nowrap;
}

.dust-line--drawer .dust-line-label {
  font-size: 12px;
}

.dust-line-cta {
  margin-left: 6px;
  font-size: 11px;
  font-weight: 700;
  color: rgb(255, 236, 190);
}

.dust-line-close {
  position: relative;
  z-index: 1;
  flex-shrink: 0;
  color: var(--g-text-3);
}

/* Row variant: align the X with the watchlist (star) column. The star btn sits
   ~18px from the table's right edge; the strip has no right padding, so nudge
   the X left by that much so its center lands on the star column. */
.dust-line--row .dust-line-close {
  margin-right: 6px;
}

/* Registered/pending read calmer; unregistered nudges with a warmer label. */
.dust-line--unregistered .dust-line-label { color: rgb(255, 236, 190); }
</style>
