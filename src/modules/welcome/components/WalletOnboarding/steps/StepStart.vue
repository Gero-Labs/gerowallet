<template>
  <div class="step-start">
    <!-- ── Network (two-step: blockchain → network) ────────── -->
    <NetworkSelector :network="localNetwork" @change="onNetworkChange" />

    <v-divider class="my-4" style="border-color: rgba(255, 255, 255, 0.08);" />

    <!-- ── Method (toggle pills) ───────────────────────────── -->
    <div class="step-section-label mb-2">{{ $t('welcome.onboardingStepMethod') }}</div>
    <div class="method-row">
      <button
        type="button"
        class="opt-pill"
        :class="{ 'opt-pill--active': selectedMethod === 'create' }"
        @click="selectedMethod = 'create'"
      >
        <v-img :src="walletSvg" class="opt-pill__icon" contain />
        <span>{{ $t('welcome.createWallet') }}</span>
      </button>
      <button
        type="button"
        class="opt-pill"
        :class="{ 'opt-pill--active': selectedMethod === 'restore' }"
        @click="selectedMethod = 'restore'"
      >
        <v-img :src="keyGeroSvg" class="opt-pill__icon" contain />
        <span>{{ $t('welcome.restoreWallet') }}</span>
      </button>
      <button
        type="button"
        class="opt-pill"
        :class="{ 'opt-pill--active': selectedMethod === 'pair', 'opt-pill--disabled': !pairSupported }"
        :disabled="!pairSupported"
        @click="selectedMethod = 'pair'"
      >
        <v-img :src="pairSvg" class="opt-pill__icon" contain />
        <span>{{ $t('welcome.pairHardwareWallet') }}</span>
      </button>
    </div>
    <div v-if="!pairSupported" class="method-hint mt-2">
      {{ $t('welcome.pairNotSupportedOnNetwork', { network: localNetwork ? localNetwork.title : '' }) }}
    </div>

    <!-- Navigation -->
    <div class="onboarding-actions d-flex" style="gap: 12px;">
      <v-btn text @click="$emit('back')">{{ $t('common.back') }}</v-btn>
      <v-spacer />
      <v-btn color="primary" :disabled="!selectedMethod" @click="onContinue()">{{ $t('common.continue') }}</v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import assets from '@/utils/assets';
import { NetworkInfo } from '@/utils/networks';
import NetworkSelector from '@/modules/welcome/components/NetworkSelector.vue';

type Method = 'create' | 'restore' | 'pair';

const props = defineProps<{ network: NetworkInfo }>();
const emit = defineEmits<{
  (e: 'change', n: NetworkInfo): void;
  (e: 'select', method: Method): void;
  (e: 'back'): void;
}>();

const localNetwork = ref<NetworkInfo>(props.network);
const selectedMethod = ref<Method | null>(null);
const pairSupported = computed(() => !!localNetwork.value?.supportedHardware);

const isApex = computed(() => !!localNetwork.value?.blockchain?.includes('Apex'));
const walletSvg = computed(() => (isApex.value ? assets.walletGeroApexSvg : assets.walletGeroSvg));
const keyGeroSvg = computed(() => (isApex.value ? assets.keyApexSvg : assets.keyGeroSvg));
const pairSvg = computed(() => (isApex.value ? assets.pairApexSvg : assets.pairGeroSvg));

const onNetworkChange = (n: NetworkInfo): void => {
  localNetwork.value = n;
  emit('change', n);
  // Drop a stale Pair choice if the new network can't pair hardware.
  if (selectedMethod.value === 'pair' && !n.supportedHardware) {
    selectedMethod.value = null;
  }
};

const onContinue = (): void => {
  if (selectedMethod.value) emit('select', selectedMethod.value);
};
</script>

<style scoped>
.step-section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.7);
}

.method-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.opt-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 9px 16px;
  border-radius: 999px;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.03);
  font-size: 14px;
  font-weight: 500;
  color: rgba(255, 255, 255, 0.65);
  cursor: pointer;
  transition: all 0.15s ease;
}

.opt-pill__icon {
  width: 18px;
  max-width: 18px;
  height: 18px;
  flex: 0 0 18px;
}

.opt-pill:hover:not(.opt-pill--disabled) {
  border-color: rgba(255, 255, 255, 0.28);
  color: rgba(255, 255, 255, 0.9);
}

.opt-pill--active {
  border-color: var(--v-primary-base);
  background: rgb(from var(--v-primary-base) r g b / 0.12);
  color: #fff;
}

.opt-pill--disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.method-hint {
  font-size: 12px;
  color: #94979c;
}
</style>
