<template>
  <div class="shield-convert-root">
    <BaseDialog
      :isOpen="isOpen"
      @close="onDialogClose"
      :title="t('midnight.shieldConvert.title')"
      :loading="false"
      :min-height="0"
      :subtitle="t('midnight.shieldConvert.subtitle')"
      :persistent="converting"
      :img="assets.swapSvg"
      :width="converting ? 468 : 428"
      imgStyle="filter: brightness(0) saturate(100%) invert(100%) sepia(49%) saturate(2%) hue-rotate(47deg) brightness(118%) contrast(101%);"
    >
      <!-- Stepper indicator — same markup/styling as MidnightSendDialog. Hidden
           while converting; the progress timeline takes over. -->
      <v-card-title v-if="!converting" style="display: block;" class="pa-0">
        <v-stepper v-model="currentStep" flat class="stepper-container" non-linear alt-labels>
          <v-stepper-header>
            <template v-for="(item, index) in steps">
              <div
                class="custom-step"
                :key="item.name"
                :class="{ active: currentStep === index + 1, done: currentStep > index + 1, next: currentStep < index + 1 }"
              >
                <div class="icon-container">
                  <v-icon
                    class="step-icon"
                    :color="currentStep < index + 1 ? 'var(--g-accent)' : 'var(--g-canvas)'"
                    size="16"
                  >{{ currentStep > index + 1 ? 'mdi-check' : 'mdi-circle-medium' }}
                  </v-icon>
                </div>
                <span class="step-label">{{ item.label }}</span>
              </div>
              <div class="divider" :class="{ 'active-divider': currentStep > index + 1 }" :key="index"
                   v-if="index < steps.length - 1"></div>
            </template>
          </v-stepper-header>
        </v-stepper>
      </v-card-title>

      <v-card-text class="convert-dialog-content px-3 pb-0">
        <!-- ── Convert-in-progress: left summary + right stage timeline ──
             Mirrors MidnightSendDialog's progress view (same stage machine,
             since shieldNight() emits the identical stage set as
             sendShieldedNight), simplified for a self-transfer (no
             recipient). -->
        <div v-if="converting" class="scv-progress-view">
          <div class="scv-summary">
            <div class="scv-summary-amount">{{ amount || '0' }} {{ nightCurrency }}</div>
            <div class="scv-summary-direction">
              <v-icon size="12" color="var(--g-accent)" class="mr-1">mdi-shield-lock-outline</v-icon>
              <span>{{ t('midnight.shieldConvert.progressToPrivate') }}</span>
            </div>
            <div v-if="dustBattery" class="scv-summary-dust">
              <div class="scv-summary-dust-head">
                <v-icon size="12" color="var(--g-accent)" class="mr-1">mdi-lightning-bolt</v-icon>
                <span>{{ dustCurrency }}</span>
                <span class="scv-summary-dust-pct">{{ dustBattery.percent }}%</span>
              </div>
              <div class="scv-summary-dust-track">
                <div class="scv-summary-dust-fill" :style="{ width: dustBattery.percent + '%' }"></div>
              </div>
              <div class="scv-summary-dust-note">{{ t('midnight.send.dustResetShort') }}</div>
            </div>
          </div>

          <div class="scv-timeline">
            <div
              v-for="(node, i) in timelineNodes"
              :key="node.key"
              class="scv-node"
              :class="node.state"
            >
              <div class="scv-node-marker">
                <div class="scv-dot">
                  <v-icon v-if="node.state === 'done'" size="13" color="var(--g-surface)">mdi-check</v-icon>
                  <span v-else-if="node.state === 'active'" class="scv-pulse"></span>
                </div>
                <div
                  v-if="i < timelineNodes.length - 1"
                  class="scv-connector"
                  :class="{ filled: node.state === 'done' }"
                ></div>
              </div>
              <div class="scv-node-body">
                <div class="scv-node-label">{{ node.label }}</div>
                <div
                  v-if="node.state === 'active' && node.showBar"
                  class="scv-node-bar"
                  :class="{ indeterminate: node.percent == null || node.percent < 0 }"
                >
                  <div
                    class="scv-node-bar-fill"
                    :style="node.percent != null && node.percent >= 0 ? { width: node.percent + '%' } : {}"
                  ></div>
                </div>
                <div v-if="node.state === 'active' && node.detail" class="scv-node-detail">
                  {{ node.detail }}
                </div>
              </div>
            </div>
          </div>
        </div>

        <CustomStepper v-else :currentStep="currentStep" :steps="steps">
          <!-- ── Step 1: Direction + amount ── -->
          <v-stepper-content step="1">
            <div class="step-amount-wrapper">
              <div class="step-amount-inner" :class="{ shake: shakeError }">
                <!-- Direction toggle: "Make private" (shield) is the only
                     direction implemented yet (ground rule 16 of the
                     shield/unshield plan). "Make public" (unshield) is shown
                     so the option isn't hidden, but stays disabled with a
                     visible "coming soon" caption + tooltip until a real
                     shield has been verified on-chain. -->
                <div class="sc-mode-row">
                  <button type="button" class="sc-mode-card sc-mode-card--active" disabled>
                    <div class="sc-mode-icon"><v-icon size="20">mdi-shield-lock-outline</v-icon></div>
                    <div class="sc-mode-body">
                      <span class="t-body-lg">{{ t('midnight.shieldConvert.makePrivate') }}</span>
                      <p class="t-caption sc-mode-hint">{{ t('midnight.shieldConvert.makePrivateHint') }}</p>
                    </div>
                  </button>

                  <v-tooltip top content-class="custom-tooltip" max-width="240">
                    <template v-slot:activator="{ on, attrs }">
                      <!-- Tooltip activator listeners go on this wrapping span,
                           not the disabled button itself — disabled form
                           controls don't reliably fire hover events. -->
                      <span class="sc-mode-tooltip-wrap" v-bind="attrs" v-on="on">
                        <button type="button" class="sc-mode-card sc-mode-card--disabled" disabled>
                          <div class="sc-mode-icon"><v-icon size="20">mdi-shield-off-outline</v-icon></div>
                          <div class="sc-mode-body">
                            <div class="sc-mode-title-row">
                              <span class="t-body-lg">{{ t('midnight.shieldConvert.makePublic') }}</span>
                              <span class="sc-soon-badge">{{ t('midnight.shieldConvert.comingSoon') }}</span>
                            </div>
                            <p class="t-caption sc-mode-hint">{{ t('midnight.shieldConvert.makePublicHint') }}</p>
                          </div>
                        </button>
                      </span>
                    </template>
                    <span>{{ t('midnight.shieldConvert.makePublicTooltip') }}</span>
                  </v-tooltip>
                </div>

                <!-- Amount card: NIGHT token + source balance | amount + MAX.
                     No recipient field — shield always moves value between
                     the wallet's own two addresses. -->
                <v-form ref="step1FormRef" v-model="step1Valid">
                  <div class="recipient-card mt-3">
                    <div class="token-row">
                      <div class="token-row__left">
                        <v-avatar size="20" class="mr-1">
                          <img :src="midnightLogo" alt="NIGHT" />
                        </v-avatar>
                        <span class="token-ticker">{{ nightCurrency }}</span>
                        <span class="token-balance">
                          {{ t('midnight.shieldConvert.sourceBalanceLabel') }} {{ formattedSourceBalance }}
                        </span>
                      </div>
                      <div class="token-row__right">
                        <v-text-field
                          v-model="amount"
                          type="number"
                          min="0"
                          step="0.000001"
                          outlined
                          dense
                          hide-details="auto"
                          class="amount-input"
                          placeholder="0"
                          :rules="amountRules"
                          :disabled="converting"
                        />
                        <v-btn
                          text
                          x-small
                          color="var(--g-accent)"
                          class="max-btn"
                          :disabled="converting"
                          @click="setMax"
                        >MAX</v-btn>
                      </div>
                    </div>
                  </div>
                </v-form>

                <!-- Global total — identical styling to the send dialog's. -->
                <div v-if="amount && Number(amount) > 0" class="global-total">
                  <div class="global-total__row global-total__fee-row">
                    <span class="global-total__fee-label">{{ t('midnight.send.estimatedNetworkFee') }}</span>
                    <span class="global-total__fee">{{ feeEstimateDisplay }} {{ dustCurrency }}</span>
                  </div>
                  <div class="global-total__row global-total__total-row">
                    <span class="global-total__label">{{ t('common.total') }}</span>
                    <div>
                      <span class="global-total__ada">{{ amount }} {{ nightCurrency }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </v-stepper-content>

          <!-- ── Step 2: Review + auth ── -->
          <v-stepper-content step="2">
            <div class="sc-summary-wrapper">
              <TransactionDetailsCard
                :outputs="reviewOutputs"
                :totals="reviewTotals"
                :unit="nightCurrency"
                :fee-unit="dustCurrency"
                :fee-label="t('midnight.send.estimatedNetworkFee')"
              />
              <!-- Sending registered NIGHT resets its DUST accrual clock —
                   shielding spends the same registered public UTxOs, so the
                   identical caveat applies. Suppressed when the low-DUST
                   warning below is showing (it already carries the reset
                   message). -->
              <div v-if="!isDustLow" class="midnight-dust-note mt-3">
                <v-icon size="14" color="warning" class="mr-1">mdi-information-outline</v-icon>
                <span>{{ t('midnight.send.dustResetWarning') }}</span>
              </div>
              <div
                v-else
                class="midnight-dust-note midnight-dust-note--low mt-3"
              >
                <v-icon size="14" color="error" class="mr-1">mdi-battery-alert-variant-outline</v-icon>
                <span>{{ t('midnight.send.dustLowHint', { percent: dustBattery.percent }) }}</span>
              </div>
            </div>
          </v-stepper-content>
        </CustomStepper>
      </v-card-text>

      <!-- Actions — Continue (step 1) / auth + Convert (step 2) / Back.
           Hidden while converting; the timeline is the only affordance then. -->
      <v-card-actions v-if="!converting" class="convert-dialog-actions" style="flex-flow: column;">
        <div v-if="currentStep === 2">
          <TransactionAuthSection
            :wallet-type="loggedWallet?.type"
            :is-prf-wallet="isPrfWallet"
            :is-signed="false"
            :loading="converting || checkingLocalProver"
            :password="password"
            @update:password="password = $event"
            :password-label="t('send.spendingPassword')"
            :password-rules="passwordRules"
            :submit-text="t('midnight.shieldConvert.signAndConvert')"
            @passkey-prf-output="onPasskeyPrfOutput"
            @passkey-error="onPasskeyError"
            @submit="submitWithPassword"
            button-style="width: 295px; margin-bottom: 1px;"
            button-class="mb-2"
          />
        </div>

        <!-- Local proof server didn't answer its health check: offer the
             two-action fallback instead of a generic error string, same
             pattern as MidnightSendDialog's shielded tab (WP-P5). -->
        <div v-if="localProverUnavailable" class="midnight-info-note midnight-prover-fallback mb-2">
          <v-icon size="14" color="var(--g-text-3)" class="mr-1">mdi-server-network-off</v-icon>
          <div class="midnight-prover-fallback-body">
            <span>{{ proverFallbackText }}</span>
            <div class="midnight-prover-fallback-actions">
              <v-btn text x-small color="var(--g-accent)" @click="openProofServerSettings">
                {{ t('midnight.proofServer.openSettings') }}
              </v-btn>
              <v-btn text x-small color="var(--g-accent)" @click="useCloudForThisTransaction">
                {{ t('midnight.proofServer.useCloudOnce') }}
              </v-btn>
            </div>
          </div>
        </div>

        <div v-if="errorMessage" class="error--text text-caption mb-2 text-center px-3">
          {{ errorMessage }}
        </div>

        <div>
          <v-btn
            text
            @click="prevStep"
            v-if="currentStep > 1"
            class="mr-2"
            :disabled="converting || checkingLocalProver"
          >
            <v-icon small class="mr-1">mdi-arrow-left</v-icon>{{ t('common.back') }}
          </v-btn>
          <v-btn
            v-if="currentStep === 1"
            :class="['continue-button', { shake: shakeError }]"
            @click="nextStep()"
            :disabled="converting"
          >{{ t('common.continue') + ' ' }}
            <v-icon style="color: var(--g-on-grad)!important;" small class="ml-1">mdi-arrow-right</v-icon>
          </v-btn>
          <v-btn
            v-else-if="currentStep === 2 && !isPrfWallet"
            class="continue-button"
            @click="submitWithPassword"
            :disabled="converting || checkingLocalProver"
            :loading="converting || checkingLocalProver"
          >{{ t('midnight.shieldConvert.signAndConvert') }}</v-btn>
        </div>
      </v-card-actions>
    </BaseDialog>

    <!-- First-time-only consent gate for shielded proving — reused, not
         forked (shield's shielded half proves through the identical
         ShieldedWallet pipeline as a plain shielded send). `provider` names
         the actual witness destination (Gero Cloud vs Arkhia zkPaaS). -->
    <ShieldedProvingConsentDialog
      :is-open="consentDialogOpen"
      :provider="consentProvider"
      @close="onConsentClose"
      @accepted="onConsentAccepted"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import CustomStepper from '@/shared/components/CustomStepper.vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import TransactionDetailsCard, {
  type TxDetailsOutput,
  type TxDetailsTotals,
} from '@/shared/components/TransactionDetailsCard.vue';
import ShieldedProvingConsentDialog from '@/modules/dashboard/dialogs/ShieldedProvingConsentDialog.vue';
import midnightLogo from '@/assets/svg/midnight.svg';
import { useTranslation } from '@/shared/composables/useTranslation';
import { settingsNavRequest } from '@/shared/composables/useGlobalSearch';
import {
  midnightStore,
  SHIELDED_PROVING_CONSENT_VERSION,
} from '@/stores/midnightStore';
import type { MidnightSendStage } from '@/services/midnight-tx.service';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network, WalletType } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { debugLog } from '@/utils/debug';
import rules from '@/utils/rules';
import assets from '@/utils/assets';

