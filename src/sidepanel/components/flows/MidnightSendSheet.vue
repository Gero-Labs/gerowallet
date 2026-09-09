<template>
  <BottomSheet :value="value" @input="onSheetInput" :title="sheetTitle" height="92%" persistent>
    <div class="midnight-send-sheet" ref="stepperEl">

      <!-- ═══════ SUCCESS OVERLAY ═══════ -->
      <div v-if="txSuccess" class="success-overlay">
        <v-icon size="56" color="success">mdi-check-circle</v-icon>
        <div class="text-h6 white--text mt-3">{{ $t('miniGero.txSubmitted') }}</div>
        <div v-if="sponsorWallet" class="success-sponsor">
          <span class="success-sponsor__av">{{ sponsorInitials }}</span>
          {{ $t('midnight.sponsor.feePaidByLabel') }}: {{ sponsorWallet.name }}
        </div>
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
              <span v-if="step > 2" class="step-summary">
              {{ amount || '0' }} {{ selectedTicker }}<template v-if="sponsorWallet">
                · {{ $t('midnight.sponsor.feeFrom', { name: sponsorWallet.name }) }}</template>
            </span>
            </div>
          </button>

          <v-expand-transition>
            <div v-show="step === 2" class="step-body">
              <div class="asset-input-section">
                <div class="asset-input-header">
                  <!-- Only a picker once there is a genuine choice. -->
                  <v-select
                    v-if="assetOptions.length > 1"
                    v-model="selectedToken"
                    :items="assetOptions"
                    item-value="value"
                    item-text="ticker"
                    dense
                    outlined
                    dark
                    hide-details
                    attach
                    class="asset-select"
                    :disabled="submitting"
                    :aria-label="$t('common.asset')"
                  />
                  <template v-else>
                    <v-avatar size="24" class="mr-2">
                      <img :src="midnightLogo" :alt="nightCurrency" />
                    </v-avatar>
                    <span class="white--text text-body-2 font-weight-bold">{{ selectedTicker }}</span>
                  </template>
                  <v-spacer />
                  <span class="grey--text text-caption">{{ $t('miniGero.available') }}: {{ formattedAvailable }}</span>
                </div>
                <div v-if="rawUnits" class="grey--text text-caption mb-2">
                  {{ $t('midnight.send.rawUnitsNote') }}
                </div>
                <div class="amount-row">
                  <v-text-field
                    v-model="amount"
                    type="number"
                    min="0"
                    :step="amountStep"
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

                <MidnightSponsorPicker
                  v-if="noFeeCapacity && loggedWallet"
                  :value="sponsorWalletId"
                  :sender-wallet-id="loggedWallet.id"
                  :network="loggedWallet.network"
                  @input="sponsorWalletId = $event"
                />
                <div v-if="sponsorWallet" class="sponsor-unlock">
                  <template v-if="sponsorNeedsPassword">
                    <v-text-field
                      v-model="sponsorPassword"
                      type="password"
                      autocomplete="off"
                      dense
                      outlined
                      dark
                      hide-details="auto"
                      :label="$t('midnight.sponsor.passwordLabel', { name: sponsorWallet.name })"
                    />
                    <div class="sponsor-unlock__warn">
                      {{ $t('midnight.sponsor.notSenderPassword', {
                        sender: loggedWallet ? loggedWallet.name : '',
                      }) }}
                    </div>
                  </template>
                  <!-- The panel cannot host WebAuthn, so a sponsor PassKey opens
                       a popup. Say so before it happens. -->
                  <div v-else class="sponsor-unlock__passkey">
                    <v-icon small class="mr-2">mdi-fingerprint</v-icon>
                    <span>
                      {{ $t('midnight.sponsor.passkeyNotice', {
                        name: sponsorWallet.name,
                        sender: loggedWallet ? loggedWallet.name : '',
                      }) }}
                      {{ $t('midnight.sponsor.passkeyPopupNote') }}
                    </span>
                  </div>

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
                :unit="selectedTicker"
                :fee-unit="dustCurrency"
                :fee-label="String($t('midnight.send.estimatedNetworkFee'))"
              />

              <!-- Public-chain disclosure: unshielded transfers are indexer-visible. -->
              <div class="midnight-info-note mt-3">
                <v-icon size="14" color="var(--g-text-3)" class="mr-1">mdi-eye-outline</v-icon>
                <span>{{ $t('midnight.send.publicTxNote') }}</span>
              </div>

              <!-- DUST fee note (fee is ~1 Speck; sending does NOT reset DUST —
                   verified on preprod, the old "reset" was an estimator bug). -->
              <div v-if="!isDustLow" class="midnight-dust-note mt-3">
                <v-icon size="14" color="warning" class="mr-1">mdi-information-outline</v-icon>
                <span>{{ $t('midnight.send.dustResetWarning') }}</span>
              </div>
              <!-- Low-DUST hint: informational while any DUST remains (the tiny
                   fee still clears); red only when DUST is genuinely empty. -->
              <div v-else class="mt-3" :class="isDustEmpty ? 'midnight-dust-note midnight-dust-note--low' : 'midnight-info-note'">
                <v-icon size="14" :color="isDustEmpty ? 'error' : 'var(--g-text-3)'" class="mr-1">mdi-battery-alert-variant-outline</v-icon>
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

              <!-- The same five-node timeline the options page shows. This
                   used to be one line of text, hiding a first-time DUST ledger
                   replay that can run for minutes. -->
              <div v-if="submitting" class="mini-tl mt-3">
                <div v-if="sponsorWallet" class="mini-tl__who">
                  <span class="success-sponsor__av">{{ sponsorInitials }}</span>
                  {{ $t('midnight.sponsor.feePaidByLabel') }}: {{ sponsorWallet.name }}
                </div>
                <MidnightSendTimeline compact :nodes="timelineNodes" />
                <div class="mini-tl__keep">{{ $t('midnight.sponsor.keepOpen') }}</div>
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
import { ref, computed, onMounted, watch, nextTick, toRefs } from 'vue';
import { geroStore } from '@/stores/geroStore';
import { useMidnightSendTimeline } from '@/shared/composables/useMidnightSendTimeline';
import MidnightSendTimeline from '@/shared/components/MidnightSendTimeline.vue';
import MidnightSponsorPicker from '@/modules/dashboard/dialogs/MidnightSponsorPicker.vue';
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
import { midnightTokenBalances } from '@/chains/midnight/midnightTokenBalances';
import { midnightTokenMeta } from '@/chains/midnight/midnightTokenRegistry';
import { blocksMidnightSend } from '@/chains/midnight/midnightFeeCapacity';
import {
  formatTokenAmount,
  parseTokenAmount,
  toAmountInput,
} from '@/chains/midnight/midnightAmount';
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
/** `NIGHT` for the native token, otherwise a 32-byte colour as hex. */
const selectedToken = ref<string>('NIGHT');

