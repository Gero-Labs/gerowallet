<template>
  <!-- Shortcuts to the Bitcoin modules this wallet can open. Shared glass-panel
       shell with glass-tier tiles; modules are named, not painted, so the
       chain accent stays the only colour. -->
  <section v-if="items.length" class="glass-panel btc-eco" :aria-label="$t('bitcoin.ecosystem')">
    <h3 class="t-heading btc-eco__title">{{ $t('bitcoin.ecosystem') }}</h3>
    <div class="btc-eco__grid">
      <router-link
        v-for="item in items"
        :key="item.route"
        :to="item.route"
        class="glass-tier btc-eco__item"
      >
        <span class="btc-eco__icon"><v-icon size="small">{{ item.icon }}</v-icon></span>
        <span class="btc-eco__text">
          <span class="btc-eco__name">{{ $t(item.titleKey) }}</span>
          <span class="t-caption btc-eco__desc">{{ $t(item.descKey) }}</span>
        </span>
        <v-icon size="small" class="btc-eco__chevron">mdi-chevron-right</v-icon>
      </router-link>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import networks from '@/utils/networks';

const { loggedWallet } = toRefs(walletStore);

type SupportResolver = (chain: string, network: string) => boolean;

interface EcosystemItem {
  route: string;
  icon: string;
  titleKey: string;
  descKey: string;
  /** The same capability gate as the route guard and the navigation drawer. */
  supported: SupportResolver;
  /** An extra flag a module needs beyond isBitcoinEnabled. */
  flag?: () => boolean;
}

const ITEMS: EcosystemItem[] = [
  { route: '/ordinals', icon: 'mdi-image-multiple-outline', titleKey: 'navigation.ordinals', descKey: 'ordinals.subtitle', supported: networks.resolveOrdinalsSupport },
  { route: '/lightning', icon: 'mdi-lightning-bolt', titleKey: 'navigation.lightning', descKey: 'lightning.subtitle', supported: networks.resolveLightningSupport },
  { route: '/babylon', icon: 'mdi-lock-clock', titleKey: 'navigation.babylon', descKey: 'babylon.subtitle', supported: networks.resolveBabylonSupport },
  { route: '/thorchain', icon: 'mdi-swap-horizontal', titleKey: 'navigation.thorchain', descKey: 'thorchain.subtitle', supported: networks.resolveThorchainSupport },
  {
    route: '/gomining',
    icon: 'mdi-pickaxe',
    titleKey: 'navigation.goMining',
    descKey: 'gomining.subtitle',
    supported: networks.resolveGoMiningSupport,
    // The drawer shows GoMining as under maintenance while this flag is off; no shortcut to that.
    flag: () => featureFlagsStore.isGoMiningEnabled(),
  },
  { route: '/mempool', icon: 'mdi-database-clock-outline', titleKey: 'navigation.mempool', descKey: 'mempool.subtitle', supported: networks.resolveMempoolSupport },
];

const items = computed(() => {
  const chain = loggedWallet.value?.chain;
  const network = loggedWallet.value?.network;
  if (!chain || !network || !featureFlagsStore.isBitcoinEnabled()) return [];
  return ITEMS.filter((item) => item.supported.call(networks, chain, network) && (item.flag?.() ?? true));
});
</script>

<style scoped lang="scss">
/* Surface comes from the shared .glass-panel material; only layout lives here. */
.btc-eco {
  padding: var(--g-s-4);
}

.btc-eco__title {
  margin: 0 0 var(--g-s-3);
}

.btc-eco__grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: var(--g-s-2);
}

@media (max-width: 960px) {
  .btc-eco__grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .btc-eco__grid {
    grid-template-columns: minmax(0, 1fr);
  }
}

.btc-eco__item {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-3);
  color: inherit;
  text-decoration: none;
  transition: background-color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease);
}

.btc-eco__item:hover {
  @include g-glass-tier-hover;
}

.btc-eco__icon {
  flex: 0 0 auto;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: var(--g-r-control);
  background: var(--g-hairline-1);
}

.btc-eco__icon .v-icon {
  color: var(--g-text-2);
  transition: color var(--g-dur-fast) var(--g-ease);
}

.btc-eco__item:hover .btc-eco__icon .v-icon {
  color: var(--g-accent);
}

.btc-eco__text {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.btc-eco__name {
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
}

.btc-eco__name,
.btc-eco__desc {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.btc-eco__chevron {
  flex: 0 0 auto;
  color: var(--g-text-3);
}
</style>
