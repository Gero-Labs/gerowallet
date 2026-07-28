<template>
  <BottomSheet :value="value" @input="onSheetInput" :title="sheetTitle" height="92%" persistent>
    <div class="midnight-send-sheet" ref="stepperEl">

      <!-- ═══════ SUCCESS OVERLAY ═══════ -->
      <div v-if="txSuccess" class="success-overlay">
        <v-icon size="56" color="success">mdi-check-circle</v-icon>
        <div class="text-h6 white--text mt-3">{{ $t('miniGero.txSubmitted') }}</div>
        <div class="text-caption grey--text mt-1 text-center">{{ $t('miniGero.txSubmittedDesc') }}</div>
        <button v-if="txId" type="button" class="tx-id-box mt-4" @click="copyTxId">
          <span class="text-caption grey--text">{{ truncate(txId) }}</span>
          <v-icon x-small :color="primaryColor" class="ml-1">mdi-content-copy</v-icon>
        </button>
        <v-btn block :color="primaryColor" class="black--text font-weight-bold mt-6" @click="finish">
          {{ $t('miniGero.done') }}
        </v-btn>
      </div>

      <template v-else>
        <!-- ═══════ STEP 1: RECIPIENT ═══════ -->
        <div class="stepper-step" :class="{ active: step === 1, done: step > 1 }">
          <button type="button" class="step-header" @click="editStep(1)">
            <div class="step-circle" :class="step > 1 ? 'done' : step === 1 ? 'active' : ''">
              <v-icon v-if="step > 1" x-small color="var(--g-on-grad)">mdi-check</v-icon>
              <span v-else>1</span>
            </div>
            <div class="step-info">
              <span class="step-label">{{ $t('miniGero.recipientAddress') }}</span>
              <span v-if="step > 1" class="step-summary">{{ truncate(recipient.trim()) }}</span>
            </div>
          </button>

          <v-expand-transition>
            <div v-show="step === 1" class="step-body">
              <div class="quick-row">
                <v-btn x-small outlined :color="primaryColor" @click="showQR = true">
                  <v-icon x-small class="mr-1">mdi-qrcode</v-icon>{{ $t('wallet.qrScan') }}
                </v-btn>
                <v-btn x-small outlined :color="primaryColor" class="ml-2" @click="pasteFromClipboard">
                  <v-icon x-small class="mr-1">mdi-content-paste</v-icon>{{ $t('common.paste') }}
                </v-btn>
              </div>

              <v-text-field
                v-model="recipient"
                :placeholder="$t('common.recipientAddress')"
                outlined
                dense
                dark
                hide-details="auto"
                class="mt-2"
                :error-messages="recipientError"
                :disabled="submitting"
              />

              <QRAddressScannerDialog
                :isOpen="showQR"
                :chain="loggedWallet && loggedWallet.chain"
                :network="loggedWallet && loggedWallet.network"
                @close="showQR = false"
                @scan="onQRScan"
              />

              <v-btn
                block
                :color="primaryColor"
                class="black--text font-weight-bold mt-4"
                :disabled="!isAddressValid"
                @click="goToStep(2)"
              >
                {{ $t('common.continue') }}
              </v-btn>
            </div>
          </v-expand-transition>
        </div>

        <!-- ═══════ STEP 2: AMOUNT ═══════ -->
        <div class="stepper-step" :class="{ active: step === 2, done: step > 2, locked: step < 2 }">
          <button type="button" class="step-header" @click="editStep(2)">
            <div class="step-circle" :class="step > 2 ? 'done' : step === 2 ? 'active' : ''">
              <v-icon v-if="step > 2" x-small color="var(--g-on-grad)">mdi-check</v-icon>
              <span v-else>2</span>
            </div>
            <div class="step-info">
              <span class="step-label">{{ $t('common.amount') }}</span>
              <span v-if="step > 2" class="step-summary">{{ amount || '0' }} {{ nightCurrency }}</span>
            </div>
          </button>

          <v-expand-transition>
            <div v-show="step === 2" class="step-body">
              <div class="asset-input-section">
                <div class="asset-input-header">
                  <v-avatar size="24" class="mr-2">
                    <img :src="midnightLogo" alt="NIGHT" />
                  </v-avatar>
                  <span class="white--text text-body-2 font-weight-bold">{{ nightCurrency }}</span>
                  <v-spacer />
                  <span class="grey--text text-caption">{{ $t('miniGero.available') }}: {{ formattedAvailable }}</span>
                </div>
                <div class="amount-row">
                  <v-text-field
                    v-model="amount"
                    type="number"
                    min="0"
                    step="0.000001"
                    outlined
                    dense
                    dark
                    hide-details="auto"
                    placeholder="0"
                    class="flex-grow-1"
                    :error-messages="amountError"
                    :disabled="submitting"
                  />
                  <v-btn x-small text :color="primaryColor" class="ml-2" @click="setMax">
                    {{ $t('miniGero.max') }}
                  </v-btn>
                </div>
              </div>

              <div class="step-actions-row mt-4">
                <v-btn text small color="var(--g-text-3)" @click="editStep(1)">{{ $t('miniGero.back') }}</v-btn>
                <v-btn
                  :color="primaryColor"
                  class="black--text font-weight-bold flex-grow-1 ml-2"
                  :disabled="!isAmountValid"
                  @click="goToStep(3)"
                >
                  {{ $t('miniGero.review') }}
                </v-btn>
              </div>
            </div>
          </v-expand-transition>
        </div>

        <!-- ═══════ STEP 3: REVIEW ═══════ -->
        <div class="stepper-step" :class="{ active: step === 3, done: step > 3, locked: step < 3 }">
          <button type="button" class="step-header" @click="editStep(3)">
            <div class="step-circle" :class="step > 3 ? 'done' : step === 3 ? 'active' : ''">
              <v-icon v-if="step > 3" x-small color="var(--g-on-grad)">mdi-check</v-icon>
              <span v-else>3</span>
            </div>
            <div class="step-info">
              <span class="step-label">{{ $t('wallet.summary') }}</span>
            </div>
          </button>

          <v-expand-transition>
            <div v-show="step === 3" class="step-body">
              <TransactionDetailsCard
                :outputs="reviewOutputs"
                :totals="reviewTotals"
                :unit="nightCurrency"
                :fee-unit="dustCurrency"
                :fee-label="$t('midnight.send.estimatedNetworkFee')"
              />

              <!-- Public-chain disclosure: unshielded transfers are indexer-visible. -->
              <div class="midnight-info-note mt-3">
                <v-icon size="14" color="var(--g-text-3)" class="mr-1">mdi-eye-outline</v-icon>
                <span>{{ $t('midnight.send.publicTxNote') }}</span>
              </div>

              <!-- Sending registered NIGHT resets its DUST accrual clock. -->
              <div v-if="!isDustLow" class="midnight-dust-note mt-3">
                <v-icon size="14" color="warning" class="mr-1">mdi-information-outline</v-icon>
                <span>{{ $t('midnight.send.dustResetWarning') }}</span>
              </div>
              <div v-else class="midnight-dust-note midnight-dust-note--low mt-3">
                <v-icon size="14" color="error" class="mr-1">mdi-battery-alert-variant-outline</v-icon>
                <span>{{ $t('midnight.send.dustLowHint', { percent: dustBattery.percent }) }}</span>
              </div>

              <div class="step-actions-row mt-4">
                <v-btn text small color="var(--g-text-3)" @click="editStep(2)">{{ $t('miniGero.back') }}</v-btn>
                <v-btn :color="primaryColor" class="black--text font-weight-bold flex-grow-1 ml-2" @click="goToStep(4)">
                  {{ $t('miniGero.confirmSend') }}
                </v-btn>
              </div>
            </div>
          </v-expand-transition>
        </div>

        <!-- ═══════ STEP 4: CONFIRM ═══════ -->
        <div class="stepper-step" :class="{ active: step === 4, locked: step < 4 }">
          <div class="step-header step-header--static">
            <div class="step-circle" :class="step === 4 ? 'active' : ''">
              <span>4</span>
            </div>
            <div class="step-info">
              <span class="step-label">{{ $t('miniGero.confirmSend') }}</span>
            </div>
          </div>

          <v-expand-transition>
            <div v-show="step === 4" class="step-body">
              <!-- ── Normal wallet (password) ── -->
              <template v-if="isNormalWallet && !isPrfWallet">
                <div class="text-caption grey--text mb-2">{{ $t('miniGero.spendingPassword') }}</div>
                <v-text-field
                  v-model="spendingPassword"
                  :type="showPassword ? 'text' : 'password'"
                  outlined
                  dense
                  dark
                  hide-details="auto"
                  :placeholder="$t('miniGero.enterPassword')"
                  :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
                  :disabled="submitting"
                  @click:append="showPassword = !showPassword"
                  @keydown.enter="signAndSubmit()"
                />
                <v-btn
                  block
                  :color="primaryColor"
                  class="black--text font-weight-bold mt-4"
                  :disabled="!spendingPassword || submitting"
                  :loading="submitting"
                  @click="signAndSubmit()"
                >
                  <v-icon left small>mdi-send</v-icon>
                  {{ $t('miniGero.confirmSend') }}
                </v-btn>
              </template>

              <!-- ── PRF wallet (PassKey) ── -->
              <template v-else-if="isNormalWallet && isPrfWallet">
                <div class="hw-notice">
                  <v-icon size="40" :color="primaryColor" class="mb-2">mdi-fingerprint</v-icon>
                  <div class="text-body-2 white--text text-center mb-3">{{ $t('miniGero.prfAuthPrompt') }}</div>
                </div>
                <v-btn
                  block
                  :color="primaryColor"
                  class="black--text font-weight-bold"
                  :disabled="submitting"
                  :loading="submitting"
                  @click="signAndSubmitPrf()"
                >
                  <v-icon left small>mdi-fingerprint</v-icon>
                  {{ $t('miniGero.confirmSend') }}
                </v-btn>
              </template>

              <!-- ── Any other wallet type: Midnight has no hardware-wallet
                   signing support. ── -->
              <template v-else>
                <div class="hw-notice">
                  <v-icon size="40" color="var(--g-text-3)" class="mb-2">mdi-alert-circle-outline</v-icon>
                  <div class="text-body-2 grey--text text-center">{{ $t('midnight.connector.walletTypeUnsupported') }}</div>
                </div>
              </template>

              <div v-if="submitting && stageLabel" class="text-caption grey--text text-center mt-3">
                {{ stageLabel }}
              </div>

              <div v-if="passwordError" class="text-caption mt-2 text-center" style="color: var(--g-error)">
                {{ passwordError }}
              </div>

              <div class="step-actions-row mt-3">
                <v-btn text small color="var(--g-text-3)" block :disabled="submitting" @click="editStep(3)">
                  {{ $t('miniGero.back') }}
                </v-btn>
              </div>
            </div>
          </v-expand-transition>
        </div>
      </template>
    </div>
  </BottomSheet>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, toRefs } from 'vue';
