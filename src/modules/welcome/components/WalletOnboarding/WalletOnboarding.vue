<template>
  <div class="onboarding-wrapper">
    <!-- Single content card — only the active step is rendered -->
    <v-card class="liquid-glass transparent-override onboarding-content" flat>
      <div class="content-header">
        <div class="content-header-row">
          <div class="content-title">{{ $t(currentStep.titleKey) }}</div>
          <v-switch
            v-if="currentStep.key === 'start'"
            class="dev-switch ma-0 pa-0"
            :input-value="devMode"
            dense
            inset
            hide-details
            @change="onDevToggle"
          >
            <template v-slot:label>
              <span class="dev-switch__label">{{ $t('welcome.developerNetworks') }}</span>
            </template>
          </v-switch>
        </div>
        <div class="content-desc">{{ $t(currentStep.descKey) }}</div>
      </div>
      <div class="content-body">
        <StepStart class="onboarding-step"
          v-if="currentStep.key === 'start'"
          :network="network"
          :dev-mode="devMode"
          @change="onNetworkChange"
          @select="onMethodSelect"
        />
        <StepSecurity class="onboarding-step"
          v-else-if="currentStep.key === 'security'"
          :network="network"
          @select="onSecuritySelect"
          @next="step++"
          @back="step--"
        />
        <StepCreateConfirm class="onboarding-step"
          v-else-if="currentStep.key === 'createConfirm'"
          :network="network"
          :security-method="securityMethod"
          :name="walletName"
          @back="step--"
        />
        <StepSeedPhrase class="onboarding-step"
          v-else-if="currentStep.key === 'seed'"
          :network="network"
          @change="onMnemonicChange"
          @next="step++"
          @back="step--"
        />
        <StepRestoreConfirm class="onboarding-step"
          v-else-if="currentStep.key === 'restoreConfirm'"
          :network="network"
          :security-method="securityMethod"
          :name="walletName"
          :mnemonic="mnemonic"
          @back="step--"
        />
        <StepDevice class="onboarding-step"
          v-else-if="currentStep.key === 'device'"
          :network="network"
          @select="onDeviceSelect"
          @next="step++"
          @back="step--"
        />
        <StepConnect class="onboarding-step"
          v-else-if="currentStep.key === 'connect'"
          :network="network"
          :wallet-type="walletType"
          @connected="onConnected"
          @back="step--"
        />
        <StepReview class="onboarding-step"
          v-else-if="currentStep.key === 'review'"
          :network="network"
          :wallet-type="walletType"
          :connection="connection"
          :name="walletName"
          @update:name="walletName = $event"
          @back="step--"
        />
      </div>
    </v-card>
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
defineProps<{ network: NetworkInfo; devMode?: boolean }>();
const emit = defineEmits<{
  (e: 'network-change', n: NetworkInfo): void;
  (e: 'update:dev-mode', val: boolean): void;
}>();

const onDevToggle = (val: boolean | null): void => {
  emit('update:dev-mode', !!val);
};

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
  max-width: 720px;
  margin: 0 auto;
  align-self: center; /* vertically centered within the right column */
  display: flex;
  flex-direction: column;
  max-height: calc(100vh - 64px);
}

/* CONTENT */
.onboarding-content {
  width: 100%;
  min-width: 0;
  /* Consistent height across every step; only very tall steps (seed phrase)
     overflow and scroll inside. */
  height: 620px;
  max-height: calc(100vh - 80px);
  padding: 24px 28px;
  border-radius: 16px !important;
  display: flex;
  flex-direction: column;
  overflow: visible;
}

.content-header {
  margin-bottom: 20px;
}

.content-header-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.dev-switch {
  flex: none;
}

.dev-switch__label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
  white-space: nowrap;
}

.dev-switch ::v-deep .v-input--selection-controls__input {
  transform: scale(0.8);
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
  min-height: 0;
  overflow-y: auto;
  overflow-x: visible;
  border-radius: 0;
  padding: 0 2px 4px; /* keep the action button off the scroll-clip edge */
  margin: 0 -2px;
  display: flex;
  flex-direction: column;
}

/* Each step fills the body so its action row pins to the card bottom; tall
   steps grow and the body scrolls. */
.content-body ::v-deep .onboarding-step {
  flex: 1 0 auto;
  min-height: 100%;
  display: flex;
  flex-direction: column;
}

.content-body ::v-deep .onboarding-actions {
  margin-top: auto;
  padding-top: 16px;
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
