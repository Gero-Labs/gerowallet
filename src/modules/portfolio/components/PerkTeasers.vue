<template>
  <!-- Empty-wallet incentive strip: what a funded wallet unlocks, as tappable
       teasers. Each card renders only where the feature exists (same chain
       gating as the EmptyStateHero perks footnote). -->
  <section v-if="perks.length" class="perk-teasers">
    <p class="perk-teasers__label g-mono">{{ $t('dashboard.onceFundedTitle') }}</p>
    <div class="perk-teasers__grid">
      <button
        v-for="(perk, i) in perks"
        :key="perk.key"
        type="button"
        class="perk-teasers__card"
        :style="{ '--pt-d': `${i * 60}ms` }"
        @click="perk.go()"
      >
        <span class="perk-teasers__icon">
          <v-icon size="20" color="var(--g-accent)">{{ perk.icon }}</v-icon>
        </span>
        <span class="perk-teasers__text">
          <span class="perk-teasers__title">{{ $t(perk.title) }}</span>
          <span class="perk-teasers__hook">{{ $t(perk.hook) }}</span>
        </span>
        <span class="perk-teasers__arrow" aria-hidden="true">→</span>
      </button>
    </div>
  </section>
</template>

<script setup lang="ts">
import { toRefs, computed, getCurrentInstance } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { Blockchain } from '@/models/types';
import networks from '@/utils/networks';
import { useQuickActionDialogs } from '@/shared/composables/useQuickActionDialogs';

const { loggedWallet } = toRefs(walletStore);
const instance = getCurrentInstance();
const router = instance?.proxy?.$router;
const { openDialog } = useQuickActionDialogs();

const perks = computed(() => {
  const chain = loggedWallet.value?.chain;
  const network = loggedWallet.value?.network;
  const list: { key: string; icon: string; title: string; hook: string; go: () => void }[] = [];
  if (networks.resolveStakingSupport(chain, network)) {
    list.push({
      key: 'stake', icon: 'mdi-chart-timeline-variant',
      title: 'dashboard.perkStakeTitle', hook: 'portfolio.perkStakeHook',
      go: () => router?.push('/staking'),
    });
  }
  if (chain === Blockchain.CARDANO) {
    list.push({
      key: 'cashback', icon: 'mdi-cash-refund',
      title: 'dashboard.perkCashbackTitle', hook: 'portfolio.perkCashbackHook',
      go: () => router?.push('/cashback'),
    });
  }
  if (networks.resolveGeroCardSupport(chain, network)) {
    list.push({
      key: 'card', icon: 'mdi-credit-card-outline',
      title: 'dashboard.perkSpendTitle', hook: 'portfolio.perkSpendHook',
      go: () => router?.push('/card'),
    });
  }
  if (networks.resolvePerpetualsSupport(chain, network)) {
    list.push({
      key: 'perps', icon: 'mdi-finance',
      title: 'portfolio.perkPerpsTitle', hook: 'portfolio.perkPerpsHook',
      go: () => openDialog('PERPETUALS'),
    });
  }
  return list;
});
</script>

<style scoped>
.perk-teasers__label {
  font-size: 11px;
  letter-spacing: 0.14em;
  color: var(--g-text-3);
  margin: 0 0 8px 2px;
}

.perk-teasers__grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  gap: var(--g-s-2);
}

.perk-teasers__card {
  appearance: none;
  font: inherit;
  display: flex;
  align-items: center;
  gap: 12px;
  text-align: left;
  padding: var(--g-s-3);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  cursor: pointer;
  animation: pt-rise var(--g-dur-slow) var(--g-ease) both;
  animation-delay: var(--pt-d, 0ms);
  transition: border-color var(--g-dur-fast) var(--g-ease), background var(--g-dur-fast) var(--g-ease);
}

.perk-teasers__card:hover {
  border-color: color-mix(in srgb, var(--g-accent) 45%, transparent);
  background: var(--g-overlay);
}

@keyframes pt-rise {
  from { opacity: 0; transform: translateY(10px); }
  to { opacity: 1; transform: none; }
}

@media (prefers-reduced-motion: reduce) {
  .perk-teasers__card { animation: none; }
}

.perk-teasers__icon {
  width: 36px;
  height: 36px;
  border-radius: var(--g-r-control);
  background: color-mix(in srgb, var(--g-accent) 10%, transparent);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.perk-teasers__text {
  display: flex;
  flex-direction: column;
  gap: 1px;
  min-width: 0;
}

.perk-teasers__title {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-text-1);
}

.perk-teasers__hook {
  font-size: 12px;
  color: var(--g-text-3);
  line-height: 1.4;
}

.perk-teasers__arrow {
  margin-left: auto;
  font-size: 15px;
  color: var(--g-text-3);
  transition: transform var(--g-dur-fast) var(--g-ease), color var(--g-dur-fast) var(--g-ease);
}

.perk-teasers__card:hover .perk-teasers__arrow {
  transform: translateX(3px);
  color: var(--g-accent);
}
</style>