/** Per-colour unshielded balances derived from the wallet's own UTxO set. */
const tokenBalances = computed(() => midnightTokenBalances(midnightStore.utxos ?? []));

interface AssetOption {
  value: string;
  ticker: string;
  /** null = exponent genuinely unknown; amounts are then raw base units. */
  decimals: number | null;
}

const assetOptions = computed<AssetOption[]>(() => {
  const night: AssetOption = {
    value: 'NIGHT',
    ticker: nightCurrency.value,
    decimals: MIDNIGHT_DECIMALS.NIGHT,
  };
  const tokens = Object.keys(tokenBalances.value).map((color) => {
    const meta = midnightTokenMeta(color);
    return {
      value: color,
      ticker: meta?.symbol ?? `${color.slice(0, 8)}\u2026${color.slice(-6)}`,
      decimals: meta?.decimals ?? null,
    } as AssetOption;
  });
  return [night, ...tokens];
});

const selectedAsset = computed<AssetOption>(
  () => assetOptions.value.find((o) => o.value === selectedToken.value) ?? assetOptions.value[0],
);
const selectedDecimals = computed(() => selectedAsset.value.decimals);
const selectedTicker = computed(() => selectedAsset.value.ticker);
const rawUnits = computed(() => selectedDecimals.value === null);
const amountStep = computed(() =>
  rawUnits.value ? '1' : `0.${'0'.repeat((selectedDecimals.value ?? 1) - 1)}1`,
);

const available = computed(() =>
  selectedToken.value === 'NIGHT'
    ? (midnightStore.balances?.nightUnshielded ?? 0n)
    : (tokenBalances.value[selectedToken.value] ?? 0n));

const formattedAvailable = computed(() =>
  formatTokenAmount(available.value, selectedDecimals.value));

/** Scales against the SELECTED token's decimals — see midnightAmount.ts. */
function parseAmount(input: string): bigint {
  return parseTokenAmount(input, selectedDecimals.value);
}

