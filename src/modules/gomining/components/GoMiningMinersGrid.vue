<template>
  <!-- Shared glass-panel material; only layout lives here. -->
  <section class="glass-panel gm-miners" :aria-label="$t('gomining.myMiners')">
    <div class="gm-miners__head">
      <span class="gm-miners__icon"><v-icon size="18">mdi-pickaxe</v-icon></span>
      <span class="t-body-lg">{{ $t('gomining.myMiners') }}</span>
      <span v-if="miners.length" class="t-caption g-num gm-miners__count">{{ miners.length }}</span>
      <GButton tier="tertiary" compact class="gm-miners__more" @click="$emit('buy-more')">
        <v-icon size="small" start>mdi-plus</v-icon>
        {{ $t('gomining.buyMore') }}
      </GButton>
    </div>

    <!-- Empty -->
    <div v-if="!loading && miners.length === 0" class="gm-miners__empty">
      <v-icon size="40" class="gm-miners__empty-icon">mdi-pickaxe</v-icon>
      <span class="t-body-lg">{{ $t('gomining.noMinersYet') }}</span>
      <span class="t-caption">{{ $t('gomining.noMinersDescription') }}</span>
      <GButton tier="primary" class="gm-miners__cta" @click="$emit('buy-more')">
        <v-icon size="small" start>mdi-cart-plus</v-icon>
        {{ $t('gomining.browseMinerShop') }}
      </GButton>
    </div>

    <!-- Loading -->
    <div v-else-if="loading" class="gm-miners__grid" aria-busy="true">
      <v-skeleton-loader v-for="i in 3" :key="i" type="card" class="gm-miners__skeleton" />
    </div>

    <!-- Miners -->
    <ul v-else class="gm-miners__grid">
      <li v-for="miner in miners" :key="miner.id" class="glass-tier gm-miner">
        <v-img :src="miner.imageUrl || defaultMinerImage" height="120" class="gm-miner__image" alt="">
          <template #placeholder>
            <div class="gm-miner__placeholder"><v-icon size="40">mdi-pickaxe</v-icon></div>
          </template>
        </v-img>

        <span class="t-body-sm gm-miner__name">{{ miner.name }}</span>

        <dl class="gm-miner__facts">
          <div class="t-body-sm gm-miner__row">
            <dt>{{ $t('gomining.hashrate') }}</dt>
            <dd class="g-num gm-miner__value">{{ $t('gomining.hashrateValue', { value: miner.hashrate }) }}</dd>
          </div>
          <div class="t-body-sm gm-miner__row">
            <dt>{{ $t('gomining.dailyIncome') }}</dt>
            <dd class="g-num gm-miner__value gm-miner__value--in">+{{ formatBtcFromBtc(miner.dailyIncomeBtc) }} BTC</dd>
          </div>
        </dl>

        <span :class="['t-caption', 'gm-miner__status', `gm-miner__status--${miner.status === 'active' ? 'active' : 'inactive'}`]">
          <span class="gm-miner__dot" aria-hidden="true"></span>
          {{ miner.status === 'active' ? $t('gomining.active') : $t('gomining.inactive') }}
        </span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import type { GoMiningNft } from '@/api/gomining-api';
import { formatBtcFromBtc } from '@/shared/utils/format';
import GButton from '@/shared/components/GButton/GButton.vue';

defineProps<{
  miners: GoMiningNft[];
  loading?: boolean;
}>();

defineEmits<{ 'buy-more': [] }>();

const defaultMinerImage = '';

</script>

<style scoped lang="scss">
.gm-miners {
  display: flex;
  flex-direction: column;
}

.gm-miners__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-4);
  border-bottom: 1px solid var(--g-hairline-1);
}

.gm-miners__icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
}

.gm-miners__icon .v-icon {
  color: var(--g-text-2);
}

.gm-miners__head .gm-miners__count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 20px;
  height: 18px;
  padding: 0 6px;
  border-radius: var(--g-r-pill);
  background: var(--g-hairline-2);
  color: var(--g-text-2);
  font-weight: 600;
}

.gm-miners__more {
  margin-left: auto;
}

.gm-miners__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-1);
  padding: var(--g-s-6) var(--g-s-4);
  text-align: center;
}

.gm-miners__empty-icon {
  margin-bottom: var(--g-s-2);
  color: var(--g-text-3);
}

.gm-miners__cta {
  margin-top: var(--g-s-3);
}

.gm-miners__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
  gap: var(--g-s-3);
  margin: 0;
  padding: var(--g-s-4);
  list-style: none;
}

.gm-miners__skeleton {
  border-radius: var(--g-r-card);
}

/* ── One miner ──────────────────────────────────────────── */
.gm-miner {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  min-width: 0;
  padding: var(--g-s-3);
}

.gm-miner__image {
  flex: 0 0 auto;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
}

.gm-miner__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--g-text-3);
}

.gm-miner__name {
  color: var(--g-text-1);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gm-miner__facts {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  margin: 0;
}

.gm-miner__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.gm-miner__row dt {
  color: var(--g-text-3);
}

.gm-miner__row dd {
  margin: 0;
  text-align: right;
}

.gm-miner__value {
  color: var(--g-text-1);
  font-weight: 500;
}

.gm-miner__value--in {
  color: var(--g-success);
}

.gm-miner__status {
  display: inline-flex;
  align-items: center;
  align-self: flex-start;
  gap: 6px;
  height: 22px;
  padding: 0 var(--g-s-2);
  border-radius: var(--g-r-pill);
  font-weight: 600;
  white-space: nowrap;
}

.gm-miner__status--active {
  background: var(--g-success-fill);
  color: var(--g-success);
}

.gm-miner__status--inactive {
  background: var(--g-hairline-1);
  color: var(--g-text-3);
}

.gm-miner__dot {
  width: 6px;
  height: 6px;
  border-radius: var(--g-r-pill);
  background: currentColor;
}
</style>
