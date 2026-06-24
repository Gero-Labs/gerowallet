<template>
  <div class="onboarding-wrapper">
    <v-btn text small class="back-to-wallets" @click="$emit('back')">
      <v-icon left size="18">mdi-arrow-left</v-icon>
      {{ $t('welcome.backToWallets') }}
    </v-btn>
    <div class="onboarding-root">
    <!-- LEFT: static step rail card -->
    <v-card class="liquid-glass transparent-override onboarding-rail" flat>
      <ul class="rail-list">
        <li
          v-for="(s, i) in steps"
          :key="`rail-${i}`"
          class="rail-item"
          :class="{
            'rail-item--done': i + 1 < step,
            'rail-item--active': i + 1 === step,
            'rail-item--clickable': i + 1 < step,
          }"
          @click="goToStep(i + 1)"
        >
          <div class="rail-marker-col">
            <div class="rail-marker">
              <v-icon v-if="i + 1 < step" size="18" color="white">mdi-check</v-icon>
              <span v-else>{{ i + 1 }}</span>
            </div>
            <div v-if="i < steps.length - 1" class="rail-connector"></div>
          </div>
          <div class="rail-text">
            <div class="rail-title">{{ $t(s.titleKey) }}</div>
            <div class="rail-subtitle">{{ $t(s.subtitleKey) }}</div>
          </div>
        </li>
      </ul>
    </v-card>

    <!-- RIGHT: active step content card (only the current step is rendered) -->
    <v-card class="liquid-glass transparent-override onboarding-content" flat>
      <div class="content-header">
        <div class="content-eyebrow">{{ $t('welcome.onboardingStepN', { n: step }) }}</div>
        <div class="content-title">{{ $t(currentStep.titleKey) }}</div>
        <div class="content-desc">{{ $t(currentStep.descKey) }}</div>
      </div>
      <div class="content-body">
        <StepStart
          v-if="currentStep.key === 'start'"
          :network="network"
          @change="onNetworkChange"
          @select="onMethodSelect"
          @back="$emit('back')"
        />
        <StepSecurity
          v-else-if="currentStep.key === 'security'"
          :network="network"
          @select="onSecuritySelect"
          @next="step++"
          @back="step--"
        />
        <StepCreateConfirm
          v-else-if="currentStep.key === 'createConfirm'"
          :network="network"
          :security-method="securityMethod"
          :name="walletName"
          @back="step--"
          @created="$emit('back')"
        />
        <StepSeedPhrase
          v-else-if="currentStep.key === 'seed'"
          :network="network"
          @change="onMnemonicChange"
          @next="step++"
          @back="step--"
        />
        <StepRestoreConfirm
          v-else-if="currentStep.key === 'restoreConfirm'"
          :network="network"
          :security-method="securityMethod"
          :name="walletName"
          :mnemonic="mnemonic"
          @back="step--"
          @created="$emit('back')"
        />
        <StepDevice
          v-else-if="currentStep.key === 'device'"
          :network="network"
          @select="onDeviceSelect"
          @next="step++"
          @back="step--"
        />
        <StepConnect
          v-else-if="currentStep.key === 'connect'"
          :network="network"
          :wallet-type="walletType"
          @connected="onConnected"
          @back="step--"
        />
        <StepReview
          v-else-if="currentStep.key === 'review'"
          :network="network"
          :wallet-type="walletType"
          :connection="connection"
          :name="walletName"
          @update:name="walletName = $event"
          @back="step--"
          @created="$emit('back')"
        />
      </div>
    </v-card>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, computed, onUnmounted } from 'vue';
import networks, { NetworkInfo } from '@/utils/networks';
import { updateVuetifyTheme } from '@/plugins/vuetify';
import { generateWalletName } from '@/shared/utils/walletNameGenerator';
import type { WalletTypeValue } from '@/models/types';
import StepStart from './steps/StepStart.vue';
import StepSecurity from './steps/StepSecurity.vue';
import StepCreateConfirm from './steps/StepCreateConfirm.vue';
import StepSeedPhrase from './steps/StepSeedPhrase.vue';
import StepRestoreConfirm from './steps/StepRestoreConfirm.vue';
import StepDevice from './steps/StepDevice.vue';
import StepConnect from './steps/StepConnect.vue';
import StepReview from './steps/StepReview.vue';

