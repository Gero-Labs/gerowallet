<template>
  <div class="id-card liquid-glass">
    <div class="id-glow" />
    <div class="id-content">
      <v-avatar size="44" class="id-avatar" :class="{ 'id-avatar-placeholder': !poolIcon }">
        <v-img v-if="poolIcon" :src="poolIcon" />
        <v-icon v-else size="22" color="rgba(255,255,255,0.5)">mdi-shield-star-outline</v-icon>
      </v-avatar>
      <div class="id-info">
        <div class="id-name-row">
          <span v-if="ticker" class="id-ticker">[{{ ticker }}]</span>
          <span class="id-name">{{ name }}</span>
        </div>
        <div class="id-pool-id" @click="$emit('copy-id')">
          {{ truncatedId }} <v-icon x-small color="rgba(255,255,255,0.4)">mdi-content-copy</v-icon>
        </div>
      </div>
      <div class="id-actions">
        <div class="id-status" :class="statusClass">
          <span class="id-status-dot" />
          {{ statusText }}
        </div>
        <v-tooltip v-if="isRegistered" bottom>
          <template v-slot:activator="{ on }">
            <v-btn icon x-small class="id-action-btn id-update" v-on="on" @click="$emit('update')">
              <v-icon size="15" color="#2DF0F7">mdi-pencil-outline</v-icon>
            </v-btn>
          </template>
          <span>{{ $t('poolOperator.updatePool') }}</span>
        </v-tooltip>
        <v-tooltip v-if="isRegistered && !isRetiring" bottom>
          <template v-slot:activator="{ on }">
            <v-btn icon x-small class="id-action-btn id-retire" v-on="on" @click="$emit('retire')">
              <v-icon size="15" color="#FDA29B">mdi-power</v-icon>
            </v-btn>
          </template>
          <span>{{ $t('poolOperator.retirePool') }}</span>
        </v-tooltip>
      </div>
    </div>

    <!-- Description + Live Metrics (inline) -->
    <div class="id-bottom" v-if="description || liveStake">
      <div v-if="description" class="id-desc">{{ description }}</div>
      <div v-if="liveStake" class="id-metrics">
        <span class="id-metric"><v-icon x-small color="rgba(255,255,255,0.45)" class="mr-1">mdi-chart-line</v-icon><strong>{{ formatAdaShort(liveStake) }}</strong> {{ $t('poolOperator.liveStake') }}</span>
        <span class="id-metric"><v-icon x-small color="rgba(255,255,255,0.45)" class="mr-1">mdi-account-group</v-icon><strong>{{ delegators?.toLocaleString() }}</strong> {{ $t('poolOperator.delegators') }}</span>
        <span class="id-metric"><v-icon x-small color="rgba(255,255,255,0.45)" class="mr-1">mdi-cube-outline</v-icon><strong>{{ blocks?.toLocaleString() }}</strong> {{ $t('poolOperator.blocksProduced') }}</span>
        <span class="id-metric"><v-icon x-small color="rgba(255,255,255,0.45)" class="mr-1">mdi-trending-up</v-icon><strong>{{ ros }}%</strong> {{ $t('poolOperator.ros') }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  poolIcon?: string;
  ticker?: string;
  name: string;
  truncatedId: string;
  description?: string;
  statusClass: string;
  statusText: string;
  isRegistered: boolean;
  isRetiring: boolean;
  liveStake?: any;
  delegators?: number;
  blocks?: number;
  ros?: string;
}>();

defineEmits(['copy-id', 'update', 'retire']);

function formatAdaShort(lovelace: any): string {
  if (!lovelace) return '0';
  const ada = Number(lovelace) / 1_000_000;
  if (ada >= 1_000_000) return (ada / 1_000_000).toFixed(2) + 'M';
  if (ada >= 1_000) return (ada / 1_000).toFixed(0) + 'K';
  return ada.toLocaleString(undefined, { maximumFractionDigits: 0 });
}
</script>

<style scoped>
.id-card { position: relative; overflow: hidden; }

.id-glow {
  position: absolute; top: -30px; right: -30px; width: 120px; height: 120px;
  border-radius: 50%; background: radial-gradient(circle, rgba(45,240,247,0.07) 0%, transparent 70%);
  pointer-events: none;
}

.id-content {
  display: flex; align-items: flex-start; gap: 14px; padding: 14px; position: relative; z-index: 1;
}

.id-avatar { border: 2px solid rgba(255,255,255,0.1); background: rgba(255,255,255,0.04); flex-shrink: 0; }
.id-avatar-placeholder { border-style: dashed; }

.id-info { flex: 1; min-width: 0; }
.id-name-row { display: flex; align-items: baseline; gap: 6px; flex-wrap: wrap; }

.id-ticker {
  font-size: 18px; font-weight: 800;
  background: linear-gradient(135deg, #2DF0F7, #00ffd1);
  -webkit-background-clip: text; -webkit-text-fill-color: transparent; background-clip: text;
}

.id-name { font-size: 16px; font-weight: 600; color: rgba(255,255,255,0.9); }

.id-pool-id {
  font-family: 'Roboto Mono', monospace; font-size: 11px; color: rgba(255,255,255,0.45);
  cursor: pointer; transition: color 0.15s; margin-top: 2px;
}
.id-pool-id:hover { color: rgba(255,255,255,0.7); }

.id-actions { display: flex; align-items: center; gap: 5px; flex-shrink: 0; }

.id-status {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px;
  border-radius: 16px; font-size: 10px; font-weight: 600; white-space: nowrap;
}
.id-status-dot { width: 5px; height: 5px; border-radius: 50%; }

.status--active { background: rgba(117,224,167,0.12); color: #75E0A7; }
.status--active .id-status-dot { background: #75E0A7; box-shadow: 0 0 6px rgba(117,224,167,0.6); animation: pulse 2s ease-in-out infinite; }
.status--retiring { background: rgba(253,162,155,0.12); color: #FDA29B; }
.status--retiring .id-status-dot { background: #FDA29B; }
.status--inactive { background: rgba(255,255,255,0.06); color: rgba(255,255,255,0.5); }
.status--inactive .id-status-dot { background: rgba(255,255,255,0.3); }

@keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.3 } }

.id-action-btn { width: 26px !important; height: 26px !important; transition: all 0.15s; }
.id-update { background: rgba(45,240,247,0.08) !important; border: 1px solid rgba(45,240,247,0.15); }
.id-update:hover { background: rgba(45,240,247,0.15) !important; }
.id-retire { background: rgba(253,162,155,0.08) !important; border: 1px solid rgba(253,162,155,0.15); }
.id-retire:hover { background: rgba(253,162,155,0.15) !important; }

/* Bottom section: description + metrics */
.id-bottom {
  padding: 0 14px 12px;
  position: relative;
  z-index: 1;
}

.id-desc {
  font-size: 12px; color: white; line-height: 1.5;
}

.id-metrics {
  display: flex; gap: 16px; flex-wrap: wrap; margin-top: 8px;
  padding-top: 8px; border-top: 1px solid rgba(255,255,255,0.04);
}

.id-metric {
  display: flex; align-items: center; gap: 2px;
  font-size: 13px; color: rgba(255,255,255,0.5);
}

.id-metric strong {
  color: rgba(255,255,255,0.85); font-weight: 700; font-variant-numeric: tabular-nums; margin-right: 3px;
}
</style>
