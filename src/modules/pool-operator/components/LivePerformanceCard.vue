<template>
  <div class="lp-card liquid-glass">
    <div class="card-header t-label">
      <v-icon size="14" color="var(--g-accent)" class="mr-1">mdi-chart-bar</v-icon>
      <span>{{ $t('poolOperator.livePerformance') }}</span>
    </div>

    <div class="lp-list">
      <div class="lp-item">
        <div class="lp-icon" style="background: color-mix(in srgb, var(--g-accent) 10%, transparent)">
          <v-icon size="14" color="var(--g-accent)">mdi-chart-line</v-icon>
        </div>
        <div class="lp-body">
          <span class="lp-val">{{ formatAdaShort(liveStake) }}</span>
          <span class="lp-lbl">{{ $t('poolOperator.liveStake') }}</span>
        </div>
      </div>
      <div class="lp-item">
        <div class="lp-icon" style="background: color-mix(in srgb, var(--g-info) 10%, transparent)">
          <v-icon size="14" color="var(--g-info)">mdi-account-group</v-icon>
        </div>
        <div class="lp-body">
          <span class="lp-val">{{ delegators?.toLocaleString() || '0' }}</span>
          <span class="lp-lbl">{{ $t('poolOperator.delegators') }}</span>
        </div>
      </div>
      <div class="lp-item">
        <div class="lp-icon" style="background: var(--g-warning-fill)">
          <v-icon size="14" color="warning">mdi-cube-outline</v-icon>
        </div>
        <div class="lp-body">
          <span class="lp-val">{{ blocks?.toLocaleString() || '0' }}</span>
          <span class="lp-lbl">{{ $t('poolOperator.blocksProduced') }}</span>
        </div>
      </div>
      <div class="lp-item">
        <div class="lp-icon" style="background: var(--g-success-fill)">
          <v-icon size="14" color="success">mdi-trending-up</v-icon>
        </div>
        <div class="lp-body">
          <span class="lp-val">{{ ros }}%</span>
          <span class="lp-lbl">{{ $t('poolOperator.ros') }}</span>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  liveStake: any;
  delegators: number;
  blocks: number;
  ros: string;
}>();

function formatAdaShort(lovelace: any): string {
  if (!lovelace) return '0';
  const ada = Number(lovelace) / 1_000_000;
  if (ada >= 1_000_000) return (ada / 1_000_000).toFixed(2) + 'M';
  if (ada >= 1_000) return (ada / 1_000).toFixed(0) + 'K';
  return ada.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
</script>

<style scoped>
.lp-card { padding: 14px; }

.card-header {
  color: var(--g-text-3);
  display: flex; align-items: center; margin-bottom: 12px;
}

.lp-list { display: flex; flex-direction: column; gap: 10px; }

.lp-item { display: flex; align-items: center; gap: 12px; }

.lp-icon {
  width: 32px; height: 32px; min-width: 32px; border-radius: var(--g-r-control);
  display: flex; align-items: center; justify-content: center;
}

.lp-body { flex: 1; }

.lp-val {
  font-size: 16px; font-weight: 800; color: var(--g-text-1);
  font-variant-numeric: tabular-nums; line-height: 1.2;
}

.lp-lbl {
  display: block; font-size: 11px; color: var(--g-text-3);
  margin-top: 1px;
}
</style>