interface ConnectionPayload {
  publicKey: string;
  keys: Array<{ publicKey: string; chainCode: string; path: string }>;
  btSupported: boolean;
  xfp?: string;
}

interface StepDef {
  key: string;
  titleKey: string;
  subtitleKey: string;
  descKey: string;
}

// `network` is the single source of truth, owned by Welcome.vue and passed in.
// The network step emits changes up via `network-change`; Welcome updates the
// prop and also drives the background from it.
defineProps<{ network: NetworkInfo }>();
const emit = defineEmits<{ (e: 'back'): void; (e: 'network-change', n: NetworkInfo): void }>();

const step = ref<number>(1);
const selectedMethod = ref<'create' | 'restore' | 'pair' | null>(null);
const securityMethod = ref<'prf' | 'password'>('prf');
const walletName = ref<string>(generateWalletName());
const mnemonic = ref<string[]>([]);
const walletType = ref<WalletTypeValue | undefined>(undefined);
const connection = ref<ConnectionPayload | null>(null);

const steps = computed<StepDef[]>(() => {
  const base: StepDef[] = [
    { key: 'start', titleKey: 'welcome.onboardingStepStart', subtitleKey: 'welcome.onboardingSubStart', descKey: 'welcome.onboardingDescStart' },
  ];
  if (selectedMethod.value === 'create') {
    return [
      ...base,
      { key: 'security', titleKey: 'welcome.onboardingStepSecurity', subtitleKey: 'welcome.onboardingSubSecurity', descKey: 'welcome.onboardingDescSecurity' },
      { key: 'createConfirm', titleKey: 'welcome.onboardingStepConfirm', subtitleKey: 'welcome.onboardingSubConfirm', descKey: 'welcome.onboardingDescCreateConfirm' },
    ];
  }
  if (selectedMethod.value === 'restore') {
    return [
      ...base,
      { key: 'seed', titleKey: 'welcome.onboardingStepSeed', subtitleKey: 'welcome.onboardingSubSeed', descKey: 'welcome.onboardingDescSeed' },
      { key: 'security', titleKey: 'welcome.onboardingStepSecurity', subtitleKey: 'welcome.onboardingSubSecurity', descKey: 'welcome.onboardingDescSecurity' },
      { key: 'restoreConfirm', titleKey: 'welcome.onboardingStepConfirm', subtitleKey: 'welcome.onboardingSubConfirm', descKey: 'welcome.onboardingDescRestoreConfirm' },
    ];
  }
  if (selectedMethod.value === 'pair') {
    return [
      ...base,
      { key: 'device', titleKey: 'welcome.onboardingStepDevice', subtitleKey: 'welcome.onboardingSubDevice', descKey: 'welcome.onboardingDescDevice' },
      { key: 'connect', titleKey: 'welcome.onboardingStepConnect', subtitleKey: 'welcome.onboardingSubConnect', descKey: 'welcome.onboardingDescConnect' },
      { key: 'review', titleKey: 'welcome.onboardingStepReview', subtitleKey: 'welcome.onboardingSubConfirm', descKey: 'welcome.onboardingDescCreateConfirm' },
    ];
  }
  return base;
});

// The currently active step definition. Clamped so it never points past the
// list (the list shrinks/grows when the method changes).
const currentStep = computed<StepDef>(() => steps.value[Math.min(step.value, steps.value.length) - 1]);

const goToStep = (target: number): void => {
  // Only allow navigating BACK to an already-completed step via the rail.
  if (target < step.value) step.value = target;
};