interface Props {
  isOpen: boolean;
}
defineProps<Props>();
const emit = defineEmits(['close']);

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

const isPrfWallet = computed(() =>
  loggedWallet.value?.type === WalletType.Normal && !!loggedWallet.value?.webAuthnCredentialId
);
const isMainnet = computed(() => loggedWallet.value?.network === Network.MAINNET);
const nightCurrency = computed(() => (isMainnet.value ? 'NIGHT' : 'tNIGHT'));
const dustCurrency = computed(() => (isMainnet.value ? 'DUST' : 'tDUST'));

// Two-step flow mirroring MidnightSendDialog: amount → summary.
const steps = ref([
  { name: 'amount', label: t('midnight.shieldConvert.stepAmount') },
  { name: 'summary', label: t('wallet.summary') },
]);
const currentStep = ref(1);
const shakeError = ref(false);

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);

// MAX = the SOURCE pool's balance. Shielding is the only direction
// implemented yet (ground rule 16 of the shield/unshield plan), so this is
// always the public balance — it becomes a mode-dependent lookup once
// unshield is wired.
const sourceBalance = computed(() => midnightStore.balances?.nightUnshielded ?? 0n);

const formattedSourceBalance = computed(() => {
  const value = sourceBalance.value;
  const whole = value / NIGHT_DIVISOR;
  const remainder = value % NIGHT_DIVISOR;
  const remainderStr = remainder.toString().padStart(NIGHT_DIVISOR.toString().length - 1, '0');
  const fraction = remainderStr.slice(0, 2).padEnd(2, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
});

// Network fees on Midnight are paid in DUST and are negligible. Same
// conservative display as MidnightSendDialog — the real DUST fee is only
// known post-auth, computed during the BG dust-balance step.
const feeEstimateDisplay = '< 0.000001';

const step1FormRef = ref<{ validate: () => boolean } | null>(null);
const step1Valid = ref(false);
const amount = ref('');
const password = ref('');
const converting = ref(false);
const errorMessage = ref<string | null>(null);

// ── Convert progress timeline ──
// shieldNight() emits the exact same stage set as sendShieldedNight (its
// shielded half proves through the identical ShieldedWallet pipeline), so
// the stage machine here mirrors MidnightSendDialog's verbatim.
type ConvertStageOrIdle = MidnightSendStage | 'idle';
const convertStage = ref<ConvertStageOrIdle>('idle');

const STAGE_RANK: Record<ConvertStageOrIdle, number> = {
  idle: 0, authorizing: 1, building: 2, working: 3, provingLocal: 3, provingZkpaas: 3, submitting: 4, done: 5,
};

interface TimelineNode {
  key: string;
  label: string;
  state: 'pending' | 'active' | 'done';
  showBar?: boolean;
  percent?: number | null;
  detail?: string;
}

const timelineNodes = computed<TimelineNode[]>(() => {
  const s = convertStage.value;
  const rank = STAGE_RANK[s] ?? 0;
  const prog = midnightStore.sendProgress;
  const pct = prog && prog.phase === 'syncingDust' ? prog.percent : null;
  const syncDone = pct != null && pct >= 100;
  const syncActive = s === 'working' && !syncDone;
  const signActive = s === 'working' && syncDone;
  const provingActive = s === 'provingLocal' || s === 'provingZkpaas';
  const provingLabel = s === 'provingZkpaas'
    ? t('midnight.send.stageProvingZkpaas')
    : t('midnight.send.stageProvingLocal');

  return [
    {
      key: 'authorize',
      label: t('midnight.send.stageAuthorize'),
      state: s === 'authorizing' ? 'active' : rank > 1 ? 'done' : 'pending',
    },
    {
      key: 'build',
      label: t('midnight.send.stageBuild'),
      state: s === 'building' ? 'active' : rank > 2 ? 'done' : 'pending',
    },
    {
      key: 'sync',
      label: provingActive ? provingLabel : t('midnight.send.stageSync'),
      state: rank > 3 || signActive ? 'done' : (syncActive || provingActive) ? 'active' : 'pending',
      showBar: true,
      percent: provingActive ? null : (syncActive ? pct : undefined),
      detail: syncActive ? prog?.detail : undefined,
    },
    {
      key: 'sign',
      label: t('midnight.send.stageSign'),
      state: rank > 3 ? 'done' : signActive ? 'active' : 'pending',
    },
    {
      key: 'submit',
      label: t('midnight.send.stageSubmit'),
      state: s === 'submitting' ? 'active' : s === 'done' ? 'done' : 'pending',
    },
  ];
});

// Compact DUST battery for the progress summary, same as MidnightSendDialog.
const dustBattery = computed<{ percent: number } | null>(() => {
  const ds = midnightStore.dustState;
  if (!ds || ds.cap <= 0n) return null;
  const raw = Number((ds.current * 10000n) / ds.cap) / 100;
  return { percent: Math.max(0, Math.min(100, Math.round(raw))) };
});
const isDustLow = computed(() => !!dustBattery.value && dustBattery.value.percent < 20);

const consentDialogOpen = ref(false);
const pendingCredentials = ref<{ password?: string; prfSecret?: Uint8Array } | null>(null);

// ── Wallet-side proof-server routing (mirrors MidnightSendDialog's WP-P5
// flow, covering both local docker and Arkhia zkPaaS) ──
const checkingLocalProver = ref(false);
const localProverUnavailable = ref(false);
const forceRemoteForNextSend = ref(false);
// Which remote prover the consent dialog is about when it opens — set at
// each open site (zkpaas for a first zkPaaS convert, cloud everywhere else,
// including the one-off "use Gero Cloud" fallback).
const consentProvider = ref<'cloud' | 'zkpaas'>('cloud');
// Fallback-note copy tracks the mode that failed its preflight.
const proverFallbackText = computed(() => (
  midnightStore.proofServer.mode === 'zkpaas'
    ? t('midnight.proofServer.zkpaasNotReachableSend')
    : t('midnight.proofServer.notDetectedSend')
));

const passwordRules = [rules.required()];

const amountRules = computed(() => [
  (v: string) => !!v || t('midnight.send.amountRequired'),
  (v: string) => {
    const n = Number(v);
    return (Number.isFinite(n) && n > 0) || t('send.amountMustBePositive');
  },
  (v: string) => parseAmount(v) <= sourceBalance.value || t('errors.insufficientBalance'),
]);

function parseAmount(input: string): bigint {
  if (!input) return 0n;
  const [whole = '0', fractionRaw = ''] = input.trim().split('.');
  const fraction = (fractionRaw + '0'.repeat(MIDNIGHT_DECIMALS.NIGHT))
    .slice(0, MIDNIGHT_DECIMALS.NIGHT);
  try { return BigInt(whole) * NIGHT_DIVISOR + BigInt(fraction || '0'); }
  catch { return 0n; }
}

function setMax() {
  const value = sourceBalance.value;
  const whole = value / NIGHT_DIVISOR;
  const remainder = value % NIGHT_DIVISOR;
  const remainderStr = remainder.toString().padStart(NIGHT_DIVISOR.toString().length - 1, '0');
  amount.value = remainder === 0n ? whole.toString() : `${whole}.${remainderStr.replace(/0+$/, '')}`;
}

// ── Review-step model (fed to the shared TransactionDetailsCard) ──
function truncate(addr: string): string {
  if (!addr) return '';
  return addr.length <= 20 ? addr : `${addr.slice(0, 12)}…${addr.slice(-6)}`;
}

// Destination is always the wallet's OWN shielded address — shield never
// moves value to a third party.
const destinationAddress = computed(() => midnightStore.addresses?.shielded ?? '');

const reviewOutputs = computed<TxDetailsOutput[]>(() => [
  {
    kind: 'own',
    truncatedAddress: truncate(destinationAddress.value),
    ada: amount.value || '0',
  },
]);

// isInternal: true — a shield conversion always moves value between the
// wallet's own two pools, so the shared card's "Internal transfer" banner
// applies unconditionally here (unlike the send dialog, where it depends on
// whether the recipient happens to be one of the wallet's own addresses).
const reviewTotals = computed<TxDetailsTotals>(() => ({
  totalSendingAda: amount.value || '0',
  feeAda: feeEstimateDisplay,
  youPayAda: amount.value || '0',
  isInternal: true,
}));

// ── Step navigation ──
function nextStep() {
  errorMessage.value = null;
  if (currentStep.value === 1) {
    if (!step1FormRef.value?.validate()) {
      shakeError.value = true;
      setTimeout(() => { shakeError.value = false; }, 400);
      return;
    }
    currentStep.value = 2;
  }
}

function prevStep() {
  errorMessage.value = null;
  localProverUnavailable.value = false;
  currentStep.value = 1;
}

function preflight(): boolean {
  errorMessage.value = null;
  if (loggedWallet.value?.chain !== Blockchain.MIDNIGHT) {
    errorMessage.value = 'Not a Midnight wallet';
    return false;
  }
  return true;
}

function hasFreshConsent(): boolean {
  const consent = midnightStore.shieldedProvingConsent;
  return !!consent && consent.version === SHIELDED_PROVING_CONSENT_VERSION;
}

async function submitWithPassword() {
  if (!preflight() || isPrfWallet.value) return;
  await routeConvert({ password: password.value });
}

async function onPasskeyPrfOutput(prfBytes: Uint8Array) {
  if (!preflight() || !isPrfWallet.value) return;
  await routeConvert({ prfSecret: prfBytes });
}

function onPasskeyError(error: Error) {
  errorMessage.value = error?.message || 'PassKey authentication failed';
}

// Shield always proves through the shielded pipeline — same routing rule as
// MidnightSendDialog's shielded tab (routeSend): local mode skips cloud
// consent entirely (witness data never leaves the machine) and goes
// straight to a health preflight; remote mode requires fresh consent first;
// Arkhia zkPaaS requires the same consent as remote AND a preflight.
async function routeConvert(credentials: { password?: string; prfSecret?: Uint8Array }) {
  const mode = midnightStore.proofServer.mode;
  if (mode === 'local') {
    await routeWalletProvedConvert(credentials);
    return;
  }
  if (hasFreshConsent()) {
    if (mode === 'zkpaas') {
      await routeWalletProvedConvert(credentials);
      return;
    }
    await doConvert(credentials);
    return;
  }
  pendingCredentials.value = credentials;
  consentProvider.value = mode === 'zkpaas' ? 'zkpaas' : 'cloud';
  consentDialogOpen.value = true;
}

/**
 * Wallet-side (local or zkPaaS) routing: preflight the selected proof
 * server before ever touching the "converting" overlay — mirrors
 * MidnightSendDialog.routeWalletProvedShielded exactly. Target resolution
 * lives in the tx service so dialog and send can never disagree.
 */
async function routeWalletProvedConvert(credentials: { password?: string; prfSecret?: Uint8Array }) {
  errorMessage.value = null;
  localProverUnavailable.value = false;
  checkingLocalProver.value = true;
  try {
    const { checkWalletProvingPreflight } = await import('@/services/midnight-tx.service');
    const ok = await checkWalletProvingPreflight(loggedWallet.value?.network ?? '');
    if (!ok) {
      pendingCredentials.value = credentials;
      localProverUnavailable.value = true;
      return;
    }
  } finally {
    checkingLocalProver.value = false;
  }
  await doConvert(credentials);
}

/** "Open settings" fallback — navigates to Settings > Advanced (Midnight
 * proof server section), same decoupled channel GlobalSearch uses. */
function openProofServerSettings() {
  settingsNavRequest.value = { tab: 'advanced' };
}

/** "Use Gero Cloud for this transaction" fallback — sends this one
 * conversion via the remote path without changing the user's stored
 * `proofServer.mode`. Mirrors MidnightSendDialog's identical fallback. */
function useCloudForThisTransaction() {
  const credentials = pendingCredentials.value;
  if (!credentials) return;
  localProverUnavailable.value = false;
  forceRemoteForNextSend.value = true;
  if (hasFreshConsent()) {
    pendingCredentials.value = null;
    void doConvert(credentials);
    return;
  }
  // The fallback always goes to Gero Cloud (even from zkpaas mode), so the
  // consent copy must say Gero Cloud.
  consentProvider.value = 'cloud';
  consentDialogOpen.value = true;
}

function onConsentClose() {
  consentDialogOpen.value = false;
  pendingCredentials.value = null;
  forceRemoteForNextSend.value = false;
}

async function onConsentAccepted() {
  consentDialogOpen.value = false;
  const credentials = pendingCredentials.value;
  pendingCredentials.value = null;
  if (!credentials) return;
  // A freshly-consented zkPaaS convert still needs its preflight; the
  // one-off "use Gero Cloud" fallback (forceRemoteForNextSend) goes
  // straight to the remote path instead — doConvert consumes that flag.
  if (!forceRemoteForNextSend.value && midnightStore.proofServer.mode === 'zkpaas') {
    await routeWalletProvedConvert(credentials);
    return;
  }
  await doConvert(credentials);
}

async function doConvert(credentials: { password?: string; prfSecret?: Uint8Array }) {
  const wallet = loggedWallet.value;
  if (!wallet) return;
  const forceRemote = forceRemoteForNextSend.value;
  forceRemoteForNextSend.value = false;
  localProverUnavailable.value = false;
  converting.value = true;
  convertStage.value = 'authorizing';
  try {
    const { shieldNight } = await import('@/services/midnight-tx.service');
    const result = await shieldNight(
      wallet.network,
      parseAmount(amount.value),
      credentials,
      'InBlock',
      (stage) => { convertStage.value = stage; },
      forceRemote,
    );
    debugLog('🌙 Midnight shield conversion submitted:', result.txHash, 'status:', result.status);
    void addOptimisticPendingTx(result.txHash);
    await new Promise((r) => setTimeout(r, 550));
    resetForm();
    emit('close');
  } catch (e) {
    // Named rather than instanceof-checked — same reasoning as
    // MidnightSendDialog.sendShielded: ProofServerUnreachableError is
    // reached via a dynamic import.
    if (e instanceof Error && e.name === 'ProofServerUnreachableError') {
      pendingCredentials.value = credentials;
      localProverUnavailable.value = true;
    } else {
      errorMessage.value = e instanceof Error ? e.message : String(e);
    }
  } finally {
    converting.value = false;
    convertStage.value = 'idle';
  }
}

// Insert the just-submitted tx into history immediately (gero-sync backfills
// the confirmed entry). isShielded=true — the resulting output IS a
// shielded note. A distinct 'shield' history type/icon (vs. the generic
// shielded-send rendering this currently gets) is WP-SH5's job, sequenced
// deliberately after this WP — see the shield/unshield plan section 3.
async function addOptimisticPendingTx(hash: string) {
  const amountBig = parseAmount(amount.value);
  const destination = destinationAddress.value;
  try {
    const { addPendingMidnightTx } = await import('@/services/midnight-tx.service');
    await addPendingMidnightTx(hash, amountBig, destination, true);
  } catch {
    /* non-fatal — gero-sync backfills the confirmed entry */
  }
}

// Block dismissal while a conversion is running (the BG work continues even
// if the UI closes, so keep the timeline visible until it resolves).
function onDialogClose() {
  if (converting.value) return;
  localProverUnavailable.value = false;
  pendingCredentials.value = null;
  forceRemoteForNextSend.value = false;
  emit('close');
}

function resetForm() {
  amount.value = '';
  password.value = '';
  currentStep.value = 1;
  convertStage.value = 'idle';
  localProverUnavailable.value = false;
  forceRemoteForNextSend.value = false;
}

// Reset the error message on every step change.
watch(
  () => currentStep.value,
  () => { errorMessage.value = null; },
);
</script>

<style scoped>
/* ─── Content / stepper / total / buttons — copied verbatim from
   MidnightSendDialog so this dialog reads as part of the same family. ─── */
.convert-dialog-content {
  z-index: 1;
  max-height: 500px;
  overflow-y: auto;
  overflow-x: hidden;
}

.step-amount-wrapper {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
}

.step-amount-inner {
  width: 100%;
  min-width: 340px;
  max-height: 480px;
  overflow-y: auto;
  overflow-x: hidden;
}

.global-total {
  padding: 10px 12px;
  margin-top: 4px;
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}

.global-total__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.global-total__label {
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-2);
}

