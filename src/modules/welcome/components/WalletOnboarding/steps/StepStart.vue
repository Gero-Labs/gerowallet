<template>
  <div class="step-start">
    <!-- ── Network (two-step: blockchain → network) ────────── -->
    <NetworkSelector :network="localNetwork" :dev-mode="devMode" @change="onNetworkChange" />

    <v-divider class="my-3" style="border-color: rgba(255, 255, 255, 0.08);" />

    <!-- ── Method (stacked selectable cards) ───────────────── -->
    <div class="step-section-label mb-2">{{ $t('welcome.onboardingStepMethod') }}</div>
    <div class="method-list">
      <button
        type="button"
        class="method-card"
        :class="{ 'method-card--active': selectedMethod === 'create' }"
        @click="selectedMethod = 'create'"
      >
        <span class="method-card__icon"><v-img :src="walletSvg" width="20" max-width="20" contain /></span>
        <span class="method-card__text">
          <span class="method-card__title">{{ $t('welcome.createWallet') }}</span>
          <span class="method-card__desc">{{ $t('welcome.createWalletDescription') }}</span>
        </span>
      </button>

      <button
        type="button"
        class="method-card"
        :class="{ 'method-card--active': selectedMethod === 'restore' }"
        @click="selectedMethod = 'restore'"
      >
        <span class="method-card__icon"><v-img :src="keyGeroSvg" width="20" max-width="20" contain /></span>
        <span class="method-card__text">
          <span class="method-card__title">{{ $t('welcome.restoreWallet') }}</span>
          <span class="method-card__desc">{{ $t('welcome.restoreWalletDescription') }}</span>
        </span>
      </button>

      <button
        type="button"
        class="method-card"
        :class="{ 'method-card--active': selectedMethod === 'pair', 'method-card--disabled': !pairSupported }"
        :disabled="!pairSupported"
        @click="selectedMethod = 'pair'"
      >
        <span class="method-card__icon"><v-img :src="pairSvg" width="20" max-width="20" contain /></span>
        <span class="method-card__text">
          <span class="method-card__title">{{ $t('welcome.pairHardwareWallet') }}</span>
          <span class="method-card__desc">
            {{ pairSupported ? $t('welcome.pairHardwareWalletDescription') : $t('welcome.pairNotSupportedOnNetwork', { network: localNetwork ? localNetwork.title : '' }) }}
          </span>
        </span>
      </button>
    </div>

    <!-- Navigation -->
    <div class="onboarding-actions d-flex" style="gap: 12px;">
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

const props = defineProps<{ network: NetworkInfo; devMode?: boolean }>();
const emit = defineEmits<{
  (e: 'change', n: NetworkInfo): void;
  (e: 'select', method: Method): void;
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

.method-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.method-card {
  display: flex;
  align-items: center;
  gap: 14px;
  width: 100%;
  text-align: left;
  padding: 11px 16px;
  border-radius: 14px;
  border: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
  transition: border-color 0.15s ease, background 0.15s ease, box-shadow 0.15s ease;
}

.method-card:hover:not(.method-card--disabled) {
  border-color: rgba(255, 255, 255, 0.24);
  background: rgba(255, 255, 255, 0.05);
}

.method-card--active {
  border-color: var(--v-primary-base);
  background: rgb(from var(--v-primary-base) r g b / 0.1);
  box-shadow: 0 0 16px rgb(from var(--v-primary-base) r g b / 0.08);
}

.method-card--disabled {
  opacity: 0.4;
  cursor: not-allowed;
}

.method-card__icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 44px;
  min-width: 44px;
  height: 44px;
  border-radius: 12px;
  border: 1px solid #373a41;
  background-color: #13161b;
}

.method-card__text {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.method-card__title {
  font-size: 16px;
  font-weight: 600;
  color: #fff;
  line-height: 1.25;
}

.method-card__desc {
  font-size: 13px;
  color: #94979c;
  margin-top: 2px;
  line-height: 1.35;
}
</style>
