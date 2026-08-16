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
        <StepGoogleSignIn class="onboarding-step"
          v-else-if="currentStep.key === 'googleSignin'"
          :network="network"
          @signed-in="onGoogleSignedIn"
          @restore="onGoogleRestoreFromSignin"
          @back="step--"
        />
        <StepGoogleSecure class="onboarding-step"
          v-else-if="currentStep.key === 'googleSecure'"
          :network="network"
          :id-token="googleIdToken"
          :google-picture="googlePicture"
          :google-name="googleName"
          @created="onGoogleCreated"
          @back="step--"
        />
        <StepGoogleBackup class="onboarding-step"
          v-else-if="currentStep.key === 'googleBackup'"
          :network="network"
          :id-token="googleIdToken"
          :wallet-id="googleWalletId"
          :recovery-share="googleRecoveryShare"
          :public-key="googlePublicKey"
          :recovery-password="googleRecoveryPassword"
          @next="step++"
        />
        <StepGoogleConfirm class="onboarding-step"
          v-else-if="currentStep.key === 'googleConfirm'"
          :network="network"
          :name="walletName"
          :email="googleEmail"
          :wallet-id="googleWalletId"
          :id-token="googleIdToken"
          :auth-payload="googleAuthPayload"
        />
        <StepGoogleRestore class="onboarding-step"
          v-else-if="currentStep.key === 'googleRestore'"
          :network="network"
          :prefill-id-token="googleIdToken"
          :prefill-email="googleEmail"
          :prefill-picture="googlePicture"
          :prefill-name="googleName"
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
import { Blockchain, type WalletTypeValue } from '@/models/types';
import StepStart from './steps/StepStart.vue';
import StepSecurity from './steps/StepSecurity.vue';
import StepCreateConfirm from './steps/StepCreateConfirm.vue';
import StepSeedPhrase from './steps/StepSeedPhrase.vue';
import StepRestoreConfirm from './steps/StepRestoreConfirm.vue';
import StepDevice from './steps/StepDevice.vue';
import StepConnect from './steps/StepConnect.vue';
import StepReview from './steps/StepReview.vue';
import StepGoogleSignIn from './steps/StepGoogleSignIn.vue';
import StepGoogleSecure from './steps/StepGoogleSecure.vue';
import StepGoogleBackup from './steps/StepGoogleBackup.vue';
import StepGoogleConfirm from './steps/StepGoogleConfirm.vue';
import StepGoogleRestore from './steps/StepGoogleRestore.vue';
import type { GoogleAuthPayload } from './steps/googleWalletMessages';

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
const selectedMethod = ref<'create' | 'restore' | 'pair' | 'google' | 'googleRestore' | null>(null);
const securityMethod = ref<'prf' | 'password'>('prf');
const walletName = ref<string>(generateWalletName());
const mnemonic = ref<string[]>([]);
const walletType = ref<WalletTypeValue | undefined>(undefined);
const connection = ref<ConnectionPayload | null>(null);

// Google wallet (MPC "Sign in with Google") flow state — never logged.
const googleIdToken = ref<string>('');
const googleEmail = ref<string>('');
const googlePicture = ref<string>('');
const googleName = ref<string>('');
const googleWalletId = ref<number>(0);
const googleRecoveryShare = ref<string>('');
const googlePublicKey = ref<string>('');
const googleAuthPayload = ref<GoogleAuthPayload>({ authMethod: 'password', spendingPassword: '' });
const googleRecoveryPassword = ref<string>('');

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
  if (selectedMethod.value === 'google') {
    return [
      ...base,
      { key: 'googleSignin', titleKey: 'welcome.onboardingStepGoogleSignIn', subtitleKey: 'welcome.onboardingSubGoogleSignIn', descKey: 'welcome.onboardingDescGoogleSignIn' },
      { key: 'googleSecure', titleKey: 'welcome.onboardingStepGoogleSecure', subtitleKey: 'welcome.onboardingSubGoogleSecure', descKey: 'welcome.onboardingDescGoogleSecure' },
      { key: 'googleBackup', titleKey: 'welcome.onboardingStepGoogleBackup', subtitleKey: 'welcome.onboardingSubGoogleBackup', descKey: 'welcome.onboardingDescGoogleBackup' },
      { key: 'googleConfirm', titleKey: 'welcome.onboardingStepConfirm', subtitleKey: 'welcome.onboardingSubConfirm', descKey: 'welcome.onboardingDescCreateConfirm' },
    ];
  }
  if (selectedMethod.value === 'googleRestore') {
    return [
      ...base,
      { key: 'googleRestore', titleKey: 'welcome.onboardingStepGoogleRestore', subtitleKey: 'welcome.onboardingSubGoogleRestore', descKey: 'welcome.onboardingDescGoogleRestore' },
    ];
  }
  return base;
});