.global-total__ada {
  font-size: 14px;
  font-weight: 600;
  color: var(--g-accent);
}

.global-total__fee-row {
  margin-bottom: 4px;
}

.global-total__total-row {
  padding-top: 6px;
  border-top: 1px solid var(--g-hairline-1);
}

.global-total__fee-label {
  font-size: 11px;
  color: var(--g-text-3);
}

.global-total__fee {
  font-size: 11px;
  color: var(--g-error) !important;
}

.convert-dialog-actions {
  text-align: center;
  justify-content: center;
}

.continue-button {
  background: var(--g-grad);
  color: var(--g-on-grad);
}
.continue-button:disabled {
  opacity: 0.5;
  color: var(--g-on-grad) !important;
}

.stepper-container {
  background-color: transparent;
}
.stepper-container :deep(.v-stepper__header) {
  box-shadow: none;
}
.stepper-container .custom-step {
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  padding: 2px;
  width: 68px;
}
.stepper-container .custom-step.active .icon-container {
  box-shadow: 0 0 0 4px color-mix(in srgb, var(--g-accent) 15%, transparent);
}
.stepper-container .custom-step.next .icon-container {
  background-color: var(--g-raised);
}
.stepper-container .custom-step .icon-container {
  background-color: var(--g-accent);
  border-radius: 50%;
  display: flex;
  justify-content: center;
  align-items: center;
  height: 20px;
  width: 20px;
  padding-left: 1px;
}
.stepper-container .step-label {
  margin-top: 4px;
  font-size: 12px;
  line-height: 16px;
  text-align: center;
  font-weight: 600;
  color: var(--g-text-2);
}
.stepper-container .divider {
  flex: 1;
  height: 2px;
  width: 100%;
  margin-left: -38px;
  margin-right: -38px;
  margin-top: 11px;
  background-color: var(--g-raised);
}
.stepper-container .divider.active-divider {
  background-color: var(--g-accent);
}
:deep(.v-stepper__content) {
  padding: 0;
}

