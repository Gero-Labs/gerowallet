<template>
  <div class="network-selector">
    <!-- Blockchain family -->
    <div class="t-label mb-2">{{ $t('welcome.blockchain') }}</div>
    <div class="chain-row" :class="{ 'mb-3': devMode }">
      <template v-for="(fam, idx) in families">
        <!-- Force the Apex chains onto a second row → 3 (Cardano/Midnight/Bitcoin) + 2 (Apex Prime/Vector) -->
        <div
          v-if="idx > 0 && fam.name.includes('Apex') && !families[idx - 1].name.includes('Apex')"
          :key="'break-' + idx"
          class="chain-row__break"
        ></div>
        <button
          :key="fam.name"
          type="button"
          class="chain-tile"
          :class="{ 'chain-tile--active': fam.name === activeFamily, 'chain-tile--disabled': !isFamilySelectable(fam) }"
          :style="fam.name === activeFamily && chainColor(fam.name) ? { borderColor: chainColor(fam.name), boxShadow: `0 0 16px -4px ${chainColor(fam.name)}` } : null"
          :disabled="!isFamilySelectable(fam)"
          @click="selectFamily(fam)"
        >
          <v-avatar size="26" class="chain-tile__icon">
            <v-img :src="fam.icon" contain></v-img>
          </v-avatar>
          <span class="chain-tile__label">{{ fam.name }}</span>
          <div v-if="!isFamilySelectable(fam)" class="ribbon top-right" aria-hidden="true">
            <span>{{ $t('welcome.soon') }}</span>
          </div>
        </button>
      </template>
    </div>

    <!-- Network within the chosen family — dev only -->
    <template v-if="devMode">
      <div class="t-label mb-2">{{ $t('common.network') }}</div>
      <div class="net-row">
        <button
          v-for="net in activeNets"
          :key="net.blockchain + net.network"
          type="button"
          class="net-pill"
          :class="{ 'net-pill--active': isNetActive(net), 'net-pill--disabled': net.comingSoon }"
          :disabled="net.comingSoon"
          @click="selectNet(net)"
        >
          {{ optionLabel(net) }}
        </button>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, watch } from 'vue';
import networks, { NetworkInfo } from '@/utils/networks';
import { updateVuetifyTheme } from '@/plugins/vuetify';
import { chainAccents, chainKeyFor } from '@/config/themes';

interface Family {
  name: string;
  icon: string;
  nets: NetworkInfo[];
  comingSoon: boolean;
}

const props = defineProps<{ network: NetworkInfo; devMode?: boolean }>();
const emit = defineEmits<{ (e: 'change', n: NetworkInfo): void }>();

// One family per blockchain. The blockchain enum values are already display
// names (e.g. "Apex Fusion Prime", "Apex Fusion Vector", "Cardano").
const familyName = (blockchain: string): string => blockchain;

const families = computed<Family[]>(() => {
  const order: string[] = [];
  const map = new Map<string, Family>();
  for (const n of networks.networks) {
    const name = familyName(n.blockchain);
    if (!map.has(name)) {
      map.set(name, { name, icon: n.icon, nets: [], comingSoon: true });
      order.push(name);
    }
    const fam = map.get(name)!;
    fam.nets.push(n);
    if (!n.comingSoon) fam.comingSoon = false;
  }
  // Non-Apex chains first (Cardano / Bitcoin / Midnight), Apex chains second.
  const list = order.map(k => map.get(k)!);
  return [...list.filter(f => !f.name.includes('Apex')), ...list.filter(f => f.name.includes('Apex'))];
});

const activeFamily = computed<string>(() => familyName(props.network?.blockchain || ''));
const activeNets = computed<NetworkInfo[]>(() => families.value.find(f => f.name === activeFamily.value)?.nets || []);

const famHasLiveMainnet = (fam: Family): boolean => fam.nets.some(n => n.network === 'Mainnet' && !n.comingSoon);
const currentIsTestnet = computed<boolean>(() => !!props.network && props.network.network !== 'Mainnet');

// Without dev mode a chain is only pickable if it has a live mainnet (a chain
// like Bitcoin that's testnet-only is hidden from regular users). With dev mode
// any chain that has at least one live network is pickable.
const isFamilySelectable = (fam: Family): boolean => (props.devMode ? !fam.comingSoon : famHasLiveMainnet(fam));

// Per-network accent for the active tile ring, from the single accent source.
// The old hardcoded map carried the retired Apex Prime/Vector one-offs and had
// no Midnight entry.
const chainColor = (name: string): string => chainAccents[chainKeyFor(name)].accent;

const isNetActive = (net: NetworkInfo): boolean =>
  props.network?.blockchain === net.blockchain && props.network?.network === net.network;