function setMax() {
  amount.value = toAmountInput(available.value, selectedDecimals.value);
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

/**
  * No spendable DUST means no fee can be paid. Surfaced on the amount step so
  * the user learns it before authorizing, not after the SDK stalls.
  */
const noFeeCapacity = computed(() => blocksMidnightSend(midnightStore.dustState));

/**
 * Wallet chosen to pay this send's DUST fee, mirroring the options-page dialog.
 * The picker is the only writer.
 */
const sponsorWalletId = ref<number | null>(null);
const sponsorWallet = computed(() => (
  sponsorWalletId.value == null ? null : (geroStore.wallets?.[sponsorWalletId.value] ?? null)
));
const sponsorNeedsPassword = computed(() => (
  !!sponsorWallet.value && sponsorWallet.value.encryptionMethod !== 'prf'
));
const sponsorPassword = ref('');

/** Monogram for the success pill. */
const sponsorInitials = computed(() => {
  const name = sponsorWallet.value?.name ?? '';
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
});

/**
 * Missing DUST only blocks the send while nothing else will pay for it — with
 * a sponsor chosen the fee comes from that wallet.
 */
const blockedByFee = computed(() => noFeeCapacity.value && sponsorWalletId.value == null);

const amountError = computed(() => {
  if (blockedByFee.value) return t('midnight.send.noDustFee');
  if (!amount.value) return '';
  // Judged by the parser that builds the tx, not Number(): the two disagree on
  // exponential notation ('1e2' passes Number, parses to 0n) and on amounts
  // below one base unit, and the balance check below is an upper bound only.
  if (parseAmount(amount.value) <= 0n) return t('send.amountMustBePositive');
  if (parseAmount(amount.value) > available.value) return t('errors.insufficientBalance');
  return '';
});

const isAmountValid = computed(() =>
  !!amount.value && parseAmount(amount.value) > 0n && !amountError.value);

// ── DUST battery (same store source as MidnightSendDialog.vue) ──
const dustBattery = computed<{ percent: number } | null>(() => {
  const ds = midnightStore.dustState;
  if (!ds || ds.cap <= 0n) return null;
  const raw = Number((ds.current * 10000n) / ds.cap) / 100;
  return { percent: Math.max(0, Math.min(100, Math.round(raw))) };
});
const isDustLow = computed(() => !!dustBattery.value && dustBattery.value.percent < 20);

// Truly empty DUST: the (~1 Speck) fee can't be paid, so the hint escalates to
// the error tone. Any nonzero DUST covers the fee and stays informational.
const isDustEmpty = computed(() => {
  const ds = midnightStore.dustState;
  return !!ds && ds.current <= 0n;
});

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
  // Captured with the amount: without it a token send shows as NIGHT in
  // history until gero-sync backfills the confirmed row.
  const token = selectedToken.value;
  try {
    const { addPendingMidnightTx } = await import('@/services/midnight-tx.service');
    await addPendingMidnightTx(hash, amountBig, to, false, token);
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
          token: selectedToken.value,
        }],
        ttlMs: Date.now() + 5 * 60_000,
      },
      credentials,
      (stage) => { sendStage.value = stage; },
      await buildSponsorArg(),
    );
    debugLog('🌙 mini-Gero Midnight unshielded tx submitted:', result.txHash, 'status:', result.status,
      'sponsor:', sponsorWalletId.value ?? 'none');

    // Remember who paid, for the battery indicator on both wallets and the
    // transaction details screen. Best effort — never fail a submitted tx.
    if (sponsorWallet.value) {
      const paying = sponsorWallet.value;
      try {
        const { recordSponsoredTx, saveSponsorLink } = await import('@/chains/midnight/midnightSponsorLinks');
        const at = Date.now();
        await saveSponsorLink({
          walletId: wallet.id,
          sponsorWalletId: paying.id,
          sponsorName: paying.name,
          network: wallet.network,
          at,
        });
        await recordSponsoredTx({
          txHash: result.txHash,
          sponsorWalletId: paying.id,
          sponsorName: paying.name,
          at,
          sponsoredWalletId: wallet.id,
          sponsoredWalletName: wallet.name,
          amountLabel: `${amount.value} ${selectedToken.value === 'NIGHT' ? 'NIGHT' : shortToken(selectedToken.value)}`,
          recipient: recipient.value.trim(),
        });
      } catch (e) {
        debugLog('🌙 could not record sponsorship for this tx', e);
      }
    }
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
function requestRawPrf(walletId?: number): Promise<Uint8Array> {
  // `walletId` unlocks a wallet OTHER than the logged-in one — a DUST sponsor.
  // Omitted, the popup evaluates the active wallet exactly as before.
  const target = walletId == null ? '' : `&walletId=${encodeURIComponent(String(walletId))}`;
  const popupUrl = chrome.runtime.getURL(`index.html?mode=rawPrf${target}#/passkey-auth`);
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

/**
 * The sponsor argument for `sendUnshieldedNight`, using the sponsor wallet's
 * OWN credential.
 *
 * The PassKey path goes through the same popup as the sender's, but with an
 * explicit `walletId`: the side panel cannot host WebAuthn, and the sponsor is
 * by definition not the logged-in wallet, so the popup has to be told which
 * credential to evaluate.
 */
async function buildSponsorArg() {
  const sponsor = sponsorWallet.value;
  if (!sponsor) return undefined;

  if (sponsor.encryptionMethod === 'prf') {
    const prfBytes = await requestRawPrf(sponsor.id);
    return { walletId: sponsor.id, prfSecret: prfBytes };
  }

  if (!sponsorPassword.value) throw new Error(t('midnight.sponsor.passwordRequired'));
  return { walletId: sponsor.id, password: sponsorPassword.value };
}

/**
 * Restore the stored sponsor preference. The picker still re-resolves whether
 * that wallet can actually pay.
 */
async function restoreSponsorPreference() {
  const wallet = loggedWallet.value;
  if (!wallet) return;
  const { linkFor, loadSponsorLinks } = await import('@/chains/midnight/midnightSponsorLinks');
  const link = linkFor(await loadSponsorLinks(), wallet.id, wallet.network);
  sponsorWalletId.value = link?.sponsorWalletId ?? null;
}
onMounted(restoreSponsorPreference);

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
  // The sheet resets everything else on every open; the asset was the one
  // field that persisted, which risks sending the wrong colour by inertia.
  selectedToken.value = 'NIGHT';
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

/** Token colours are 64-char hex; show the head so a label stays readable. */
function shortToken(colour: string): string {
  return colour.length > 12 ? `${colour.slice(0, 6)}…` : colour;
}

/**
 * Same five-node timeline the options-page dialog shows, driven by the same
 * stage rank and the same `midnightStore.sendProgress`, so the two surfaces
 * can never disagree about where a send has got to.
 */
const timelineLabels = computed(() => ({
  authorize: t('midnight.send.stageAuthorize') as string,
  build: t('midnight.send.stageBuild') as string,
  sync: (sponsorWallet.value
    ? t('midnight.send.stageSyncNamed', { name: sponsorWallet.value.name })
    : t('midnight.send.stageSync')) as string,
  sign: t('midnight.send.stageSign') as string,
  submit: t('midnight.send.stageSubmit') as string,
  provingLocal: t('midnight.send.stageProvingLocal') as string,
  provingZkpaas: t('midnight.send.stageProvingZkpaas') as string,
}));
const timelineNodes = useMidnightSendTimeline(computed(() => sendStage.value), timelineLabels);
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
/* Vuetify `dense` already sets the compact height; only the width needs
   constraining so the available-balance label keeps its place in the row. */
.asset-select {
  max-width: 132px;
  flex: 0 0 auto;
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

.sponsor-unlock {
  margin-top: 8px;
}

.sponsor-unlock__warn {
  margin-top: 4px;
  font-size: 11px;
  color: var(--g-warning);
}

.sponsor-unlock__passkey {
  display: flex;
  align-items: flex-start;
  padding: 8px;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  font-size: 11px;
  line-height: 1.45;
  color: var(--g-text-2);
}

.sponsor-unlock__note {
  margin-top: 4px;
  font-size: 11px;
  color: var(--g-text-3);
}

.success-sponsor {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: 8px;
  padding: 3px 10px;
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  font-size: 11px;
  color: var(--g-text-2);
}

.success-sponsor__av {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-1);
  font-size: 8px;
  font-weight: 600;
}

.mini-tl__who {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 10px;
  font-size: 11px;
  color: var(--g-text-2);
}

.mini-tl__keep {
  margin-top: 4px;
  font-size: 11px;
  color: var(--g-text-3);
}
</style>