.shake {
  animation: shake 0.4s ease-in-out;
}
@keyframes shake {
  0%, 100% { transform: translateX(0); }
  20%, 60% { transform: translateX(-4px); }
  40%, 80% { transform: translateX(4px); }
}

/* ─── Amount card — copied from MidnightSendDialog's recipient-card /
   asset row (minus the address input, no recipient here). ─── */
.recipient-card {
  background-color: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  padding: 12px;
}

.token-row {
  display: flex;
  align-items: center;
  background: var(--g-raised);
  border-radius: var(--g-r-control);
  padding: 6px 10px;
  gap: 6px;
}
.token-row__left {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  min-width: 0;
}
.token-ticker {
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-1);
  white-space: nowrap;
}
.token-balance {
  font-size: 11px;
  color: var(--g-text-3);
  margin-left: 6px;
  white-space: nowrap;
}
.token-row__right {
  display: flex;
  align-items: center;
  flex: 1;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
}
.amount-input {
  max-width: 140px;
  flex-shrink: 1;
}
.amount-input :deep(.v-input__slot) {
  background-color: transparent !important;
  border: none !important;
  min-height: 28px !important;
  padding: 0 4px !important;
}
.amount-input :deep(input) {
  text-align: right;
  font-size: 14px;
  font-weight: 500;
  color: var(--g-text-1);
  padding: 0;
}
.amount-input :deep(input::-webkit-outer-spin-button),
.amount-input :deep(input::-webkit-inner-spin-button) {
  -webkit-appearance: none;
  margin: 0;
}
.amount-input :deep(input[type='number']) {
  -moz-appearance: textfield;
}
.amount-input :deep(fieldset) {
  border: none !important;
}
.max-btn {
  text-transform: none !important;
  letter-spacing: 0 !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  min-width: 0 !important;
  padding: 0 4px !important;
  height: 22px !important;
}