// The currently active step definition. Clamped so it never points past the
// list (the list shrinks/grows when the method changes).
const currentStep = computed<StepDef>(() => steps.value[Math.min(step.value, steps.value.length) - 1]);

const onMethodSelect = (m: 'create' | 'restore' | 'pair' | 'google' | 'googleRestore'): void => {
  selectedMethod.value = m;
  mnemonic.value = [];
  connection.value = null;
  walletType.value = undefined;
  // Reset Google flow state on (re)entry so a previous attempt never leaks
  // into a new one (idToken/passwords/recoveryShare are session-scoped only).
  googleIdToken.value = '';
  googleEmail.value = '';
  googleWalletId.value = 0;
  googleRecoveryShare.value = '';
  googlePublicKey.value = '';
  googleAuthPayload.value = { authMethod: 'password', spendingPassword: '' };
  googleRecoveryPassword.value = '';
  // Network + Method share step 1 — method-specific steps start at 2.
  step.value = 2;
};

const onGoogleSignedIn = (payload: { idToken: string; email: string; picture: string; name: string }): void => {
  googleIdToken.value = payload.idToken;
  googleEmail.value = payload.email;
  googlePicture.value = payload.picture;
  googleName.value = payload.name;
  step.value++;
};

/** From the Google create sign-in step: account is enrolled on the backend but has
 *  no wallet on this device → switch to the Google restore flow, carrying the
 *  already-signed-in Google session so the restore step skips a second sign-in. */
const onGoogleRestoreFromSignin = (payload: { idToken: string; email: string; picture: string; name: string }): void => {
  googleIdToken.value = payload.idToken;
  googleEmail.value = payload.email;
  googlePicture.value = payload.picture;
  googleName.value = payload.name;
  selectedMethod.value = 'googleRestore';
  step.value = 2; // googleRestore steps = [start, googleRestore]
};

const onGoogleCreated = (payload: {
  walletId: number;
  recoveryShare: string;
  publicKey: string;
  authPayload: GoogleAuthPayload;
  recoveryPassword: string;
  name: string;
}): void => {
  googleWalletId.value = payload.walletId;
  googleRecoveryShare.value = payload.recoveryShare;
  googlePublicKey.value = payload.publicKey;
  googleAuthPayload.value = payload.authPayload;
  googleRecoveryPassword.value = payload.recoveryPassword;
  walletName.value = payload.name;
  step.value++;
};
const onNetworkChange = (n: NetworkInfo): void => {
  emit('network-change', n);
  // If the new network can't pair hardware, drop a stale Pair selection so the
  // user is forced to re-pick a supported method at the Method step.
  if (selectedMethod.value === 'pair' && !n.supportedHardware) {
    selectedMethod.value = null;
  }
  // Google wallet only reconstructs a Cardano root key today — drop a stale
  // selection if the new network isn't Cardano.
  if ((selectedMethod.value === 'google' || selectedMethod.value === 'googleRestore') && n.blockchain !== Blockchain.CARDANO) {
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
  updateVuetifyTheme(networks.networks[0].blockchain);
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
/* Translucent card: let the animated network background show through the glass.
   Higher specificity + !important to beat the global `.v-card.liquid-glass`
   background; the blur/saturate backdrop is inherited from `.liquid-glass`. */
.v-card.onboarding-content {
  background: rgb(from var(--g-raised) r g b / 0.78) !important;
}

/* Continue CTA (every step): black label on gradient/teal, incl. disabled.
   Hoisted here from the 11 step components so the rule exists once. */
.onboarding-content ::v-deep .onb-continue.v-btn,
.onboarding-content ::v-deep .onb-continue.v-btn.v-btn--disabled {
  color: var(--g-canvas) !important;
}

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
  color: var(--g-text-3);
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

/* A step may opt into an internal scroll (content scrolls, action row stays a
   fixed footer OUTSIDE the scrollbar). Such a step fills the body exactly so the
   outer .content-body never scrolls — the scrollbar lives on .step-scroll and
   covers content only. A step just needs to wrap its content in .step-scroll and
   keep .onboarding-actions as a sibling after it. */
.content-body ::v-deep .onboarding-step:has(.step-scroll) {
  height: 100%;
  min-height: 0;
  flex: 1 1 auto;
}

.content-body ::v-deep .step-scroll {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
}

.content-body ::v-deep .onboarding-step:has(.step-scroll) .onboarding-actions {
  flex-shrink: 0;
  margin-top: 0;
  padding-top: 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

/* Vuetify's .v-btn--block sets `flex: 1 0 auto` (for full-width in a row).
   Inside .onboarding-step (a flex column), that flex-grow:1 makes a block
   button stretch vertically to fill a short step's free space. Pin it to its
   natural height; min-width:100% from --block still gives full width. */
.content-body ::v-deep .onboarding-step .v-btn--block {
  flex: 0 0 auto;
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
