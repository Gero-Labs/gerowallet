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
        <span class="method-card__icon"><span class="method-card__glyph" :style="glyphStyle(walletSvg)" /></span>
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
        <span class="method-card__icon"><span class="method-card__glyph" :style="glyphStyle(keyGeroSvg)" /></span>
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
        <span class="method-card__icon"><span class="method-card__glyph" :style="glyphStyle(pairSvg)" /></span>
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
      <v-btn class="onb-btn" depressed color="primary" :disabled="!selectedMethod" @click="onContinue()">{{ $t('common.continue') }}</v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue';
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
// Keep in sync when the parent changes the network externally (e.g. hovering a
// wallet in the left list flows back down as a new prop).
watch(() => props.network, (n) => { localNetwork.value = n; });

const selectedMethod = ref<Method | null>(null);
const pairSupported = computed(() => !!localNetwork.value?.supportedHardware);

// Base icon shapes (recolored per network via CSS mask).
const walletSvg = assets.walletGeroSvg;
const keyGeroSvg = assets.keyGeroSvg;
const pairSvg = assets.pairGeroSvg;

// Method icons take the selected network's accent gradient (lighter -> base),
// matching the per-network logo gradients.
const NET_GRADIENTS: Record<string, string> = {
  'Cardano': 'linear-gradient(160deg, #00eaef, #0ca3fb)',
  'Apex Fusion Prime': 'linear-gradient(160deg, #16b89e, #057468)',
  'Apex Fusion Vector': 'linear-gradient(160deg, #ff7a66, #f25140)',
  'Bitcoin': 'linear-gradient(160deg, #ffd279, #f7931a)',
};
const methodBg = computed(
  () => NET_GRADIENTS[localNetwork.value?.blockchain || ''] || 'var(--v-primary-base)',
);
const glyphStyle = (url: string): Record<string, string> => ({
  '-webkit-mask-image': `url("${url}")`,
  'mask-image': `url("${url}")`,
  background: methodBg.value,
});

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

.onb-btn {
  border-radius: 8px !important;
  box-shadow: none !important;
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
  padding: 6px 16px;
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
  width: 28px;
  min-width: 28px;
  height: 28px;
}

.method-card__glyph {
  display: block;
  width: 24px;
  height: 24px;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: center;
  mask-position: center;
  -webkit-mask-size: contain;
  mask-size: contain;
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