/* ─── Direction toggle — stacked full-width rows, not a 2-up grid: at this
   dialog's 428px width a side-by-side pair leaves each card only ~130px of
   body for icon + title + "Coming soon" badge, which forced the badge past
   the card edge into .convert-dialog-content's overflow-x: hidden and hard-
   clipped it instead of wrapping. Full width gives title + badge + hint room
   to lay out normally; .sc-mode-title-row still wraps as a backstop for
   longer translations. ─── */
.sc-mode-row {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.sc-mode-tooltip-wrap {
  display: flex;
  width: 100%;
}
.sc-mode-card {
  display: flex;
  align-items: flex-start;
  width: 100%;
  min-width: 0;
  gap: var(--g-s-2);
  text-align: left;
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: var(--g-s-3);
  font: inherit;
  color: inherit;
}
.sc-mode-card--active {
  border-color: var(--g-accent);
  background: var(--g-raised);
  opacity: 1;
}
.sc-mode-card--disabled {
  opacity: 0.6;
}
.sc-mode-icon {
  flex: none;
  width: 30px;
  height: 30px;
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--g-text-2);
}
.sc-mode-card--active .sc-mode-icon {
  color: var(--g-accent);
}
.sc-mode-body {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.sc-mode-title-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  row-gap: 4px;
  column-gap: var(--g-s-1);
}
.sc-mode-hint {
  margin-top: 2px;
  margin-bottom: 0;
}
.sc-soon-badge {
  flex: none;
  font-size: 10px;
  font-weight: 600;
  color: var(--g-text-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-pill);
  padding: 1px 6px;
}