// Strip the family prefix so labels stay short: "Cardano Mainnet" -> "Mainnet",
// "Apex Prime Mainnet" -> "Prime Mainnet".
const optionLabel = (net: NetworkInfo): string => {
  const fam = familyName(net.blockchain);
  return net.title.startsWith(fam + ' ') ? net.title.slice(fam.length + 1) : (net.title || net.network);
};

const commit = (net: NetworkInfo): void => {
  updateVuetifyTheme(net.blockchain);
  emit('change', net);
};

const selectFamily = (fam: Family): void => {
  if (!isFamilySelectable(fam)) return;
  if (fam.name === activeFamily.value) return;
  const liveMainnet = fam.nets.find(n => n.network === 'Mainnet' && !n.comingSoon);
  const def = liveMainnet || fam.nets.find(n => !n.comingSoon) || fam.nets[0];
  if (def) commit(def);
};

const selectNet = (net: NetworkInfo): void => {
  if (net.comingSoon) return;
  commit(net);
};

// Turning dev mode off while on a testnet snaps back to a live mainnet.
watch(
  () => props.devMode,
  (dev) => {
    if (!dev && currentIsTestnet.value) {
      const fam = families.value.find(f => f.name === activeFamily.value);
      const main = fam?.nets.find(n => n.network === 'Mainnet' && !n.comingSoon);
      commit(main || networks.networks[0]);
    }
  },
);
</script>

<style scoped lang="scss">
/* ── Chain tiles ──────────────────────────────────── */
.chain-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

/* Zero-size full-width flex item: forces everything after it onto a new line
   (used to split non-Apex chains from the Apex chains → 3 + 2 rows). */
.chain-row__break {
  flex-basis: 100%;
  width: 100%;
  height: 0;
}

.chain-tile {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 8px 10px;
  border-radius: var(--g-r-pill);
  border: 1px solid var(--g-hairline-1);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: border-color var(--g-dur-fast) ease, background var(--g-dur-fast) ease, box-shadow var(--g-dur-fast) ease;

  &:hover:not(.chain-tile--disabled) {
    border-color: var(--g-hairline-3);
    background: rgba(255, 255, 255, 0.06);
  }

  &--active {
    border-color: #{"rgb(from var(--v-primary-base) r g b / 0.6)"};
    background: #{"rgb(from var(--v-primary-base) r g b / 0.08)"};
    box-shadow: 0 0 16px #{"rgb(from var(--v-primary-base) r g b / 0.08)"};
  }

  &--disabled {
    cursor: not-allowed;
    border-color: var(--g-hairline-2);
    background: rgba(255, 255, 255, 0.02);
  }

  &--disabled &__label {
    color: var(--g-text-3);
  }

  &--disabled &__icon {
    opacity: 0.45;
  }

  &__label {
    font-size: 14px;
    font-weight: 600;
    color: var(--g-text-1);
  }
}

/* Corner ribbon "Soon" badge (matches the disabled swap quick-action). */
.ribbon {
  position: absolute;
  top: 0;
  right: 0;
  width: 1.75rem;
  height: 1.75rem;
  overflow: hidden;
  z-index: 20;
  pointer-events: none;
}

.ribbon span {
  position: absolute;
  display: block;
  width: 46px;
  padding: 2px 0;
  background-color: #bd1550;
  color: var(--g-text-1);
  font-size: 11px;
  font-weight: 700;
  text-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
  text-transform: uppercase;
  text-align: center;
  right: -12px;
  top: 4px;
  transform: rotate(45deg);
  letter-spacing: 0.3px;
  line-height: 1.2;
}

.ribbon span::before,
.ribbon span::after {
  content: "";
  position: absolute;
  top: 100%;
  z-index: -1;
  border-left: 2px solid transparent;
  border-right: 2px solid transparent;
  border-top: 2px solid #8b0e3c;
}

.ribbon span::before {
  left: 0;
}

.ribbon span::after {
  right: 0;
}

/* ── Network pills (dev mode) ─────────────────────── */
.net-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.net-pill {
  padding: 7px 16px;
  border-radius: var(--g-r-pill);
  border: 1px solid var(--g-hairline-2);
  background: rgba(255, 255, 255, 0.03);
  font-size: 13px;
  font-weight: 500;
  color: var(--g-text-2);
  cursor: pointer;
  transition: color var(--g-dur-fast) ease, background-color var(--g-dur-fast) ease, border-color var(--g-dur-fast) ease, opacity var(--g-dur-fast) ease;

  &:hover:not(.net-pill--disabled) {
    border-color: var(--g-hairline-3);
    color: var(--g-text-1);
  }

  &--active {
    border-color: var(--v-primary-base);
    background: #{"rgb(from var(--v-primary-base) r g b / 0.12)"};
    color: var(--g-text-1);
  }

  &--disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}
</style>
