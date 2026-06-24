<template>
  <div class="step-start">
    <!-- ── Network (two-step: blockchain → network) ────────── -->
    <NetworkSelector :network="localNetwork" @change="onNetworkChange" />

    <v-divider class="my-4" style="border-color: rgba(255, 255, 255, 0.08);" />

    <!-- ── Method ──────────────────────────────────────────── -->
    <div class="step-section-label mb-2">{{ $t('welcome.onboardingStepMethod') }}</div>
    <v-list class="transparent" dense nav style="width: inherit;">
      <v-list-item class="method-item mb-2" @click="$emit('select', 'create')">
        <v-list-item-avatar size="44" class="my-0" rounded style="border: 1px solid #373A41; border-radius: 12px; background-color: #13161B">
          <v-img :src="walletSvg" style="width: 20px;" max-width="20" contain></v-img>
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title style="font-size: 17px; font-weight: 600;">{{ $t('welcome.createWallet') }}</v-list-item-title>
          <v-list-item-subtitle>{{ $t('welcome.createWalletDescription') }}</v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>

      <v-list-item class="method-item mb-2" @click="$emit('select', 'restore')">
        <v-list-item-avatar size="44" class="my-0" rounded style="border: 1px solid #373A41; border-radius: 12px; background-color: #13161B">
          <v-img :src="keyGeroSvg" style="width: 20px;" max-width="20" contain></v-img>
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title style="font-size: 17px; font-weight: 600;">{{ $t('welcome.restoreWallet') }}</v-list-item-title>
          <v-list-item-subtitle>{{ $t('welcome.restoreWalletDescription') }}</v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>

      <v-list-item
        class="method-item"
        :class="{ 'method-item--disabled': !pairSupported }"
        @click="pairSupported && $emit('select', 'pair')"
      >
        <v-list-item-avatar size="44" class="my-0" rounded style="border: 1px solid #373A41; border-radius: 12px; background-color: #13161B">
          <v-img :src="pairSvg" style="width: 20px;" max-width="20" contain></v-img>
        </v-list-item-avatar>
        <v-list-item-content>
          <v-list-item-title style="font-size: 17px; font-weight: 600;">{{ $t('welcome.pairHardwareWallet') }}</v-list-item-title>
          <v-list-item-subtitle>
            {{ pairSupported ? $t('welcome.pairHardwareWalletDescription') : $t('welcome.pairNotSupportedOnNetwork', { network: localNetwork ? localNetwork.title : '' }) }}
          </v-list-item-subtitle>
        </v-list-item-content>
      </v-list-item>
    </v-list>

    <!-- Navigation -->
    <div class="d-flex mt-2">
      <v-btn text @click="$emit('back')">{{ $t('common.back') }}</v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue';
import assets from '@/utils/assets';
import { NetworkInfo } from '@/utils/networks';
import NetworkSelector from '@/modules/welcome/components/NetworkSelector.vue';

const props = defineProps<{ network: NetworkInfo }>();
const emit = defineEmits<{
  (e: 'change', n: NetworkInfo): void;
  (e: 'select', method: 'create' | 'restore' | 'pair'): void;
  (e: 'back'): void;
}>();

const localNetwork = ref<NetworkInfo>(props.network);

const onNetworkChange = (n: NetworkInfo): void => {
  localNetwork.value = n;
  emit('change', n);
};

const isApex = computed(() => !!localNetwork.value?.blockchain?.includes('Apex'));
const walletSvg = computed(() => (isApex.value ? assets.walletGeroApexSvg : assets.walletGeroSvg));
const keyGeroSvg = computed(() => (isApex.value ? assets.keyApexSvg : assets.keyGeroSvg));
const pairSvg = computed(() => (isApex.value ? assets.pairApexSvg : assets.pairGeroSvg));
const pairSupported = computed(() => !!localNetwork.value?.supportedHardware);
</script>

<style scoped>
.step-section-label {
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: rgba(255, 255, 255, 0.7);
}

.method-item--disabled {
  opacity: 0.4;
  cursor: not-allowed;
  pointer-events: none;
}
</style>