const onMethodSelect = (m: 'create' | 'restore' | 'pair'): void => {
  selectedMethod.value = m;
  mnemonic.value = [];
  connection.value = null;
  walletType.value = undefined;
  // Network + Method share step 1 — method-specific steps start at 2.
  step.value = 2;
};
const onNetworkChange = (n: NetworkInfo): void => {
  emit('network-change', n);
  // If the new network can't pair hardware, drop a stale Pair selection so the
  // user is forced to re-pick a supported method at the Method step.
  if (selectedMethod.value === 'pair' && !n.supportedHardware) {
    selectedMethod.value = null;
  }
};
const onSecuritySelect = (m: 'prf' | 'password', name: string): void => {
  securityMethod.value = m;
  walletName.value = name;
};
const onMnemonicChange = (m: string[]): void => {
  mnemonic.value = m;
};
const onDeviceSelect = (t: WalletTypeValue): void => {
  walletType.value = t;
};
const onConnected = (payload: ConnectionPayload): void => {
  connection.value = payload;
  step.value++;
};

// The network step previews its accent by mutating the global Vuetify theme.
// If onboarding is abandoned (e.g. back to the wallet list), restore the
// default theme so a not-yet-created wallet never leaves the app re-themed.
onUnmounted(() => {
  updateVuetifyTheme(networks.networks[0].blockchain, true);
});
</script>
<style scoped>
.onboarding-wrapper {
  width: 100%;
  max-width: 820px;
  margin: auto;
}

.back-to-wallets {
  margin-bottom: 12px;
  text-transform: none;
  letter-spacing: normal;
  color: #94979c !important;
}

.onboarding-root {
  display: flex;
  gap: 20px;
  width: 100%;
  align-items: stretch;
}

/* LEFT RAIL */
.onboarding-rail {
  flex: 0 0 240px;
  padding: 24px 20px;
  border-radius: 16px !important;
}

.rail-list {
  list-style: none;
  padding: 0;
  margin: 0;
}

.rail-item {
  display: flex;
  gap: 14px;
  align-items: flex-start;
}

.rail-item--clickable {
  cursor: pointer;
}

.rail-marker-col {
  display: flex;
  flex-direction: column;
  align-items: center;
  align-self: stretch;
}

.rail-marker {
  width: 30px;
  height: 30px;
  min-width: 30px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  font-weight: 600;
  background-color: rgba(255, 255, 255, 0.08);
  color: #94979c;
  border: 1px solid rgba(255, 255, 255, 0.12);
  transition: all 0.2s ease;
}

.rail-item--active .rail-marker {
  background-color: var(--v-primary-base);
  color: #fff;
  border-color: var(--v-primary-base);
}

.rail-item--done .rail-marker {
  background-color: var(--v-primary-base);
  color: #fff;
  border-color: var(--v-primary-base);
}

.rail-connector {
  flex: 1;
  width: 2px;
  min-height: 26px;
  margin: 4px 0;
  background-color: rgba(255, 255, 255, 0.12);
}

.rail-item--done .rail-connector {
  background-color: var(--v-primary-base);
}

.rail-text {
  padding-bottom: 22px;
}

.rail-title {
  font-size: 15px;
  font-weight: 600;
  line-height: 1.2;
  color: #fff;
}

.rail-item:not(.rail-item--active):not(.rail-item--done) .rail-title {
  color: #94979c;
}

.rail-subtitle {
  font-size: 12px;
  color: #94979c;
  margin-top: 2px;
}

/* RIGHT CONTENT */
.onboarding-content {
  flex: 1;
  min-width: 0;
  min-height: 440px;
  padding: 24px 28px;
  border-radius: 16px !important;
  display: flex;
  flex-direction: column;
}

.content-header {
  margin-bottom: 20px;
}

.content-eyebrow {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.5px;
  text-transform: uppercase;
  color: #94979c;
}

.content-title {
  font-size: 22px;
  font-weight: 700;
  line-height: 1.2;
  color: #fff;
  margin-top: 2px;
}

.content-desc {
  font-size: 14px;
  line-height: 1.5;
  color: #94979c;
  margin-top: 6px;
}

.content-body {
  flex: 1;
}

@media (max-width: 768px) {
  .onboarding-root {
    flex-direction: column;
  }
  .onboarding-rail {
    flex: 0 0 auto;
  }
}
</style>
