<template>
  <div class="midnight-send-root">
    <BaseDialog
      :isOpen="isOpen"
      @close="emit('close')"
      :title="t('wallet.quickSend')"
      :loading="sending"
      :min-height="0"
      :subtitle="t('wallet.quickSendSubtitle', { currency: nightCurrency })"
      :persistent="false"
      :img="assets.sendSvg"
      :width="428"
      imgStyle="filter: brightness(0) saturate(100%) invert(100%) sepia(49%) saturate(2%) hue-rotate(47deg) brightness(118%) contrast(101%);"
    >
      <!-- Stepper indicator — identical markup/styling to the Cardano SendDialog. -->
      <v-card-title style="display: block;" class="pa-0">
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
                    :color="currentStep < index + 1 ? '#00dff3' : '#0f0f0f'"
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

      <v-card-text class="send-dialog-content px-3 pb-0">
        <CustomStepper :currentStep="currentStep" :steps="steps">
          <!-- ── Step 1: Recipient + amount ── -->
          <v-stepper-content step="1">
            <div class="step-recipients-wrapper">
              <div class="step-recipients-inner" :class="{ shake: shakeError }">
                <!-- Tab toggle: unshielded ↔ shielded (only when a viewing key exists). -->
                <v-tabs
                  v-if="shieldedAvailable"
                  v-model="activeTab"
                  background-color="transparent"
                  centered
                  grow
                  hide-slider
                  class="mb-3 midnight-send-tabs"
                >
                  <v-tab :disabled="sending" class="midnight-send-tab">
                    {{ t('midnight.send.tabUnshielded') }}
                  </v-tab>
                  <v-tab :disabled="sending" class="midnight-send-tab">
                    {{ t('midnight.send.tabShielded') }}
                  </v-tab>
                </v-tabs>

                <!-- Recipient card — same panel + address-field + pill asset-row
                     layout as the Cardano SendRecipientCard, adapted to a single
                     NIGHT recipient (no ADA-Handle / NFT / multi-recipient). -->
                <v-form ref="step1FormRef" v-model="step1Valid">
                  <div class="recipient-card">
                    <div class="address-row">
                      <v-text-field
                        v-model="recipient"
                        :placeholder="recipientPlaceholder"
                        outlined
                        dense
                        hide-details="auto"
                        class="address-input"
                        :rules="addressRules"
                        :disabled="sending"
                        color="#00DFF3"
                      >
                        <template v-slot:append>
                          <v-icon
                            v-if="recipient"
                            style="font-size: 14px; cursor: pointer; opacity: 0.6;"
                            color="white"
                            @click="recipient = ''"
                          >mdi-close</v-icon>
                        </template>
                      </v-text-field>
                      <v-btn
                        icon
                        small
                        class="address-row__icon-btn"
                        :disabled="sending"
                        @click="qrScanDialog = true"
                      >
                        <v-icon small color="#00DFF3">mdi-qrcode</v-icon>
                      </v-btn>
                      <QRAddressScannerDialog
                        :isOpen="qrScanDialog"
                        :chain="loggedWallet && loggedWallet.chain"
                        :network="loggedWallet && loggedWallet.network"
                        @close="qrScanDialog = false"
                        @scan="onQRScan"
                      />
                    </div>

                    <!-- Asset row: NIGHT token + balance | amount + MAX -->
                    <div class="assets-section">
                      <div class="token-row">
                        <div class="token-row__left">
                          <v-avatar size="20" class="mr-1">
                            <img :src="midnightLogo" alt="NIGHT" />
                          </v-avatar>
                          <span class="token-ticker">{{ nightCurrency }}</span>
                          <v-icon
                            x-small
                            color="#00DFF3"
                            class="ml-1"
                            style="margin-top: -1px; font-size: 10px;"
                          >mdi-check-decagram</v-icon>
                          <span class="token-balance">
                            <template v-if="isShielded">{{ t('midnight.send.shieldedBalanceUnavailable') }}</template>
                            <template v-else>{{ formattedAvailable }}</template>
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
                            :disabled="sending"
                          />
                          <v-btn
                            v-if="!isShielded"
                            text
                            x-small
                            color="#00DFF3"
                            class="max-btn"
                            :disabled="sending"
                            @click="setMax"
                          >MAX</v-btn>
                        </div>
                      </div>
                      <div v-if="isShielded" class="token-info">
                        <v-icon x-small color="#FEC84B" class="mr-1">mdi-information-outline</v-icon>
                        {{ t('midnight.send.shieldedBalanceHint') }}
                      </div>
                    </div>
                  </div>
                </v-form>

                <!-- Global total — identical styling to the Cardano step-1 total. -->
                <div v-if="amount && Number(amount) > 0" class="global-total">
                  <div class="global-total__row global-total__fee-row">
                    <span class="global-total__fee-label">{{ t('signTx.networkFee') }}</span>
                    <span class="global-total__fee">{{ feeEstimateDisplay }} {{ dustCurrency }}</span>
                  </div>
                  <div class="global-total__row global-total__total-row">
                    <span class="global-total__label">{{ t('common.total') }}</span>
                    <div>
                      <span class="global-total__ada">{{ amount }} {{ nightCurrency }}</span>
                    </div>
                  </div>
                </div>

                <div v-if="!shieldedAvailable" class="text-caption text--secondary text-center mt-3">
                  {{ t('midnight.shieldedSendComingNote') }}
                </div>
              </div>
            </div>
          </v-stepper-content>

          <!-- ── Step 2: Summary + auth ── -->
          <v-stepper-content step="2">
            <div class="midnight-summary-wrapper">
              <TransactionDetailsCard
                :outputs="reviewOutputs"
                :totals="reviewTotals"
                :unit="nightCurrency"
                :fee-unit="dustCurrency"
              />
              <!-- Sending registered NIGHT resets its DUST accrual clock. -->
              <div v-if="!isShielded" class="midnight-dust-note mt-3">
                <v-icon size="14" color="#FEC84B" class="mr-1">mdi-information-outline</v-icon>
                <span>{{ t('midnight.send.dustResetWarning') }}</span>
              </div>
            </div>
          </v-stepper-content>
        </CustomStepper>
      </v-card-text>

      <!-- Actions — Continue (step 1) / auth + Sign (step 2) / Back. -->
      <v-card-actions class="send-dialog-actions" style="flex-flow: column;">
        <div v-if="currentStep === 2">
          <TransactionAuthSection
            :wallet-type="loggedWallet?.type"
            :is-prf-wallet="isPrfWallet"
            :is-signed="false"
            :loading="sending"
            :password="password"
            @update:password="password = $event"
            :password-label="t('common.spendingPassword')"
            :password-rules="passwordRules"
            :submit-text="t('midnight.signAndSend')"
            @passkey-prf-output="onPasskeyPrfOutput"
            @passkey-error="onPasskeyError"
            @submit="submitWithPassword"
            button-style="width: 295px; margin-bottom: 1px;"
            button-class="mb-2"
          />
        </div>

        <div v-if="errorMessage" class="red--text text--lighten-2 text-caption mb-2 text-center px-3">
          {{ errorMessage }}
        </div>

        <div>
          <v-btn
            text
            @click="prevStep"
            v-if="currentStep > 1"
            class="mr-2"
            :disabled="sending"
          >
            <v-icon small class="mr-1">mdi-arrow-left</v-icon>{{ t('common.back') }}
          </v-btn>
          <!-- Step 1: advance to the review. -->
          <v-btn
            v-if="currentStep === 1"
            :class="['continue-button', { shake: shakeError }]"
            @click="nextStep()"
            :disabled="sending"
          >{{ t('common.continue') + ' ' }}
            <v-icon style="color: black!important;" small class="ml-1">mdi-arrow-right</v-icon>
          </v-btn>
          <!-- Step 2: password wallets submit here (TransactionAuthSection only
               renders the field for them); PRF wallets submit via the PassKey
               button rendered inside TransactionAuthSection above. -->
          <v-btn
            v-else-if="currentStep === 2 && !isPrfWallet"
            class="continue-button"
            @click="submitWithPassword"
            :disabled="sending"
            :loading="sending"
          >{{ t('midnight.signAndSend') }}</v-btn>
        </div>
      </v-card-actions>
    </BaseDialog>

    <!-- First-time-only consent gate for shielded sends. -->
    <ShieldedProvingConsentDialog
      :is-open="consentDialogOpen"
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
import QRAddressScannerDialog from '@/modules/dashboard/dialogs/QRAddressScannerDialog.vue';
import midnightLogo from '@/assets/svg/midnight.svg';
import { useTranslation } from '@/shared/composables/useTranslation';
import {
  midnightStore,
  SHIELDED_PROVING_CONSENT_VERSION,
} from '@/stores/midnightStore';
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

