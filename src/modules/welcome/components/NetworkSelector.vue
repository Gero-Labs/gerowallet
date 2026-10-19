<template>
  <div class="network-selector">
    <!-- Blockchain family -->
    <div class="t-label mb-2">{{ $t('welcome.blockchain') }}</div>
    <div class="chain-row" :class="{ 'mb-3': devMode }">
      <template :key="'break-' + idx" v-for="(fam, idx) in families">
        <!-- Force the Apex chains onto a second row → 3 (Cardano/Midnight/Bitcoin) + 2 (Apex Prime/Vector) -->
        <div
          v-if="idx > 0 && fam.name.includes('Apex') && !families[idx - 1].name.includes('Apex')"
          class="chain-row__break"
        ></div>
        <button
          type="button"
          class="chain-tile glass-tier"
          :class="{ 'chain-tile--active': fam.name === activeFamily, 'chain-tile--disabled': !isFamilySelectable(fam) }"
          :disabled="!isFamilySelectable(fam)"
          @click="selectFamily(fam)"
        >
          <v-avatar size="26" class="chain-tile__icon">
            <v-img :src="fam.icon" ></v-img>
          </v-avatar>
          <span class="chain-tile__label t-body">{{ fam.name }}</span>
          <span v-if="!isFamilySelectable(fam)" class="chain-tile__ribbon">
            <span>{{ $t('welcome.soon') }}</span>
          </span>
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
          class="net-pill glass-tier t-body-sm"
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
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { Blockchain } from '@/models/types';

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
const isFamilySelectable = (fam: Family): boolean => {
  // Bitcoin is gated behind the isBitcoinEnabled flag (gero-sync). While off it
  // stays a disabled "Soon" tile regardless of its net defs — this is the release
  // gate that replaces the old hardcoded hide in networks.ts.
  if (fam.name === Blockchain.BITCOIN && !featureFlagsStore.isBitcoinEnabled()) return false;
  return props.devMode ? !fam.comingSoon : famHasLiveMainnet(fam);
};

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
// The chain tiles and network pills are choices nested in the onboarding
// panel: the glass-tier material with its hover lift and selected tint (the
// selected edge is --g-accent, which the welcome screen points at the chosen
// chain), shaped as pills. Type comes from the ramp classes in the markup.

/* ── Chain tiles ──────────────────────────────────── */
.chain-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
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
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-4) var(--g-s-2) var(--g-s-3);
  border-radius: var(--g-r-pill);
  cursor: pointer;
  transition: border-color var(--g-dur-fast) var(--g-ease), background-color var(--g-dur-fast) var(--g-ease);

  &:hover:not(.chain-tile--disabled) { @include g-glass-tier-hover; }

  &--active,
  &--active:hover:not(.chain-tile--disabled) { @include g-glass-tier-active; }

  &--disabled {
    padding-right: var(--g-s-5);
    cursor: not-allowed;
  }

  &--disabled &__label {
    color: var(--g-text-3);
  }

  &--disabled &__icon {
    opacity: 0.45;
  }

  &__label {
    color: var(--g-text-1);
    font-weight: 500;
  }
}

/* Corner ribbon "Soon" on a chain that can't be picked yet, like the
   dashboard's disabled-swap ribbon. Its text is the tile's own, so a disabled
   tile also says why to assistive tech. The strip is the error tone mixed
   towards the canvas so 11px white text stays readable on it (about 5:1).
   Sized so the longest translation ("Pronto") fits inside the corner; the
   disabled tile's wider end padding keeps the chain name clear of it. */
.chain-tile__ribbon {
  position: absolute;
  top: 0;
  right: 0;
  width: 32px;
  height: 32px;
  overflow: hidden;
  pointer-events: none;

  span {
    position: absolute;
    top: 6px;
    right: -15px;
    display: block;
    width: 58px;
    padding: 2px 0;
    background-color: color-mix(in srgb, var(--g-error) 70%, var(--g-canvas));
    color: var(--g-text-1);
    font-size: 11px;
    font-weight: 700;
    line-height: 1.2;
    text-align: center;
    transform: rotate(45deg);
  }
}

/* ── Network pills (dev mode) ─────────────────────── */
.net-row {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}

.net-pill {
  padding: var(--g-s-2) var(--g-s-4);
  border-radius: var(--g-r-pill);
  font-weight: 500;
  cursor: pointer;
  transition: color var(--g-dur-fast) var(--g-ease), background-color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease), opacity var(--g-dur-fast) var(--g-ease);

  &:hover:not(.net-pill--disabled) {
    @include g-glass-tier-hover;
    color: var(--g-text-1);
  }

  &--active,
  &--active:hover:not(.net-pill--disabled) {
    @include g-glass-tier-active;
    color: var(--g-text-1);
  }

  &--disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}
</style>
