<template>
  <div class="lp-card liquid-glass">
    <div class="card-header">
      <v-icon size="14" color="#2DF0F7" class="mr-1">mdi-chart-bar</v-icon>
      <span>{{ $t('poolOperator.livePerformance') }}</span>
    </div>

    <div class="lp-list">
      <div class="lp-item">
        <div class="lp-icon" style="background: rgba(45,240,247,0.1)">
          <v-icon size="14" color="#2DF0F7">mdi-chart-line</v-icon>
        </div>
        <div class="lp-body">
          <span class="lp-val">{{ formatAdaShort(liveStake) }}</span>
          <span class="lp-lbl">{{ $t('poolOperator.liveStake') }}</span>
        </div>
      </div>
      <div class="lp-item">
        <div class="lp-icon" style="background: rgba(160,120,255,0.1)">
          <v-icon size="14" color="#A078FF">mdi-account-group</v-icon>
        </div>
        <div class="lp-body">
          <span class="lp-val">{{ delegators?.toLocaleString() || '0' }}</span>
          <span class="lp-lbl">{{ $t('poolOperator.delegators') }}</span>
        </div>
      </div>
      <div class="lp-item">
        <div class="lp-icon" style="background: rgba(253,176,34,0.1)">
          <v-icon size="14" color="#FDB022">mdi-cube-outline</v-icon>
        </div>
        <div class="lp-body">
          <span class="lp-val">{{ blocks?.toLocaleString() || '0' }}</span>
          <span class="lp-lbl">{{ $t('poolOperator.blocksProduced') }}</span>
        </div>
      </div>
      <div class="lp-item">
        <div class="lp-icon" style="background: rgba(117,224,167,0.1)">
          <v-icon size="14" color="#75E0A7">mdi-trending-up</v-icon>
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
  font-size: 11px; font-weight: 600; color: rgba(255,255,255,0.5);
  text-transform: uppercase; letter-spacing: 0.5px;
  display: flex; align-items: center; margin-bottom: 12px;
}

.lp-list { display: flex; flex-direction: column; gap: 10px; }

.lp-item { display: flex; align-items: center; gap: 12px; }

.lp-icon {
  width: 32px; height: 32px; min-width: 32px; border-radius: 8px;
  display: flex; align-items: center; justify-content: center;
}

.lp-body { flex: 1; }

.lp-val {
  font-size: 18px; font-weight: 800; color: rgba(255,255,255,0.95);
  font-variant-numeric: tabular-nums; line-height: 1.2;
}

.lp-lbl {
  display: block; font-size: 11px; color: rgba(255,255,255,0.45);
  margin-top: 1px;
}
</style>
