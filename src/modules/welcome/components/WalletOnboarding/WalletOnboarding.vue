<template>
  <v-card class="liquid-glass transparent-override" flat style="width: 100%; max-width: 560px; margin: auto;">
    <v-stepper v-model="step" vertical flat class="transparent">
      <template v-for="(s, i) in steps">
        <v-stepper-step
          :key="`step-${i}`"
          :step="i + 1"
          :complete="step > i + 1"
          editable
          :rules="[() => true]"
        >
          {{ $t(s.titleKey) }}
        </v-stepper-step>
        <v-stepper-content :key="`content-${i}`" :step="i + 1">
          <StepMethod
            v-if="s.key === 'method'"
            :network="selectedNetwork"
            @select="onMethodSelect"
            @back="$emit('back')"
          />
          <StepNetwork
            v-else-if="s.key === 'network'"
            :network="selectedNetwork"
            @change="onNetworkChange"
            @next="step++"
            @back="step--"
          />
          <StepSecurity
            v-else-if="s.key === 'security'"
            :network="selectedNetwork"
            @select="onSecuritySelect"
            @next="step++"
            @back="step--"
          />
          <StepCreateConfirm
            v-else-if="s.key === 'createConfirm'"
            :network="selectedNetwork"
            :security-method="securityMethod"
            :name="walletName"
            @back="step--"
            @created="$emit('back')"
          />
          <StepSeedPhrase
            v-else-if="s.key === 'seed'"
            :network="selectedNetwork"
            @change="onMnemonicChange"
            @next="step++"
            @back="step--"
          />
          <StepRestoreConfirm
            v-else-if="s.key === 'restoreConfirm'"
            :network="selectedNetwork"
            :security-method="securityMethod"
            :name="walletName"
            :mnemonic="mnemonic"
            @back="step--"
            @created="$emit('back')"
          />
          <!-- placeholder for future steps (pair) -->
          <div v-else class="pa-4 text-caption">{{ $t(s.titleKey) }} — coming next task</div>
        </v-stepper-content>
      </template>
    </v-stepper>
    <v-divider class="mt-2" />
    <v-btn text @click="onBack()">
      <v-icon>mdi-arrow-left</v-icon> {{ $t('common.back') }}
    </v-btn>
  </v-card>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue';
import networks, { NetworkInfo } from '@/utils/networks';
import StepMethod from './steps/StepMethod.vue';
import StepNetwork from './steps/StepNetwork.vue';
import StepSecurity from './steps/StepSecurity.vue';
import StepCreateConfirm from './steps/StepCreateConfirm.vue';
import StepSeedPhrase from './steps/StepSeedPhrase.vue';
import StepRestoreConfirm from './steps/StepRestoreConfirm.vue';

const emit = defineEmits<{ (e: 'back'): void; (e: 'network-change', n: NetworkInfo): void }>();

const step = ref<number>(1);
const selectedMethod = ref<'create' | 'restore' | 'pair' | null>(null);
const selectedNetwork = ref<NetworkInfo>(networks.networks[0]);
const securityMethod = ref<'prf' | 'password'>('prf');
const walletName = ref<string>('');
const mnemonic = ref<string[]>([]);

const steps = computed<{ key: string; titleKey: string }[]>(() => {
  const base = [
    { key: 'method', titleKey: 'welcome.onboardingStepMethod' },
    { key: 'network', titleKey: 'welcome.onboardingStepNetwork' },
  ];
  if (selectedMethod.value === 'create') {
    return [
      ...base,
      { key: 'security', titleKey: 'welcome.onboardingStepSecurity' },
      { key: 'createConfirm', titleKey: 'welcome.onboardingStepConfirm' },
    ];
  }
  if (selectedMethod.value === 'restore') {
    return [
      ...base,
      { key: 'seed', titleKey: 'welcome.onboardingStepSeed' },
      { key: 'security', titleKey: 'welcome.onboardingStepSecurity' },
      { key: 'restoreConfirm', titleKey: 'welcome.onboardingStepConfirm' },
    ];
  }
  if (selectedMethod.value === 'pair') {
    return [
      ...base,
      { key: 'device', titleKey: 'welcome.onboardingStepDevice' },
      { key: 'connect', titleKey: 'welcome.onboardingStepConnect' },
      { key: 'review', titleKey: 'welcome.onboardingStepReview' },
    ];
  }
  return base;
});

const onMethodSelect = (m: 'create' | 'restore' | 'pair'): void => {
  selectedMethod.value = m;
  step.value = 2;
};
const onNetworkChange = (n: NetworkInfo): void => {
  selectedNetwork.value = n;
  emit('network-change', n);
};
const onSecuritySelect = (m: 'prf' | 'password', name: string): void => {
  securityMethod.value = m;
  walletName.value = name;
};
const onMnemonicChange = (m: string[]): void => {
  mnemonic.value = m;
};
const onBack = (): void => {
  if (step.value > 1) step.value -= 1;
  else emit('back');
};
</script>
