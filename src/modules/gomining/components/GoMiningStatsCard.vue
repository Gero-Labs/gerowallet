<template>
  <!-- Shared glass-panel material; only layout lives here. -->
  <section class="glass-panel gm-stats" :aria-label="$t('gomining.miningOverview')">
    <div class="gm-stats__head">
      <span class="gm-stats__icon"><v-icon size="18">mdi-pickaxe</v-icon></span>
      <div class="gm-stats__titles">
        <span class="t-body-lg">{{ $t('gomining.miningOverview') }}</span>
        <span class="t-caption">{{ $t('gomining.poweredByGoMining') }}</span>
      </div>
      <v-btn
        icon
        variant="text"
        size="small"
        class="gm-stats__refresh"
        :loading="loading"
        :disabled="loading"
        :aria-label="$t('common.refresh')"
        :title="$t('common.refresh')"
        @click="$emit('refresh')"
      >
        <v-icon size="small">mdi-refresh</v-icon>
      </v-btn>
    </div>

    <div class="gm-stats__grid">
      <div class="glass-tier gm-stats__tile">
        <span class="t-label">{{ $t('gomining.totalHashrate') }}</span>
        <span class="t-heading g-num">{{ stats ? formatHashrate(stats.totalHashrate) : '—' }}</span>
      </div>

      <div class="glass-tier gm-stats__tile">
        <span class="t-label">{{ $t('gomining.activeMiners') }}</span>
        <span class="t-heading g-num">
          <span class="gm-stats__ok">{{ stats ? stats.activeMiners : '—' }}</span>
          <span v-if="stats" class="t-caption g-num">/ {{ stats.totalMiners }}</span>
        </span>
      </div>

      <div class="glass-tier gm-stats__tile">
        <span class="t-label">{{ $t('gomining.dailyEarnings') }}</span>
        <span class="t-heading g-num gm-stats__ok">{{ stats ? btcAmountLabel(stats.dailyIncomeBtc) : '—' }}</span>
      </div>

      <div class="glass-tier gm-stats__tile">
        <span class="t-label">{{ $t('gomining.totalEarned') }}</span>
        <span class="t-heading g-num">{{ stats ? btcAmountLabel(stats.totalEarnedBtc) : '—' }}</span>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import type { GoMiningUserStats } from '@/api/gomining-api';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatBtcFromBtc } from '@/shared/utils/format';

defineProps<{
  stats: GoMiningUserStats | null;
  loading?: boolean;
}>();

defineEmits<{ refresh: [] }>();

const { t } = useTranslation();

function formatHashrate(ths: number): string {
  if (ths >= 1000) return t('gomining.hashratePetaValue', { value: (ths / 1000).toFixed(2) });
  return t('gomining.hashrateValue', { value: ths.toFixed(2) });
}

/** GoMining reports BTC, not sats. */
function btcAmountLabel(btc: number): string {
  return `${formatBtcFromBtc(btc || 0)} BTC`;
}
</script>

<style scoped lang="scss">
.gm-stats {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
  padding: var(--g-s-4);
}

.gm-stats__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
}

.gm-stats__icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
}

.gm-stats__icon .v-icon {
  color: var(--g-text-2);
}

.gm-stats__titles {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.gm-stats__refresh {
  margin-left: auto;
}

.gm-stats__grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--g-s-3);
}

@media (max-width: 720px) {
  .gm-stats__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.gm-stats__tile {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
  padding: var(--g-s-3) var(--g-s-4);
}

.gm-stats__tile .t-heading {
  display: flex;
  align-items: baseline;
  gap: var(--g-s-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gm-stats__ok {
  color: var(--g-success);
}
</style>