import BottomSheet from '../BottomSheet.vue';
import QRAddressScannerDialog from '@/modules/dashboard/dialogs/QRAddressScannerDialog.vue';
import TransactionDetailsCard, {
  type TxDetailsOutput,
  type TxDetailsTotals,
} from '@/shared/components/TransactionDetailsCard.vue';
import midnightLogo from '@/assets/svg/midnight.svg';
import { walletStore } from '@/stores/walletStore';
import { midnightStore } from '@/stores/midnightStore';
import { Network, WalletType } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import type { MidnightSendStage } from '@/services/midnight-tx.service';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useChainContext } from '../../composables/useChainContext';
import snackbar from '@/plugins/snackbar';
import { debugLog } from '@/utils/debug';

const { t } = useTranslation();
const { themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const props = defineProps<{ value: boolean }>();
const emit = defineEmits<{ (e: 'input', value: boolean): void }>();

const { loggedWallet } = toRefs(walletStore);

// ── State ──
const step = ref(1);
const stepperEl = ref<HTMLElement | null>(null);

const recipient = ref('');
const amount = ref('');
const showQR = ref(false);

const spendingPassword = ref('');
const showPassword = ref(false);
const passwordError = ref('');
const submitting = ref(false);
const txSuccess = ref(false);
const txId = ref('');

type SendStageOrIdle = MidnightSendStage | 'idle';
const sendStage = ref<SendStageOrIdle>('idle');

// ── Wallet / network ──
const isMainnet = computed(() => loggedWallet.value?.network === Network.MAINNET);
const nightCurrency = computed(() => (isMainnet.value ? 'NIGHT' : 'tNIGHT'));
const dustCurrency = computed(() => (isMainnet.value ? 'DUST' : 'tDUST'));

const isNormalWallet = computed(() => loggedWallet.value?.type === WalletType.Normal);
const isPrfWallet = computed(() =>
  loggedWallet.value?.type === WalletType.Normal && !!loggedWallet.value?.webAuthnCredentialId,
);

const sheetTitle = computed(() => (txSuccess.value ? '' : t('wallet.quickSend')));

// ── Balance / amount (unshielded only — WP7 scope decision) ──
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

function parseAmount(input: string): bigint {
  if (!input) return 0n;
  const [whole = '0', fractionRaw = ''] = input.trim().split('.');
  const fraction = (fractionRaw + '0'.repeat(MIDNIGHT_DECIMALS.NIGHT)).slice(0, MIDNIGHT_DECIMALS.NIGHT);
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

// ── Validation ──
// Midnight bech32m HRP is mn_<type>[_<network>]1<data>; MAINNET omits the
// network segment. Mirrors MidnightSendDialog.vue's expectedAddressPrefix.
function expectedAddressPrefix(): string {
  return isMainnet.value ? 'mn_addr1' : `mn_addr_${(loggedWallet.value?.network || '').toLowerCase()}1`;
}

const isAddressValid = computed(() => {
  const v = recipient.value.trim();
  return !!v && v.startsWith(expectedAddressPrefix());
});

const recipientError = computed(() => {
  const v = recipient.value.trim();
  if (!v) return '';
  if (!v.startsWith(expectedAddressPrefix())) {
    return t('midnight.send.addressPrefix', { prefix: expectedAddressPrefix() });
  }
  return '';
});

const amountError = computed(() => {
  if (!amount.value) return '';
  const n = Number(amount.value);
  if (!Number.isFinite(n) || n <= 0) return t('send.amountMustBePositive');
  if (parseAmount(amount.value) > available.value) return t('errors.insufficientBalance');
  return '';
});

const isAmountValid = computed(() => {
  const n = Number(amount.value);
  return !!amount.value && Number.isFinite(n) && n > 0 && !amountError.value;
});

// ── DUST battery (same store source as MidnightSendDialog.vue) ──
const dustBattery = computed<{ percent: number } | null>(() => {
  const ds = midnightStore.dustState;
  if (!ds || ds.cap <= 0n) return null;
  const raw = Number((ds.current * 10000n) / ds.cap) / 100;
  return { percent: Math.max(0, Math.min(100, Math.round(raw))) };
});
const isDustLow = computed(() => !!dustBattery.value && dustBattery.value.percent < 20);

// ── Review model (fed to the shared TransactionDetailsCard, same as the
//    dashboard dialog) ──
const feeEstimateDisplay = '< 0.000001';

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

const reviewOutputs = computed<TxDetailsOutput[]>(() => [{
  kind: isSelfSend.value ? 'own' : 'external',
  truncatedAddress: truncate(recipient.value.trim()),
  ada: amount.value || '0',
}]);

const reviewTotals = computed<TxDetailsTotals>(() => ({
  totalSendingAda: amount.value || '0',
  feeAda: feeEstimateDisplay,
  youPayAda: amount.value || '0',
  isInternal: isSelfSend.value,
}));

// ── Progress label (mirrors MidnightSendDialog.vue's timeline stage split,
//    condensed to a single caption line for the sidepanel). ──
const stageLabel = computed(() => {
  const s = sendStage.value;
  if (s === 'authorizing') return t('midnight.send.stageAuthorize');
  if (s === 'building') return t('midnight.send.stageBuild');
  if (s === 'working') {
    const prog = midnightStore.sendProgress;
    const pct = prog && prog.phase === 'syncingDust' ? prog.percent : null;
    return pct != null && pct < 100 ? t('midnight.send.stageSync') : t('midnight.send.stageSign');
  }
  if (s === 'submitting') return t('midnight.send.stageSubmit');
  return '';
});

// ── Step navigation ──
function editStep(target: number) {
  if (target < step.value && !submitting.value) {
    step.value = target;
  }
}

function goToStep(target: number) {
  if (target === 2 && !isAddressValid.value) return;
  if (target === 3 && !isAmountValid.value) return;
  step.value = target;
  nextTick(() => scrollToActiveStep());
}

function scrollToActiveStep() {
  if (!stepperEl.value) return;
  const active = stepperEl.value.querySelector('.stepper-step.active');
  if (active) active.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ── Recipient helpers ──
function onQRScan(scanned: string) {
  showQR.value = false;
  if (typeof scanned === 'string' && scanned.trim()) {
    recipient.value = scanned.trim();
  }
}

async function pasteFromClipboard() {
  try {
    const text = await navigator.clipboard.readText();
    recipient.value = text.trim();
  } catch (e) {
    console.warn('Could not paste:', e);
  }
}

function copyTxId() {
  if (txId.value) navigator.clipboard.writeText(txId.value).catch(() => {});
}

// ── Sign & submit (mirrors MidnightSendDialog.vue's sendUnshielded exactly:
//    same service call, same credentials shape, same onStage callback, same
//    addPendingMidnightTx follow-up call after a successful submit). ──
async function addOptimisticPendingTx(hash: string) {
  const amountBig = parseAmount(amount.value);
  const to = recipient.value.trim();
  try {
    const { addPendingMidnightTx } = await import('@/services/midnight-tx.service');
    await addPendingMidnightTx(hash, amountBig, to, false);
  } catch {
    /* non-fatal — gero-sync backfills the confirmed entry */
  }
}

async function submitSend(credentials: { password?: string; prfSecret?: Uint8Array }) {
  const wallet = loggedWallet.value;
  if (!wallet) {
    passwordError.value = t('errors.noWalletLogged');
    submitting.value = false; // PRF path pre-sets submitting=true before this guard runs
    return;
  }
  passwordError.value = '';
  submitting.value = true;
  sendStage.value = 'authorizing';
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
      (stage) => { sendStage.value = stage; },
    );
    debugLog('🌙 mini-Gero Midnight unshielded tx submitted:', result.txHash, 'status:', result.status);
    // Show it in history right away — gero-sync backfills the confirmed entry.
    void addOptimisticPendingTx(result.txHash);
    txId.value = result.txHash;
    txSuccess.value = true;
    snackbar.fireSuccess(t('miniGero.txSubmitted'));
  } catch (e) {
    passwordError.value = e instanceof Error ? e.message : String(e);
  } finally {
    spendingPassword.value = '';
    submitting.value = false;
    sendStage.value = 'idle';
  }
}

async function signAndSubmit() {
  if (!spendingPassword.value || submitting.value) return;
  await submitSend({ password: spendingPassword.value });
}

// PRF (PassKey) — side panels cannot host WebAuthn directly, so this reuses
// the exact cross-window popup workaround DAppOverlay.vue's
// signMidnightTransferPrf() implements (mode=rawPrf), since Midnight decrypts
// its mnemonic from the raw PRF output rather than a Cardano private key.
function requestRawPrf(): Promise<Uint8Array> {
  const popupUrl = chrome.runtime.getURL('index.html?mode=rawPrf#/passkey-auth');
  const popup = window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');
  if (!popup) return Promise.reject(new Error(t('errors.popupBlocked')));

  return new Promise((resolve, reject) => {
    const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
    const handler = (event: MessageEvent) => {
      if (event.origin !== extensionOrigin) return;
      if (event.data.type === 'PASSKEY_AUTH_RESULT') {
        window.removeEventListener('message', handler);
        const { success, prfOutput, error } = event.data.payload;
        if (success && prfOutput) resolve(new Uint8Array(prfOutput));
        else reject(new Error(error || t('security.passKeyAuthFailed')));
      }
    };
    window.addEventListener('message', handler);
    setTimeout(() => {
      window.removeEventListener('message', handler);
      reject(new Error(t('errors.authenticationTimeout')));
    }, 60000);
  });
}

async function signAndSubmitPrf() {
  if (submitting.value) return;
  passwordError.value = '';
  submitting.value = true;
  try {
    const prfBytes = await requestRawPrf();
    await submitSend({ prfSecret: prfBytes });
  } catch (e) {
    passwordError.value = e instanceof Error ? e.message : String(e);
    submitting.value = false;
  }
}

// ── Close / reset ──
function finish() {
  emit('input', false);
}

// Block dismissal while a send is running (the BG work continues even if the
// sheet closes, so keep the confirm step visible until it resolves).
function onSheetInput(val: boolean) {
  if (!val && submitting.value) return;
  emit('input', val);
}

function resetAll() {
  step.value = 1;
  recipient.value = '';
  amount.value = '';
  showQR.value = false;
  spendingPassword.value = '';
  showPassword.value = false;
  passwordError.value = '';
  submitting.value = false;
  sendStage.value = 'idle';
  txSuccess.value = false;
  txId.value = '';
}

watch(() => props.value, (val) => {
  if (val) resetAll();
});
</script>

<style scoped>
.midnight-send-sheet {
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding-bottom: 16px;
}

/* ── Success ── */
.success-overlay {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 48px 16px;
}
.tx-id-box {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 8px 12px;
  cursor: pointer;
  display: flex;
  align-items: center;
  font: inherit;
  color: inherit;
}

/* ── Stepper step ── */
.stepper-step {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
  overflow: hidden;
  transition: border-color var(--g-dur-base), background var(--g-dur-base);
}
.stepper-step.active {
  background: var(--g-hairline-1);
  border-color: color-mix(in srgb, var(--g-accent) 20%, transparent);
}
.stepper-step.done {
  border-color: var(--g-success-line);
}
.stepper-step.locked {
  opacity: 0.5;
  pointer-events: none;
}

.step-header {
  display: flex;
  align-items: center;
  width: 100%;
  padding: 12px 14px;
  cursor: pointer;
  gap: 10px;
  background: none;
  border: none;
  text-align: left;
}
.step-header--static {
  cursor: default;
}

.step-circle {
  width: 26px;
  height: 26px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 700;
  flex-shrink: 0;
  background: var(--g-hairline-1);
  color: var(--g-text-3);
  transition: background-color var(--g-dur-base), color var(--g-dur-base);
}
.step-circle.active {
  background: var(--g-accent);
  color: var(--g-on-grad);
}
.step-circle.done {
  background: var(--g-success);
  color: var(--g-on-grad);
}

.step-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}
.step-label {
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
}
.step-summary {
  color: var(--g-text-3);
  font-size: 11px;
  text-overflow: ellipsis;
  overflow: hidden;
  white-space: nowrap;
}

.step-body {
  padding: 0 14px 14px;
}

/* ── Quick actions row ── */
.quick-row {
  display: flex;
}

/* ── Amount section ── */
.asset-input-section {
  background: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  padding: 10px;
}
.asset-input-header {
  display: flex;
  align-items: center;
  margin-bottom: 6px;
}
.amount-row {
  display: flex;
  align-items: center;
}

/* ── Step actions ── */
.step-actions-row {
  display: flex;
  align-items: center;
}

/* ── HW / PRF notice ── */
.hw-notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 24px 16px;
}

/* ── Misc ── */
.flex-grow-1 { flex: 1; }

/* ─── Public-tx / DUST notes — same tokens and structure as
   MidnightSendDialog.vue so the disclosure reads identically. ─── */
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

/* Chrome number input spinners off */
input::-webkit-outer-spin-button,
input::-webkit-inner-spin-button {
  -webkit-appearance: none;
  margin: 0;
}
input[type='number'] {
  -moz-appearance: textfield;
}
</style>