// Two-step flow mirroring the Cardano SendDialog: recipients → summary.
const steps = ref([
  { name: 'recipients', label: t('wallet.recipients') },
  { name: 'summary', label: t('wallet.summary') },
]);
const currentStep = ref(1);
const shakeError = ref(false);

const shieldedAvailable = computed(() => {
  const vk = midnightStore.addresses?.zswapViewingKey;
  return typeof vk === 'string' && vk.startsWith('mn_shield-esk_');
});

const activeTab = ref(0);
const isShielded = computed(() => activeTab.value === 1);

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);
const available = computed(() => midnightStore.balances?.nightUnshielded ?? 0n);
const formattedAvailable = computed(() => {
  const value = available.value;
  const whole = value / NIGHT_DIVISOR;
  const remainder = value % NIGHT_DIVISOR;
  const remainderStr = remainder.toString().padStart(NIGHT_DIVISOR.toString().length - 1, '0');
  const fraction = remainderStr.slice(0, 2).padEnd(2, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
});

// Network fees on Midnight are paid in DUST and are negligible (~1 Speck
// observed on-chain). We can't cheaply get the exact pre-build value (it's
// computed during the BG dust-balance step, post-auth), so the review shows a
// conservative "< 0.000001" estimate in DUST — enough to convey the fee is
// paid in DUST and is tiny, matching the Cardano flow's fee row.
const feeEstimateDisplay = '< 0.000001';

const step1FormRef = ref<{ validate: () => boolean } | null>(null);
const step1Valid = ref(false);
const recipient = ref('');

// Prefix auto-routing: pasting a `mn_shield-addr_…` selects the shielded tab,
// `mn_addr_…` the unshielded tab, so the user doesn't flip it manually.
watch(
  () => recipient.value,
  (addr) => {
    if (!shieldedAvailable.value) return;
    const v = addr.trim();
    if (v.startsWith('mn_shield-addr_')) {
      if (activeTab.value !== 1) activeTab.value = 1;
    } else if (v.startsWith('mn_addr_')) {
      if (activeTab.value !== 0) activeTab.value = 0;
    }
  },
);

const amount = ref('');
const password = ref('');
const sending = ref(false);
const errorMessage = ref<string | null>(null);

const consentDialogOpen = ref(false);
const pendingCredentials = ref<{ password?: string; prfSecret?: Uint8Array } | null>(null);

const passwordRules = [rules.required()];

const recipientPlaceholder = computed(() =>
  isShielded.value
    ? t('midnight.send.shieldedRecipientLabel')
    : t('common.recipientAddress'),
);

const qrScanDialog = ref(false);
function onQRScan(scanned: string) {
  qrScanDialog.value = false;
  if (typeof scanned === 'string' && scanned.trim()) {
    recipient.value = scanned.trim();
  }
}

const addressRules = computed(() => {
  if (isShielded.value) {
    return [
      (v: string) => !!v || t('midnight.send.shieldedAddressRequired'),
      (v: string) => v.startsWith('mn_shield-addr_') || t('midnight.send.shieldedAddressPrefix'),
    ];
  }
  return [
    (v: string) => !!v || 'Recipient address required',
    (v: string) => {
      const isMain = loggedWallet.value?.network === Network.MAINNET;
      const prefix = isMain ? 'mn_addr_' : `mn_addr_${(loggedWallet.value?.network || '').toLowerCase()}`;
      return v.startsWith('mn_addr_') || `Address should start with ${prefix}`;
    },
  ];
});

const amountRules = computed(() => {
  if (isShielded.value) {
    return [
      (v: string) => !!v || 'Amount required',
      (v: string) => {
        const n = Number(v);
        return (Number.isFinite(n) && n > 0) || 'Must be positive';
      },
    ];
  }
  return [
    (v: string) => !!v || 'Amount required',
    (v: string) => {
      const n = Number(v);
      return (Number.isFinite(n) && n > 0) || 'Must be positive';
    },
    (v: string) => parseAmount(v) <= available.value || 'Exceeds available balance',
  ];
});

function parseAmount(input: string): bigint {
  if (!input) return 0n;
  const [whole = '0', fractionRaw = ''] = input.trim().split('.');
  const fraction = (fractionRaw + '0'.repeat(MIDNIGHT_DECIMALS.NIGHT))
    .slice(0, MIDNIGHT_DECIMALS.NIGHT);
  try { return BigInt(whole) * NIGHT_DIVISOR + BigInt(fraction || '0'); }
  catch { return 0n; }
}

function setMax() {
  const value = available.value;
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

const ownAddresses = computed(() => {
  const a = midnightStore.addresses;
  return [a?.unshielded, a?.shielded, loggedWallet.value?.baseAddress]
    .filter((x): x is string => typeof x === 'string' && x.length > 0);
});
const isSelfSend = computed(() => ownAddresses.value.includes(recipient.value.trim()));

const reviewOutputs = computed<TxDetailsOutput[]>(() => [
  {
    kind: isSelfSend.value ? 'own' : 'external',
    truncatedAddress: truncate(recipient.value.trim()),
    ada: amount.value || '0',
  },
]);

const reviewTotals = computed<TxDetailsTotals>(() => ({
  totalSendingAda: amount.value || '0',
  feeAda: feeEstimateDisplay,
  // Fee is paid in DUST (a separate resource), so "you pay" stays the NIGHT
  // amount — we don't sum a NIGHT amount with a DUST fee.
  youPayAda: amount.value || '0',
  isInternal: isSelfSend.value,
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
  await routeSend({ password: password.value });
}

async function onPasskeyPrfOutput(prfBytes: Uint8Array) {
  if (!preflight() || !isPrfWallet.value) return;
  await routeSend({ prfSecret: prfBytes });
}

function onPasskeyError(error: Error) {
  errorMessage.value = error?.message || 'PassKey authentication failed';
}

async function routeSend(credentials: { password?: string; prfSecret?: Uint8Array }) {
  if (!isShielded.value) {
    await sendUnshielded(credentials);
    return;
  }
  if (hasFreshConsent()) {
    await sendShielded(credentials);
    return;
  }
  pendingCredentials.value = credentials;
  consentDialogOpen.value = true;
}

function onConsentClose() {
  consentDialogOpen.value = false;
  pendingCredentials.value = null;
}

async function onConsentAccepted() {
  consentDialogOpen.value = false;
  const credentials = pendingCredentials.value;
  pendingCredentials.value = null;
  if (!credentials) return;
  await sendShielded(credentials);
}

async function sendUnshielded(credentials: { password?: string; prfSecret?: Uint8Array }) {
  const wallet = loggedWallet.value;
  if (!wallet) return;
  sending.value = true;
  try {
    const { sendUnshieldedNight } = await import('@/services/midnight-tx.service');
    const result = await sendUnshieldedNight(
      wallet.network,
      {
        fromAddress: wallet.baseAddress,
        outputs: [{
          address: recipient.value.trim(),
          amount: parseAmount(amount.value).toString(),
          token: 'NIGHT',
        }],
        ttlMs: Date.now() + 5 * 60_000,
      },
      credentials,
    );
    resetForm();
    debugLog('🌙 Midnight unshielded tx submitted:', result.txHash, 'status:', result.status);
    emit('close');
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e);
  } finally {
    sending.value = false;
  }
}

async function sendShielded(credentials: { password?: string; prfSecret?: Uint8Array }) {
  const wallet = loggedWallet.value;
  if (!wallet) return;
  sending.value = true;
  try {
    const { sendShieldedNight } = await import('@/services/midnight-tx.service');
    const result = await sendShieldedNight(
      wallet.network,
      [{
        receiverAddress: recipient.value.trim(),
        amount: parseAmount(amount.value),
      }],
      credentials,
    );
    resetForm();
    debugLog('🌙 Midnight shielded tx submitted:', result.txHash, 'status:', result.status);
    emit('close');
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e);
  } finally {
    sending.value = false;
  }
}

function resetForm() {
  recipient.value = '';
  amount.value = '';
  password.value = '';
  currentStep.value = 1;
}

// Reset to step 1 whenever the dialog re-opens.
watch(
  () => currentStep.value,
  () => { errorMessage.value = null; },
);
</script>

<style scoped>
/* ─── Content / stepper / total / buttons — copied verbatim from the Cardano
   SendDialog so the two dialogs are visually identical. ─── */
.send-dialog-content {
  z-index: 1;
  max-height: 500px;
  overflow-y: auto;
  overflow-x: hidden;
}

.step-recipients-wrapper {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
}

.step-recipients-inner {
  width: 100%;
  min-width: 340px;
  max-height: 480px;
  overflow-y: auto;
  overflow-x: hidden;
}

.global-total {
  padding: 10px 12px;
  margin-top: 4px;
  background: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 10px;
}

.global-total__row {
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.global-total__label {
  font-size: 12px;
  font-weight: 600;
  color: #CECFD2;
}

.global-total__ada {
  font-size: 14px;
  font-weight: 600;
  color: #00DFF3;
}

.global-total__fee-row {
  margin-bottom: 4px;
}

.global-total__total-row {
  padding-top: 6px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
}

.global-total__fee-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.35);
}

.global-total__fee {
  font-size: 11px;
  color: #FDA29B !important;
}

.send-dialog-actions {
  text-align: center;
  justify-content: center;
}

.continue-button {
  background: linear-gradient(to right, #00c7f3, #00fad5);
  color: black;
}
.continue-button:disabled {
  opacity: 0.5;
  color: black !important;
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
  box-shadow: 0 0 0 4px #00dff327;
}
.stepper-container .custom-step.next .icon-container {
  background-color: #292929;
}
.stepper-container .custom-step .icon-container {
  background-color: #00dff3;
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
  color: #CECFD2;
}
.stepper-container .divider {
  flex: 1;
  height: 2px;
  width: 100%;
  margin-left: -38px;
  margin-right: -38px;
  margin-top: 11px;
  background-color: #292929;
}
.stepper-container .divider.active-divider {
  background-color: #00dff3;
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

/* ─── Recipient card + asset row — copied from SendRecipientCard /
   AssetsToSendStep so the Midnight step 1 matches the Cardano one. ─── */
.recipient-card {
  background-color: rgba(255, 255, 255, 0.02);
  border: 1px solid rgba(255, 255, 255, 0.06);
  border-radius: 12px;
  padding: 12px;
}

.address-row {
  display: flex;
  align-items: flex-start;
  gap: 4px;
}

.address-row__icon-btn {
  width: 32px !important;
  height: 32px !important;
  min-height: 28px !important;
  flex-shrink: 0;
}

.address-input {
  flex: 1;
  min-width: 0;
}
.address-input :deep(.v-input__slot) {
  background-color: #161B26 !important;
  border-radius: 10px;
  min-height: 32px !important;
  padding: 0 8px !important;
}
.address-input :deep(input) {
  font-size: 12px;
  padding: 4px 0;
}
.address-input :deep(fieldset) {
  border-color: transparent !important;
}
.address-input :deep(.v-input--is-focused fieldset) {
  border-color: #00DFF3 !important;
  border-width: 1px !important;
}
.address-input.error--text :deep(fieldset) {
  border-color: #F97066 !important;
}

.assets-section {
  margin-top: 10px;
}

.token-row {
  display: flex;
  align-items: center;
  background: #161B26;
  border-radius: 8px;
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
  color: white;
  white-space: nowrap;
}
.token-balance {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.3);
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
  color: white;
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
.token-info {
  font-size: 10px;
  color: #FEC84B;
  padding: 4px 2px 0;
  display: flex;
  align-items: center;
  line-height: 1.4;
}

/* ─── Midnight-specific bits ─── */
.midnight-send-tabs :deep(.v-tab) {
  text-transform: none;
  letter-spacing: 0.02em;
  font-size: 13px;
  min-width: 0;
  padding: 0 12px;
}
.midnight-summary-wrapper {
  padding: 8px 0 4px;
}
.midnight-dust-note {
  display: flex;
  align-items: flex-start;
  gap: 2px;
  font-size: 11px;
  line-height: 1.4;
  color: rgba(254, 200, 75, 0.85);
  background: rgba(254, 200, 75, 0.06);
  border: 1px solid rgba(254, 200, 75, 0.18);
  border-radius: 8px;
  padding: 8px 10px;
}
</style>
