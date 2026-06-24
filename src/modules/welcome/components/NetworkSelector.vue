<template>
  <div class="network-selector">
    <!-- Step 1 — Blockchain family -->
    <div class="ns-label mb-2">{{ $t('welcome.blockchain') }}</div>
    <div class="chain-row mb-4">
      <button
        v-for="fam in families"
        :key="fam.name"
        type="button"
        class="chain-tile"
        :class="{ 'chain-tile--active': fam.name === activeFamily, 'chain-tile--disabled': fam.comingSoon }"
        :disabled="fam.comingSoon"
        @click="selectFamily(fam)"
      >
        <v-avatar size="26" class="chain-tile__icon">
          <v-img :src="fam.icon" contain></v-img>
        </v-avatar>
        <span class="chain-tile__label">{{ fam.name }}</span>
        <v-chip v-if="fam.comingSoon" color="warning" x-small class="chain-tile__soon">{{ $t('welcome.soon') }}</v-chip>
      </button>
    </div>

    <!-- Step 2 — Network within the chosen family -->
    <div class="ns-label mb-2">{{ $t('common.network') }}</div>
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
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import networks, { NetworkInfo } from '@/utils/networks';
import { updateVuetifyTheme } from '@/plugins/vuetify';

interface Family {
  name: string;
  icon: string;
  nets: NetworkInfo[];
  comingSoon: boolean;
}

const props = defineProps<{ network: NetworkInfo }>();
const emit = defineEmits<{ (e: 'change', n: NetworkInfo): void }>();

// Group networks into display families. Apex Prime + Apex Vector are distinct
// blockchains in code but presented as one "Apex" family with two networks.
const familyName = (blockchain: string): string => (blockchain.includes('Apex') ? 'Apex' : blockchain);

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
  return order.map(k => map.get(k)!);
});

const activeFamily = computed<string>(() => familyName(props.network?.blockchain || ''));
const activeNets = computed<NetworkInfo[]>(() => families.value.find(f => f.name === activeFamily.value)?.nets || []);

const isNetActive = (net: NetworkInfo): boolean =>
  props.network?.blockchain === net.blockchain && props.network?.network === net.network;

// Strip the family prefix so labels stay short: "Cardano Mainnet" -> "Mainnet",
// "Apex Prime Mainnet" -> "Prime Mainnet".
const optionLabel = (net: NetworkInfo): string => {
  const fam = familyName(net.blockchain);
  return net.title.replace(new RegExp(`^${fam}\\s+`), '') || net.network;
};

const commit = (net: NetworkInfo): void => {
  updateVuetifyTheme(net.blockchain, true);
  emit('change', net);
};

const selectFamily = (fam: Family): void => {
  if (fam.comingSoon) return;
  if (fam.name === activeFamily.value) return;
  const def =
    fam.nets.find(n => !n.comingSoon && n.network === 'Mainnet') ||
    fam.nets.find(n => !n.comingSoon) ||
    fam.nets[0];
  if (def) commit(def);
};

const selectNet = (net: NetworkInfo): void => {
  if (net.comingSoon) return;
  commit(net);
};
</script>

<style scoped lang="scss">
.ns-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.7);
}

/* ── Step 1: chain tiles ──────────────────────────── */
.chain-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.chain-tile {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px 8px 10px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;

  &:hover:not(.chain-tile--disabled) {
    border-color: rgba(255, 255, 255, 0.2);
    background: rgba(255, 255, 255, 0.06);
  }

  &--active {
    border-color: #{"rgb(from var(--v-primary-base) r g b / 0.6)"};
    background: #{"rgb(from var(--v-primary-base) r g b / 0.08)"};
    box-shadow: 0 0 16px #{"rgb(from var(--v-primary-base) r g b / 0.08)"};
  }

  &--disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  &__label {
    font-size: 14px;
    font-weight: 600;
    color: rgba(255, 255, 255, 0.92);
  }

  &__soon {
    height: 15px;
    font-size: 9px;
  }
}

/* ── Step 2: network pills ────────────────────────── */
.net-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.net-pill {
  padding: 7px 16px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.03);
  font-size: 13px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.6);
  cursor: pointer;
  transition: all 0.15s ease;

  &:hover:not(.net-pill--disabled) {
    border-color: rgba(255, 255, 255, 0.28);
    color: rgba(255, 255, 255, 0.9);
  }

  &--active {
    border-color: var(--v-primary-base);
    background: #{"rgb(from var(--v-primary-base) r g b / 0.12)"};
    color: #fff;
  }

  &--disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
}
</style>
