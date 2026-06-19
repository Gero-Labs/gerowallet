<template>
  <div class="ecosystem-widget">
    <div class="eco-body">
      <!-- Header -->
      <div class="eco-header">
        <div class="eco-header-left">
          <div class="eco-icon">
            <svg viewBox="0 0 20 20" fill="none" width="14" height="14">
              <circle cx="10" cy="10" r="8" stroke="#F7931A" stroke-width="1.5" />
              <path d="M7 10l2 2 4-4" stroke="#F7931A" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
          </div>
          <div>
            <span class="eco-title">Bitcoin Ecosystem</span>
          </div>
        </div>
        <span class="eco-count">{{ ecosystemItems.length }} MODULES</span>
      </div>

      <!-- Items grid -->
      <div class="eco-items">
        <router-link
          v-for="item in ecosystemItems"
          :key="item.route"
          :to="item.route"
          class="eco-item"
          :style="{ '--item-color': item.color }"
        >
          <div class="item-accent-bar" />
          <div class="item-icon-wrap">
            <img v-if="item.img" :src="item.img" width="16" height="16" :alt="item.name" />
            <v-icon v-else :color="item.color" size="16">{{ item.icon }}</v-icon>
          </div>
          <div class="item-text">
            <span class="item-name">{{ item.name }}</span>
            <span class="item-desc">{{ item.desc }}</span>
          </div>
          <div class="item-arrow">
            <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" width="8" height="8">
              <path d="M2 5h6M5 2l3 3-3 3"/>
            </svg>
          </div>
        </router-link>
      </div>
    </div>

  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import ordinalsLogo from '@/assets/svg/ordinals.svg';

const { t } = useTranslation();

const ecosystemItems = [
  {
    route: '/ordinals',
    icon: null,
    img: ordinalsLogo,
    name: 'ORDINALS',
    desc: t('ordinals.subtitle'),
    color: '#F7931A',
  },
  {
    route: '/lightning',
    icon: 'mdi-lightning-bolt',
    name: 'LIGHTNING',
    desc: t('lightning.subtitle'),
    color: '#FFD700',
  },
  {
    route: '/babylon',
    icon: 'mdi-lock-clock',
    name: 'BABYLON',
    desc: 'BTC staking protocol',
    color: '#9B72CF',
  },
  {
    route: '/thorchain',
    icon: 'mdi-swap-horizontal-bold',
    name: 'THORCHAIN',
    desc: 'Cross-chain swaps',
    color: '#00D5BD',
  },
  {
    route: '/gomining',
    icon: 'mdi-pickaxe',
    name: 'GOMINING',
    desc: 'Cloud mining NFTs',
    color: '#F7931A',
  },
  {
    route: '/mempool',
    icon: 'mdi-database-clock-outline',
    name: 'MEMPOOL',
    desc: 'Network fee explorer',
    color: '#1e88e5',
  },
];
</script>

<style scoped>
/* ─── Liquid Glass Shell ────────────────────────────────────── */
.ecosystem-widget {
  position: relative;
  background: rgba(255, 255, 255, 0.07);
  backdrop-filter: blur(24px) saturate(180%);
  -webkit-backdrop-filter: blur(24px) saturate(180%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  border-radius: 22px;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'SF Pro Display', 'SF Pro Text', system-ui, sans-serif;
  box-shadow:
    0 2px 8px rgba(0, 0, 0, 0.18),
    0 16px 48px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.18),
    inset 0 -1px 0 rgba(0, 0, 0, 0.06);
  transition: box-shadow 0.3s ease;
}

.ecosystem-widget:hover {
  box-shadow:
    0 4px 16px rgba(0, 0, 0, 0.22),
    0 24px 60px rgba(0, 0, 0, 0.36),
    0 0 0 1px rgba(255, 255, 255, 0.12),
    inset 0 1px 0 rgba(255, 255, 255, 0.22);
}

.eco-body {
  padding: 16px 18px;
}

/* ─── Header ────────────────────────────────────────────────── */
.eco-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.eco-header-left {
  display: flex;
  align-items: center;
  gap: 10px;
}

.eco-icon {
  width: 32px;
  height: 32px;
  background: rgba(247, 147, 26, 0.12);
  border: 1px solid rgba(247, 147, 26, 0.2);
  border-radius: 10px;
  display: flex;
  align-items: center;
  justify-content: center;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.1);
}

.eco-title {
  font-size: 15px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.92);
  letter-spacing: -0.01em;
}

.eco-count {
  font-size: 11px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.5);
}

/* ─── Item Grid ─────────────────────────────────────────────── */
.eco-items {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
}

@media (max-width: 600px) {
  .eco-items {
    grid-template-columns: repeat(2, 1fr);
  }
}

.eco-item {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 10px 10px 12px;
  background: rgba(255, 255, 255, 0.05);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 14px;
  text-decoration: none;
  overflow: hidden;
  transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
  cursor: pointer;
}

.eco-item:hover {
  background: rgba(255, 255, 255, 0.09);
  border-color: rgba(255, 255, 255, 0.14);
  transform: translateY(-2px) scale(1.01);
}

.item-accent-bar {
  position: absolute;
  top: 10%;
  left: 0;
  bottom: 10%;
  width: 2px;
  background: var(--item-color);
  opacity: 0.5;
  border-radius: 0 2px 2px 0;
  transition: opacity 0.2s, height 0.2s;
}

.eco-item:hover .item-accent-bar {
  opacity: 0.85;
  top: 0;
  bottom: 0;
}

.item-icon-wrap {
  flex-shrink: 0;
  width: 26px;
  height: 26px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.07);
  display: flex;
  align-items: center;
  justify-content: center;
}

.item-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.item-name {
  font-size: 12px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.85);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  letter-spacing: -0.01em;
}

.item-desc {
  font-size: 10px;
  font-weight: 400;
  color: rgba(255, 255, 255, 0.55);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.item-arrow {
  color: rgba(255, 255, 255, 0.4);
  flex-shrink: 0;
  transition: color 0.2s, transform 0.2s;
}

.eco-item:hover .item-arrow {
  color: rgba(255, 255, 255, 0.5);
  transform: translateX(2px);
}
</style>