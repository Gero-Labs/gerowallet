<template>
  <div class="step-network">
    <!-- Network — Mainnets -->
    <div class="step-section-label mb-2">{{ $t('common.selectNetwork') }}</div>
    <div class="network-grid mb-3">
      <div
        v-for="net in mainnetNetworks"
        :key="net.blockchain + net.network"
        class="network-tile"
        :class="{ 'network-tile--active': isNetworkSelected(net), 'network-tile--disabled': net.comingSoon }"
        @click="selectNetwork(net)"
      >
        <v-avatar size="22" class="network-tile__icon">
          <v-img :src="net.icon" contain></v-img>
        </v-avatar>
        <span class="network-tile__label">{{ net.title }}</span>
        <v-chip v-if="net.comingSoon" color="warning" x-small style="height: 14px; font-size: 9px;">{{ $t('welcome.soon') }}</v-chip>
      </div>
    </div>

    <!-- Testnets — collapsed by default -->
    <div class="testnet-toggle mb-4" @click="showTestnets = !showTestnets">
      <v-icon size="12" class="mr-1" style="color: inherit;">{{ showTestnets ? 'mdi-chevron-down' : 'mdi-chevron-right' }}</v-icon>
      <span>{{ $t('welcome.developerNetworks') }}</span>
    </div>
    <div v-if="showTestnets" class="network-grid mb-4">
      <div
        v-for="net in testnetNetworks"
        :key="net.blockchain + net.network"
        class="network-tile network-tile--testnet"
        :class="{ 'network-tile--active': isNetworkSelected(net), 'network-tile--disabled': net.comingSoon }"
        @click="selectNetwork(net)"
      >
        <v-avatar size="16" class="network-tile__icon">
          <v-img :src="net.icon" contain></v-img>
        </v-avatar>
        <span class="network-tile__label">{{ net.title }}</span>
        <v-chip v-if="net.comingSoon" color="warning" x-small style="height: 14px; font-size: 9px;">{{ $t('welcome.soon') }}</v-chip>
      </div>
    </div>

    <!-- Navigation buttons -->
    <div class="d-flex mt-4" style="gap: 12px;">
      <v-btn text @click="$emit('back')">{{ $t('common.back') }}</v-btn>
      <v-spacer />
      <v-btn :disabled="!localNetwork || localNetwork.comingSoon" color="primary" @click="$emit('next')">{{ $t('common.continue') }}</v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import networks, { NetworkInfo } from '@/utils/networks';
import { updateVuetifyTheme } from '@/plugins/vuetify';

const props = defineProps<{ network: NetworkInfo }>();
const emit = defineEmits<{
  (e: 'change', n: NetworkInfo): void;
  (e: 'next'): void;
  (e: 'back'): void;
}>();

const localNetwork = ref<NetworkInfo>(props.network);
const showTestnets = ref<boolean>(
  props.network?.network !== 'Mainnet' && props.network != null
);

const mainnetNetworks = computed(() => networks.networks.filter(n => n.network === 'Mainnet'));
const testnetNetworks = computed(() => networks.networks.filter(n => n.network !== 'Mainnet'));

const isNetworkSelected = (net: NetworkInfo): boolean =>
  localNetwork.value?.blockchain === net.blockchain && localNetwork.value?.network === net.network;

const selectNetwork = (net: NetworkInfo): void => {
  if (net.comingSoon) return;
  localNetwork.value = net;
  updateVuetifyTheme(net.blockchain, true);
  emit('change', net);
};
</script>

<style scoped lang="scss">
// ─── Section labels ───────────────────────────────────────────────────────────
.step-section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: white
}

// ─── Testnet toggle ───────────────────────────────────────────────────────────
.testnet-toggle {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 500;
  letter-spacing: 0.06em;
  color: white;
  cursor: pointer;
  user-select: none;
  transition: color 0.15s ease;

  &:hover {
    color: rgba(255, 255, 255, 0.5);
  }
}

// ─── Network grid ─────────────────────────────────────────────────────────────
.network-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 6px;
}

.network-tile {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 10px 8px 8px;
  border-radius: 10px;
  border: 1px solid rgba(255, 255, 255, 0.07);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease, opacity 0.15s ease;
  min-height: 62px;
  gap: 5px;
  user-select: none;

  &:hover {
    border-color: rgba(255, 255, 255, 0.18);
    background: rgba(255, 255, 255, 0.05);
  }

  &--active {
    border-color: #{"rgb(from var(--v-primary-base) r g b / 0.55)"};
    background: #{"rgb(from var(--v-primary-base) r g b / 0.06)"};
    box-shadow: 0 0 14px #{"rgb(from var(--v-primary-base) r g b / 0.07)"};
  }

  &--disabled {
    opacity: 0.4;
    cursor: not-allowed;

    &:hover {
      border-color: rgba(255, 255, 255, 0.07);
      background: rgba(255, 255, 255, 0.03);
    }
  }

  // Testnet variant
  &--testnet {
    min-height: 46px;
    padding: 7px 8px 6px;
  }

  &__label {
    font-size: 10.5px;
    font-weight: 500;
    color: rgba(255, 255, 255, 0.5);
    text-align: center;
    line-height: 1.3;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &--active &__label {
    color: rgba(255, 255, 255, 0.9);
  }
}
</style>
