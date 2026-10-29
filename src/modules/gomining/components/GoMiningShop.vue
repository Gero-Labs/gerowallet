<template>
  <!-- Shared glass-panel material; only layout lives here. -->
  <section class="glass-panel gm-shop" :aria-label="$t('gomining.minerShop')">
    <div class="gm-shop__head">
      <span class="gm-shop__icon"><v-icon size="18">mdi-store-outline</v-icon></span>
      <span class="t-body-lg">{{ $t('gomining.minerShop') }}</span>
      <span class="t-caption gm-shop__powered">{{ $t('gomining.poweredByGoMining') }}</span>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="gm-shop__grid" aria-busy="true">
      <v-skeleton-loader v-for="i in 4" :key="i" type="card" class="gm-shop__skeleton" />
    </div>

    <!-- Empty -->
    <div v-else-if="collections.length === 0" class="gm-shop__empty">
      <v-icon size="40" class="gm-shop__empty-icon">mdi-store-off</v-icon>
      <span class="t-body-lg">{{ $t('gomining.noCollectionsAvailable') }}</span>
    </div>

    <!-- Collections -->
    <template v-else>
      <ul class="gm-shop__grid">
        <li v-for="collection in collections" :key="collection.id" class="glass-tier gm-shop__item">
          <div class="gm-shop__art" aria-hidden="true"><v-icon size="40">mdi-pickaxe</v-icon></div>
          <span class="t-body-sm gm-shop__name">{{ $t('gomining.minerTitle', { value: collection.powerTh }) }}</span>
          <dl class="gm-shop__facts">
            <div class="t-body-sm gm-shop__row">
              <dt>{{ $t('gomining.efficiency') }}</dt>
              <dd class="g-num gm-shop__value">{{ $t('gomining.energyEfficiencyValue', { value: collection.energyEfficiency }) }}</dd>
            </div>
            <div class="t-body-sm gm-shop__row">
              <dt>{{ $t('gomining.projectedReturn') }}</dt>
              <dd class="g-num gm-shop__value">{{ $t('gomining.percentValue', { value: collection.annualRoiPercent.toFixed(1) }) }}</dd>
            </div>
            <div v-if="collection.discountPercent > 0" class="t-body-sm gm-shop__row">
              <dt>{{ $t('gomining.discount') }}</dt>
              <dd class="g-num gm-shop__value gm-shop__value--discount">{{ $t('gomining.percentValue', { value: collection.discountPercent.toFixed(1) }) }}</dd>
            </div>
          </dl>
          <div class="gm-shop__foot">
            <div class="gm-shop__price">
              <span class="t-label">{{ $t('gomining.price') }}</span>
              <span class="t-body-lg g-num gm-shop__price-value">{{ formatUsd(collection.priceUsd) }}</span>
            </div>
            <GButton tier="secondary" compact :disabled="!ordersEnabled" @click="$emit('buy', collection)">
              <v-icon size="small" start>mdi-cart-plus</v-icon>
              {{ $t('gomining.buy') }}
            </GButton>
          </div>
        </li>
      </ul>
      <p class="t-caption gm-shop__note">
        <template v-if="!ordersEnabled">{{ $t('gomining.purchasesSoon') }}</template>
        {{ $t('gomining.projectionNote') }}
      </p>
    </template>
  </section>
</template>

<script setup lang="ts">
import type { GoMiningCollection } from '@/api/gomining-api';
import { formatUsd } from '@/shared/utils/format';
import GButton from '@/shared/components/GButton/GButton.vue';

defineProps<{
  collections: GoMiningCollection[];
  /** Off until gero-backend confirms orders with GoMining. */
  ordersEnabled: boolean;
  loading?: boolean;
}>();

defineEmits<{ buy: [collection: GoMiningCollection] }>();
</script>

<style scoped lang="scss">
.gm-shop {
  display: flex;
  flex-direction: column;
}

.gm-shop__head {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-4);
  border-bottom: 1px solid var(--g-hairline-1);
}

.gm-shop__icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
}

.gm-shop__icon .v-icon {
  color: var(--g-text-2);
}

.gm-shop__powered {
  margin-left: auto;
}

.gm-shop__empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-1);
  padding: var(--g-s-6) var(--g-s-4);
  text-align: center;
}

.gm-shop__empty-icon {
  margin-bottom: var(--g-s-2);
  color: var(--g-text-3);
}

.gm-shop__grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: var(--g-s-3);
  margin: 0;
  padding: var(--g-s-4);
  list-style: none;
}

.gm-shop__skeleton {
  border-radius: var(--g-r-card);
}

/* ── One collection ─────────────────────────────────────── */
.gm-shop__item {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  min-width: 0;
  padding: var(--g-s-3);
}

.gm-shop__image {
  flex: 0 0 auto;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
}

.gm-shop__placeholder {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--g-text-3);
}

.gm-shop__name {
  color: var(--g-text-1);
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.gm-shop__facts {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  margin: 0;
}

.gm-shop__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.gm-shop__row dt {
  color: var(--g-text-3);
}

.gm-shop__row dd {
  margin: 0;
  text-align: right;
}

.gm-shop__value {
  color: var(--g-text-1);
  font-weight: 500;
}

.gm-shop__foot {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: var(--g-s-2);
  margin-top: auto;
  padding-top: var(--g-s-2);
  border-top: 1px solid var(--g-hairline-1);
}

.gm-shop__price {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.gm-shop__price-value {
  font-weight: 600;
}
</style>