.sc-summary-wrapper {
  padding: 8px 0 4px;
}
.midnight-dust-note {
  display: flex;
  align-items: flex-start;
  gap: 2px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--g-warning);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  border-radius: var(--g-r-control);
  padding: 8px 10px;
}
.midnight-dust-note--low {
  color: var(--g-error);
  background: var(--g-error-fill);
  border-color: var(--g-error-line);
}
.midnight-info-note {
  display: flex;
  align-items: flex-start;
  gap: 2px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--g-text-2);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  padding: 8px 10px;
}
.midnight-prover-fallback-body {
  display: flex;
  flex-direction: column;
  gap: 4px;
  flex: 1;
  min-width: 0;
}
.midnight-prover-fallback-actions {
  display: flex;
  gap: 4px;
  flex-wrap: wrap;
  margin-top: 2px;
}

/* ─── Convert-progress timeline (mirrors MidnightSendDialog's .mpv-*) ─── */
.scv-progress-view {
  display: flex;
  gap: 16px;
  padding: 14px 4px 18px;
  min-height: 230px;
  animation: scv-fade 0.3s ease;
}
@keyframes scv-fade {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

.scv-summary {
  width: 150px;
  flex-shrink: 0;
  border-right: 1px solid var(--g-hairline-1);
  padding-right: 14px;
}
.scv-summary-amount {
  font-size: 20px;
  font-weight: 700;
  color: var(--g-accent);
  line-height: 1.2;
  word-break: break-word;
}
/* The label wraps to two lines in this 150px column, so the icon anchors to
   the FIRST text line (flex-start + optical nudge) instead of floating
   vertically centered against the wrapped block, which read as broken. */
.scv-summary-direction {
  margin-top: 5px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--g-text-2);
  display: flex;
  align-items: flex-start;
}
.scv-summary-direction .v-icon {
  margin-top: 2px;
}
.scv-summary-dust {
  margin-top: 16px;
}
.scv-summary-dust-head {
  display: flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--g-text-2);
}
.scv-summary-dust-pct {
  margin-left: auto;
  color: var(--g-accent);
}
.scv-summary-dust-track {
  margin-top: 5px;
  height: 4px;
  border-radius: 4px;
  background: var(--g-hairline-1);
  overflow: hidden;
}
.scv-summary-dust-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--g-accent);
  transition: width 0.45s ease;
}
.scv-summary-dust-note {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--g-warning);
}

.scv-timeline {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.scv-node {
  display: flex;
  gap: 12px;
  min-height: 54px;
}
.scv-node:last-child {
  min-height: auto;
}
.scv-node-marker {
  display: flex;
  flex-direction: column;
  align-items: center;
}
.scv-dot {
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--g-raised);
  transition: background-color 0.35s ease, box-shadow 0.35s ease;
}
.scv-node.done .scv-dot {
  background: var(--g-accent);
}
.scv-node.active .scv-dot {
  background: transparent;
  box-shadow: 0 0 0 2px var(--g-accent);
}
.scv-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--g-accent);
  animation: scv-pulse 1.2s ease-in-out infinite;
}
@keyframes scv-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.55); opacity: 0.5; }
}
.scv-connector {
  width: 2px;
  flex: 1;
  min-height: 20px;
  margin: 3px 0;
  background: var(--g-raised);
  transition: background-color 0.4s ease;
}
.scv-connector.filled {
  background: var(--g-accent);
}
.scv-node-body {
  flex: 1;
  min-width: 0;
  padding-top: 2px;
}
.scv-node-label {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-3);
  transition: color 0.3s ease;
}
.scv-node.active .scv-node-label {
  color: var(--g-text-1);
}
.scv-node.done .scv-node-label {
  color: var(--g-text-2);
}
.scv-node-bar {
  margin-top: 7px;
  height: 4px;
  max-width: 190px;
  border-radius: 4px;
  background: var(--g-hairline-1);
  overflow: hidden;
}
.scv-node-bar-fill {
  height: 100%;
  width: 0;
  border-radius: 4px;
  background: var(--g-accent);
  transition: width 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}
.scv-node-bar.indeterminate .scv-node-bar-fill {
  width: 40%;
  animation: scv-indet 1.1s ease-in-out infinite;
}
@keyframes scv-indet {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(320%); }
}
.scv-node-detail {
  margin-top: 5px;
  font-size: 11px;
  color: var(--g-text-3);
}
</style>
