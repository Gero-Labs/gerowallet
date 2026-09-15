<template>
  <div class="midnight-send-root">
    <BaseDialog
      :isOpen="isOpen"
      @close="onDialogClose"
      :title="t('wallet.quickSend')"
      :loading="false"
      :min-height="0"
      :subtitle="t('wallet.quickSendSubtitle', { currency: selectedTicker })"
      :persistent="sending"
      :img="assets.sendSvg"
      :width="sending ? 468 : 428"
      imgStyle="filter: brightness(0) saturate(100%) invert(100%) sepia(49%) saturate(2%) hue-rotate(47deg) brightness(118%) contrast(101%);"
    >
      <!-- Stepper indicator — identical markup/styling to the Cardano SendDialog.
           Hidden while sending; the progress timeline takes over. -->
      <v-card-title v-if="!sending" style="display: block;" class="pa-0">
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

      <v-card-text class="send-dialog-content px-3 pb-0">
        <!-- ── Send-in-progress: left summary + right stage timeline ── -->
        <div v-if="sending" class="midnight-progress-view">
          <div class="mpv-summary">
            <div class="mpv-summary-amount">{{ amount || '0' }} {{ selectedTicker }}</div>
            <div class="mpv-summary-to">
              <span class="mpv-summary-to-label">{{ t('common.to') }}</span>
              <span class="mpv-summary-to-addr">{{ truncate(recipient.trim()) }}</span>
            </div>
            <div v-if="dustBattery" class="mpv-summary-dust">
              <div class="mpv-summary-dust-head">
                <v-icon size="12" color="var(--g-accent)" class="mr-1">mdi-lightning-bolt</v-icon>
                <span>{{ dustCurrency }}</span>
                <span class="mpv-summary-dust-pct">{{ dustBattery.percent }}%</span>
              </div>
              <div class="mpv-summary-dust-track">
                <div class="mpv-summary-dust-fill" :style="{ width: dustBattery.percent + '%' }"></div>
              </div>
              <div class="mpv-summary-dust-note">{{ t('midnight.send.dustResetShort') }}</div>
            </div>
          </div>

          <MidnightSendTimeline class="mpv-timeline" :nodes="timelineNodes" />
        </div>

        <CustomStepper v-else :currentStep="currentStep" :steps="steps">
          <!-- ── Step 1: Recipient + amount ── -->
          <v-stepper-content step="1">
            <div class="step-recipients-wrapper">
              <div class="step-recipients-inner" :class="{ shake: shakeError }">
                <!-- Balance selector, NOT a privacy mode toggle. Shielded and unshielded
                     are separate ledger systems (spec/zswap.md vs spec/night.md) and the
                     ledger states they "are not usually interchangeable" — the issuing
                     contract fixes a token's shieldedness, the sender never chooses it.
                     So this picks WHICH BALANCE is being spent, and the label has to say
                     so or it reads as "send this privately", which is not a thing. -->
                <div v-if="shieldedAvailable" class="balance-source-label t-label">
                  {{ t('midnight.send.spendFrom') }}
                </div>
                <v-tabs
                  v-if="shieldedAvailable"
                  v-model="activeTab"
                  background-color="transparent"
                  centered
                  grow
                  hide-slider
                  class="mb-1 midnight-send-tabs"
                >
                  <v-tab :disabled="sending" class="midnight-send-tab">
                    {{ t('midnight.send.tabUnshielded') }}
                  </v-tab>
                  <v-tab :disabled="sending" class="midnight-send-tab">
                    {{ t('midnight.send.tabShielded') }}
                  </v-tab>
                </v-tabs>
                <div v-if="shieldedAvailable" class="balance-source-hint mb-3">
                  {{ t('midnight.send.shieldednessIsIssuerSet') }}
                </div>

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
                        color="var(--g-accent)"
                      >
                        <template v-slot:append>
                          <v-icon
                            v-if="recipient"
                            style="font-size: 14px; cursor: pointer; opacity: 0.6;"
                            color="var(--g-text-1)"
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
                        <v-icon small color="var(--g-accent)">mdi-qrcode</v-icon>
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
                          <!-- Only a picker once there is a genuine choice; a
                               NIGHT-only wallet keeps the original chip. -->
                          <v-select
                            v-if="assetOptions.length > 1"
                            v-model="selectedToken"
                            :items="assetOptions"
                            item-value="value"
                            item-text="ticker"
                            dense
                            outlined
                            hide-details
                            attach
                            class="asset-select"
                            :disabled="sending"
                            :aria-label="t('common.asset')"
                          />
                          <template v-else>
                            <v-avatar size="20" class="mr-1">
                              <img :src="midnightLogo" :alt="nightCurrency" />
                            </v-avatar>
                            <span class="token-ticker">{{ selectedTicker }}</span>
                            <v-icon
                              x-small
                              color="var(--g-accent)"
                              class="ml-1"
                              style="margin-top: -1px; font-size: 11px;"
                            >mdi-check-decagram</v-icon>
                          </template>
                          <span class="token-balance">{{ formattedAvailable }}</span>
                        </div>
                        <div class="token-row__right">
                          <v-text-field
                            v-model="amount"
                            type="number"
                            min="0"
                            :step="amountStep"
                            outlined
                            dense
                            hide-details="auto"
                            class="amount-input"
                            placeholder="0"
                            :rules="amountRules"
                            :disabled="sending"
                          />
                          <v-btn
                            text
                            x-small
                            color="var(--g-accent)"
                            class="max-btn"
                            :disabled="sending"
                            @click="setMax"
                          >MAX</v-btn>
                        </div>
                      </div>
                      <div v-if="isShielded" class="token-info">
                        <v-icon x-small color="var(--g-text-3)" class="mr-1">mdi-information-outline</v-icon>
                        {{ t('midnight.send.shieldedBalanceNote') }}
                      </div>
                      <div v-if="noFeeCapacity" class="token-info">
                        <v-icon x-small color="var(--g-warning)" class="mr-1">mdi-alert-outline</v-icon>
                        {{ t('midnight.send.noDustFee') }}
                      </div>
                      <MidnightSponsorPicker
                        v-if="noFeeCapacity && loggedWallet"
                        :value="sponsorWalletId"
                        :sender-wallet-id="loggedWallet.id"
                        :network="loggedWallet.network"
                        @input="sponsorWalletId = $event"
                      />
                      <!-- Unlock block for the chosen sponsor. Both branches name
                           BOTH wallets: the single likeliest mistake here is
                           entering the sending wallet's credential. -->
                      <div v-if="sponsorWallet" class="sponsor-unlock">
                        <template v-if="sponsorNeedsPassword">
                          <v-text-field
                            v-model="sponsorPassword"
                            type="password"
                            autocomplete="off"
                            dense
                            outlined
                            hide-details="auto"
                            :label="t('midnight.sponsor.passwordLabel', { name: sponsorWallet.name })"
                          />
                          <div class="sponsor-unlock__warn">
                            {{ t('midnight.sponsor.notSenderPassword', {
                              sender: loggedWallet ? loggedWallet.name : '',
                            }) }}
                          </div>
                        </template>
                        <!-- A PassKey sponsor used to show NOTHING here: the first
                             sign of a second credential was the browser's own
                             prompt, mid-send. -->
                        <div v-else class="sponsor-unlock__passkey">
                          <v-icon small class="mr-2">mdi-fingerprint</v-icon>
                          <span>
                            {{ t('midnight.sponsor.passkeyNotice', {
                              name: sponsorWallet.name,
                              sender: loggedWallet ? loggedWallet.name : '',
                            }) }}
                          </span>
                        </div>

                      </div>
                      <div v-else-if="rawUnits" class="token-info">
                        <v-icon x-small color="var(--g-text-3)" class="mr-1">mdi-information-outline</v-icon>
                        {{ t('midnight.send.rawUnitsNote') }}
                      </div>
                    </div>
                  </div>
                </v-form>

                <!-- Global total — identical styling to the Cardano step-1 total. -->
                <div v-if="amount && Number(amount) > 0" class="global-total">
                  <div class="global-total__row global-total__fee-row">
                    <span class="global-total__fee-label">{{ t('midnight.send.estimatedNetworkFee') }}</span>
                    <span class="global-total__fee">{{ feeEstimateDisplay }} {{ dustCurrency }}</span>
                  </div>
                  <div class="global-total__row global-total__total-row">
                    <span class="global-total__label">{{ t('common.total') }}</span>
                    <div>
                      <span class="global-total__ada">{{ amount }} {{ selectedTicker }}</span>
                    </div>
                  </div>
                </div>

                <MidnightPrivateBalances />
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
                :unit="selectedTicker"
                :fee-unit="dustCurrency"
                :fee-label="t('midnight.send.estimatedNetworkFee')"
              />
              <!-- Public-chain disclosure: unshielded transfers are indexer-visible.
                   Informational, not a warning - no error/warning coloring. -->
              <div v-if="!isShielded" class="midnight-info-note mt-3">
                <v-icon size="14" color="var(--g-text-3)" class="mr-1">mdi-eye-outline</v-icon>
                <span>{{ t('midnight.send.publicTxNote') }}</span>
              </div>
              <!-- Sponsored sends carry a second, different disclosure: an
                   honest unknown about on-chain linkability, not a promise. -->
              <div v-if="sponsorWallet" class="midnight-info-note mt-2">
                <v-icon size="14" color="var(--g-text-3)" class="mr-1">mdi-link-variant</v-icon>
                <span>{{ t('midnight.sponsor.disclosureLinkability') }}</span>
              </div>
              <!-- Who is unlocked for this send, with a way back to the picker. -->
              <div v-if="sponsorWallet" class="sponsor-review mt-2">
                <span class="sponsor-review__av">{{ initialsOf(sponsorWallet.name) }}</span>
                <span class="sponsor-review__body">
                  <span class="sponsor-review__name">{{ sponsorWallet.name }}</span>
                  <span class="sponsor-review__sub">{{ t('midnight.sponsor.feeWalletUnlocked') }}</span>
                </span>
                <span class="grow"></span>
                <button type="button" class="sponsor-review__change" @click="currentStep = 1">
                  {{ t('midnight.sponsor.change') }}
                </button>
              </div>
              <!-- DUST fee note (fee is ~1 Speck; sending does NOT reset DUST —
                   verified on preprod, the old "reset" was an estimator bug).
                   Suppressed when the low-DUST hint below is showing, so only
                   one DUST note renders at a time. -->
              <div v-if="!isShielded && !isDustLow" class="midnight-dust-note mt-3">
                <v-icon size="14" color="warning" class="mr-1">mdi-information-outline</v-icon>
                <span>{{ t('midnight.send.dustResetWarning') }}</span>
              </div>
              <!-- Low-DUST hint: informational (neutral) while any DUST remains —
                   the fee is tiny so the send still goes through. Red only when
                   DUST is genuinely empty and the fee can't be paid. -->
              <div
                v-if="!isShielded && isDustLow"
                class="mt-3"
                :class="isDustEmpty ? 'midnight-dust-note midnight-dust-note--low' : 'midnight-info-note'"
              >
                <v-icon size="14" :color="isDustEmpty ? 'error' : 'var(--g-text-3)'" class="mr-1">mdi-battery-alert-variant-outline</v-icon>
                <span>{{ t('midnight.send.dustLowHint', { percent: dustBattery.percent }) }}</span>
              </div>
            </div>
          </v-stepper-content>
        </CustomStepper>
      </v-card-text>

      <!-- Actions — Continue (step 1) / auth + Sign (step 2) / Back.
           Hidden while sending; the timeline is the only affordance then. -->
      <v-card-actions v-if="!sending" class="send-dialog-actions" style="flex-flow: column;">
        <div v-if="currentStep === 2">
          <TransactionAuthSection
            :wallet-type="loggedWallet?.type"
            :is-prf-wallet="isPrfWallet"
            :is-signed="false"
            :loading="sending || checkingLocalProver"
            :password="password"
            @update:password="password = $event"
            :password-label="t('send.spendingPassword')"
            :password-rules="passwordRules"
            :submit-text="t('midnight.signAndSend')"
            @passkey-prf-output="onPasskeyPrfOutput"
            @passkey-error="onPasskeyError"
            @submit="submitWithPassword"
            button-style="width: 295px; margin-bottom: 1px;"
            button-class="mb-2"
          />
        </div>

        <!-- Local proof server didn't answer its health check (WP-P5): offer
             the two-action fallback instead of a generic error string. The
             auth section above stays visible/usable so re-submitting after
             starting the server just works. -->
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
            :disabled="sending || checkingLocalProver"
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
            <v-icon style="color: var(--g-on-grad)!important;" small class="ml-1">mdi-arrow-right</v-icon>
          </v-btn>
          <!-- Step 2: password wallets submit here (TransactionAuthSection only
               renders the field for them); PRF wallets submit via the PassKey
               button rendered inside TransactionAuthSection above. -->
          <v-btn
            v-else-if="currentStep === 2 && !isPrfWallet"
            class="continue-button"
            @click="submitWithPassword"
            :disabled="sending || checkingLocalProver"
            :loading="sending || checkingLocalProver"
          >{{ t('midnight.signAndSend') }}</v-btn>
        </div>
      </v-card-actions>
    </BaseDialog>

    <!-- First-time-only consent gate for shielded sends. `provider` names
         the actual witness destination the copy must disclose (Gero Cloud
         vs Arkhia zkPaaS). -->
    <ShieldedProvingConsentDialog
      :is-open="consentDialogOpen"
      :provider="consentProvider"
      @close="onConsentClose"
      @accepted="onConsentAccepted"
    />
  </div>
</template>

<script setup lang="ts">
import { hasMidnightProvingConsent, type MidnightRemoteProver } from '@/chains/midnight/midnightProvingConsent';
import MidnightPrivateBalances from '@/modules/dashboard/components/MidnightPrivateBalances.vue';
import { computed, onMounted, ref, toRefs, watch } from 'vue';
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
import MidnightSponsorPicker from '@/modules/dashboard/dialogs/MidnightSponsorPicker.vue';
import { geroStore } from '@/stores/geroStore';
import MidnightSendTimeline from '@/shared/components/MidnightSendTimeline.vue';
import { chargePercent, type SponsorCandidate } from '@/chains/midnight/midnightSponsorEligibility';
import { settingsNavRequest } from '@/shared/composables/useGlobalSearch';
import {
  midnightStore,
} from '@/stores/midnightStore';
import type { MidnightSendStage } from '@/services/midnight-tx.service';
import { walletStore } from '@/stores/walletStore';
import { Blockchain, Network, WalletType } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { midnightTokenBalances } from '@/chains/midnight/midnightTokenBalances';
import { midnightTokenMeta } from '@/chains/midnight/midnightTokenRegistry';
import { blocksMidnightSend } from '@/chains/midnight/midnightFeeCapacity';
import {
  formatTokenAmount,
  parseTokenAmount,
  toAmountInput,
} from '@/chains/midnight/midnightAmount';
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

// The raw zswap viewing key is a forever-decrypt secret and is deliberately
// kept out of midnightStore (see midnightStore.setActive) — the UI only needs
// to know whether shielded sync is available, which the store publishes as a
// boolean derived from the same `mn_shield-esk_` validity check.
const shieldedAvailable = computed(() => midnightStore.privateSyncStatus === 'synced'
  && Object.keys(midnightStore.balances.shieldedTokens ?? {}).length > 0);

const activeTab = ref(0);
const isShielded = computed(() => activeTab.value === 1);

/** `NIGHT` for the native token, otherwise a 32-byte colour as hex. */
const selectedToken = ref<string>('NIGHT');

/** Per-colour unshielded balances derived from the wallet's own UTxO set. */
const tokenBalances = computed(() => midnightTokenBalances(midnightStore.utxos ?? []));

interface AssetOption {
  value: string;
  ticker: string;
  /**
   * Decimal exponent, or null when the token isn't in the registry. null means
   * "unknown", NOT zero-with-a-shrug: amounts are then entered and shown as raw
   * base units and the UI says so. Guessing 6 here could send 1000x too much.
   */
  decimals: number | null;
}

const assetOptions = computed<AssetOption[]>(() => {
  const night: AssetOption = {
    value: 'NIGHT',
    ticker: nightCurrency.value,
    decimals: MIDNIGHT_DECIMALS.NIGHT,
  };
  const tokens = Object.entries(isShielded.value ? (midnightStore.balances.shieldedTokens ?? {}) : tokenBalances.value).map(([color, _bal]) => {
    const meta = midnightTokenMeta(color);
    return {
      value: color,
      ticker: meta?.symbol ?? `${color.slice(0, 8)}\u2026${color.slice(-6)}`,
      decimals: meta?.decimals ?? null,
    } as AssetOption;
  });
  return isShielded.value ? tokens : [night, ...tokens];
});

const selectedAsset = computed<AssetOption>(
  () => assetOptions.value.find((o) => o.value === selectedToken.value) ?? assetOptions.value[0] ?? { value: '', ticker: t('midnight.shielded') as string, decimals: null },
);
watch(assetOptions, options => {
  if (!options.some(option => option.value === selectedToken.value)) selectedToken.value = options[0]?.value ?? '';
}, { immediate: true });
/** null decimals => raw base units, so the divisor is 1 and nothing is scaled. */
const selectedDecimals = computed(() => selectedAsset.value.decimals);
const selectedTicker = computed(() => selectedAsset.value.ticker);
const rawUnits = computed(() => selectedDecimals.value === null);
const amountStep = computed(() =>
  rawUnits.value ? '1' : `0.${'0'.repeat((selectedDecimals.value ?? 1) - 1)}1`,
);

/**
  * No spendable DUST means no fee can be paid, so the send cannot succeed.
  * Caught here rather than four steps later inside the SDK's
  * `balanceTransactions`, which neither returns nor throws in that state.
  */
const noFeeCapacity = computed(() => blocksMidnightSend(midnightStore.dustState));

/**
 * Wallet chosen to pay this send's DUST fee, or null to pay from this wallet.
 * Only set while `noFeeCapacity` holds — the picker is the only writer.
 */
const sponsorWalletId = ref<number | null>(null);

/**
 * A missing DUST balance only blocks the send when nothing else will pay for
 * it. With a sponsor chosen the fee comes from that wallet, so the step-1 guard
 * must stand down — otherwise the feature is unreachable from the one screen
 * that needs it.
 */
const blockedByFee = computed(() => noFeeCapacity.value && sponsorWalletId.value == null);

/** The chosen sponsor's stored record, for deciding how to unlock it. */
const sponsorWallet = computed(() => (
  sponsorWalletId.value == null ? null : (geroStore.wallets?.[sponsorWalletId.value] ?? null)
));

/**
 * A PassKey sponsor is unlocked by a prompt; a password sponsor needs its OWN
 * password. Never the sender's — the two wallets are independently encrypted.
 */
const sponsorNeedsPassword = computed(() => (
  !!sponsorWallet.value && sponsorWallet.value.encryptionMethod !== 'prf'
));
const sponsorPassword = ref('');

/**
 * Live state for the chosen sponsor — its DUST charge drives the progress
 * battery and the review card. Resolved from live registrations, never from
 * the dashboard battery (which can carry a previous wallet's figure).
 */
const sponsorCandidate = ref<SponsorCandidate | null>(null);

async function refreshSponsorCandidate(): Promise<void> {
  sponsorCandidate.value = null;
  const wallet = loggedWallet.value;
  const id = sponsorWalletId.value;
  if (!wallet || id == null) return;
  const { loadSponsorCandidates } = await import('@/chains/midnight/midnightSponsorLookup');
  const { candidates } = await loadSponsorCandidates(wallet.id, wallet.network);
  sponsorCandidate.value = candidates.find((c) => c.walletId === id) ?? null;
}
watch(() => sponsorWalletId.value, refreshSponsorCandidate);

/**
 * Restore the wallet's stored sponsor preference when the dialog opens. The
 * picker still re-resolves whether that wallet can actually pay — a stale
 * preference degrades to "not ready" there rather than producing a failing
 * send.
 */
async function restoreSponsorPreference(): Promise<void> {
  const wallet = loggedWallet.value;
  if (!wallet) return;
  const { linkFor, loadSponsorLinks } = await import('@/chains/midnight/midnightSponsorLinks');
  const link = linkFor(await loadSponsorLinks(), wallet.id, wallet.network);
  sponsorWalletId.value = link?.sponsorWalletId ?? null;
}
onMounted(restoreSponsorPreference);

/**
 * The sponsor argument for `sendUnshieldedNight`, collecting that wallet's own
 * credential. Returns undefined for an unsponsored send.
 *
 * The PassKey prompt happens HERE rather than inside the send so the second
 * approval is raised before any network work starts — the review step warns
 * the user to expect two.
 */
async function buildSponsorArg() {
  const sponsor = sponsorWallet.value;
  if (!sponsor) return undefined;

  if (sponsor.encryptionMethod === 'prf') {
    if (!sponsor.webAuthnCredentialId) throw new Error(t('midnight.sponsor.unlockFailed') as string);
    const { evaluateWalletPrf } = await import('@/shared/utils/passkeyPrf');
    const buf = await evaluateWalletPrf({
      id: sponsor.id,
      webAuthnCredentialId: sponsor.webAuthnCredentialId,
      webAuthnTransports: sponsor.webAuthnTransports,
    });
    return { walletId: sponsor.id, prfSecret: new Uint8Array(buf) };
  }

  if (!sponsorPassword.value) throw new Error(t('midnight.sponsor.passwordRequired') as string);
  return { walletId: sponsor.id, password: sponsorPassword.value };
}

const available = computed(() => {
  if (isShielded.value) return midnightStore.balances.shieldedTokens?.[selectedToken.value] ?? 0n;
  if (selectedToken.value === 'NIGHT') return midnightStore.balances?.nightUnshielded ?? 0n;
  return tokenBalances.value[selectedToken.value] ?? 0n;
});
const formattedAvailable = computed(() => {
  return formatTokenAmount(available.value, selectedDecimals.value);
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
    // No trailing underscore: mainnet addresses are bare mn_addr1…/
    // mn_shield-addr1… (shield checked first — 'mn_addr' is not its prefix).
    if (v.startsWith('mn_shield-addr')) {
      if (activeTab.value !== 1) activeTab.value = 1;
    } else if (v.startsWith('mn_addr')) {
      if (activeTab.value !== 0) activeTab.value = 0;
    }
  },
);

const amount = ref('');
const password = ref('');
const sending = ref(false);
const errorMessage = ref<string | null>(null);

// ── Send progress timeline ──
// High-level stage of the in-flight send, driven by sendUnshieldedNight's
// onStage callback. The `working` stage (BG balance+sign round-trip) is split
// into "sync DUST" vs "sign" in the UI using the live percentage the BG
// broadcasts into midnightStore.sendProgress.
type SendStageOrIdle = MidnightSendStage | 'idle';
const sendStage = ref<SendStageOrIdle>('idle');

// `provingLocal`/`provingZkpaas` share `working`'s rank: the three are
// mutually exclusive (wallet-side shielded sends emit a proving stage in
// place of `working`, see midnight-tx.service's sendShieldedNight) and
// occupy the same position in every send's stage sequence — authorize →
// (build →) working-or-proving → submit → done.
const STAGE_RANK: Record<SendStageOrIdle, number> = {
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
  const s = sendStage.value;
  const rank = STAGE_RANK[s] ?? 0;
  const prog = midnightStore.sendProgress;
  const pct = prog && prog.phase === 'syncingDust' ? prog.percent : null;
  // Within the single BG `working` stage: sync is active until the ledger
  // replay hits 100%, then sign takes over until the call resolves.
  const syncDone = pct != null && pct >= 100;
  const syncActive = s === 'working' && !syncDone;
  const signActive = s === 'working' && syncDone;
  // Wallet-side shielded sends (WP-P5 local; zkPaaS hosted): the BG round
  // trip is one opaque proving+binding call with no percent signal, so it
  // gets a single indeterminate-bar node (staged copy, not a fake
  // percentage — rule 14) rather
  // than the sync/sign split above, which is specific to DUST-balance sync.
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
      label: provingActive
        ? provingLabel
        : (sponsorWallet.value
          ? t('midnight.send.stageSyncNamed', { name: sponsorWallet.value.name })
          : t('midnight.send.stageSync')),
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

// Compact DUST battery for the progress summary (current / cap), so the user
// sees their DUST level while the send runs and the reset note has context.
const dustBattery = computed<{ percent: number } | null>(() => {
  // A sponsored send draws down the SPONSOR's DUST, so that is the bar to
  // show. Reading midnightStore.dustState here is the sender's state, which
  // for a sponsored send is empty by definition (that is why a sponsor was
  // needed) — so cap is 0, this returns null, and the whole block used to
  // disappear at exactly the moment it mattered most.
  if (sponsorWalletId.value != null) {
    const pct = sponsorCandidate.value ? chargePercent(sponsorCandidate.value) : null;
    return pct === null ? null : { percent: pct };
  }
  const ds = midnightStore.dustState;
  if (!ds || ds.cap <= 0n) return null;
  const raw = Number((ds.current * 10000n) / ds.cap) / 100;
  return { percent: Math.max(0, Math.min(100, Math.round(raw))) };
});

// Below this the review step swaps the general fee note for the low-DUST hint
// (they overlap, so only one shows at a time).
const isDustLow = computed(() => !!dustBattery.value && dustBattery.value.percent < 20);

// Truly empty DUST: the (~1 Speck) fee can't be paid, so the hint escalates to
// the error tone. Any nonzero DUST covers the fee and stays informational.
const isDustEmpty = computed(() => {
  const ds = midnightStore.dustState;
  return !!ds && ds.current <= 0n;
});

const consentDialogOpen = ref(false);
const pendingCredentials = ref<{ password?: string; prfSecret?: Uint8Array } | null>(null);

// ── Local proof-server routing (WP-P5) ──
// True while the health preflight for a wallet-side (local or zkPaaS)
// shielded send is in-flight — keeps Step 2 visible (no big "sending"
// overlay) with just the submit button showing a spinner, since the check
// is quick (~2.5s) and nothing has actually started yet.
const checkingLocalProver = ref(false);
// Which remote prover the consent dialog is about when it opens — set at
// each open site (zkpaas for a first zkPaaS send, cloud everywhere else,
// including the one-off "use Gero Cloud" fallback).
const consentProvider = ref<'cloud' | 'zkpaas'>('cloud');
// Fallback-note copy tracks the mode that failed its preflight.
const proverFallbackText = computed(() => (
  midnightStore.proofServer.mode === 'zkpaas'
    ? t('midnight.proofServer.zkpaasNotReachableSend')
    : t('midnight.proofServer.notDetectedSend')
));
// True once a local-mode shielded send's preflight (or, on the rare race
// where the server drops between preflight and build, the BG call itself)
// finds the local proof server unreachable. Renders the two-action fallback
// in place of a generic error string.
const localProverUnavailable = ref(false);
// Set for exactly one send by "Use Gero Cloud for this transaction": routes
// that single attempt through the remote path without touching the user's
// stored proofServer.mode. Consumed (reset to false) the moment sendShielded
// reads it.
const forceRemoteForNextSend = ref(false);

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

// Midnight bech32m HRP is mn_<type>[_<network>]1<data>; MAINNET OMITS the
// network segment (bare mn_addr1…), other networks embed it lowercased
// (mn_addr_preview1…). Including the '1' separator makes the prefix check
// exact per network — previously only the generic 'mn_addr_' was checked,
// which accepted wrong-network addresses everywhere and hard-rejected every
// legitimate mainnet address.
function expectedAddressPrefix(kind: 'addr' | 'shield-addr'): string {
  const isMain = loggedWallet.value?.network === Network.MAINNET;
  return isMain
    ? `mn_${kind}1`
    : `mn_${kind}_${(loggedWallet.value?.network || '').toLowerCase()}1`;
}

const addressRules = computed(() => {
  if (isShielded.value) {
    const prefix = expectedAddressPrefix('shield-addr');
    return [
      (v: string) => !!v || t('midnight.send.shieldedAddressRequired'),
      (v: string) => v.startsWith(prefix) || t('midnight.send.shieldedAddressPrefix', { prefix }),
    ];
  }
  const prefix = expectedAddressPrefix('addr');
  return [
    (v: string) => !!v || t('midnight.send.addressRequired'),
    (v: string) => v.startsWith(prefix) || t('midnight.send.addressPrefix', { prefix }),
  ];
});

const amountRules = computed(() => [
  (v: string) => !!v || t('midnight.send.amountRequired'),
  // Positivity is judged by the SAME parser that builds the transaction.
  // Number() disagreed with it in two ways that both submitted a 0-unit tx:
  //   - Number('1e2') is 100, but exponential notation isn't a plain decimal
  //     so parseTokenAmount returns 0n — and <input type="number"> accepts it
  //   - an amount below one base unit ('0.0000001' at 6 decimals) truncates
  //     to 0n while Number() still calls it positive
  // The balance rule below is an upper bound only, so nothing else caught 0n.
  (v: string) => parseAmount(v) > 0n || t('send.amountMustBePositive'),
  (v: string) => parseAmount(v) <= available.value || t('errors.insufficientBalance'),
]);

/** Scales against the SELECTED token's decimals — see midnightAmount.ts. */
function parseAmount(input: string): bigint {
  return parseTokenAmount(input, selectedDecimals.value);
}

function setMax() {
  amount.value = toAmountInput(available.value, selectedDecimals.value);
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
  // Split the single "You pay" line when another wallet covers the fee, so
  // the DUST cost is never shown without naming whose DUST it is.
  sponsor: sponsorWallet.value && loggedWallet.value
    ? {
      senderName: loggedWallet.value.name,
      senderInitials: initialsOf(loggedWallet.value.name),
      sponsorName: sponsorWallet.value.name,
      sponsorInitials: initialsOf(sponsorWallet.value.name),
    }
    : undefined,
}));

/** Two-letter monogram for the attributed summary rows. */
function initialsOf(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

// ── Step navigation ──
function nextStep() {
  errorMessage.value = null;
  if (currentStep.value === 1) {
    if (blockedByFee.value) {
      errorMessage.value = t('midnight.send.noDustFee');
      return;
    }
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

function hasFreshConsent(provider: MidnightRemoteProver): boolean {
  return hasMidnightProvingConsent(midnightStore.shieldedProvingConsent, provider);
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
  const mode = midnightStore.proofServer.mode;
  // Local proof-server mode never needs cloud consent — witness data stays
  // on the user's machine — so it skips the consent dialog entirely and
  // goes straight to a health preflight (WP-P5, plan section "WP-P5 - Consent
  // dialog + send-flow integration"). Arkhia zkPaaS ships the witness to a
  // third party, so it is consent-gated exactly like Gero Cloud and THEN
  // preflighted like local.
  if (mode === 'local') {
    await routeWalletProvedShielded(credentials);
    return;
  }
  if (hasFreshConsent(mode === 'zkpaas' ? 'zkpaas' : 'cloud')) {
    if (mode === 'zkpaas') {
      await routeWalletProvedShielded(credentials);
      return;
    }
    await dispatchSend(credentials);
    return;
  }
  pendingCredentials.value = credentials;
  consentProvider.value = mode === 'zkpaas' ? 'zkpaas' : 'cloud';
  consentDialogOpen.value = true;
}

/**
 * Wallet-side (local or zkPaaS) shielded send routing: preflight the
 * selected proof server before ever touching the "sending" overlay. A
 * fast, explicit check here (rather than letting sendShieldedNight's own
 * internal preflight surface via a caught error) keeps Step 2 on screen
 * with just a spinner instead of flashing the full progress timeline for a
 * doomed send. Target resolution lives in the tx service so the two can
 * never disagree about which URL/auth a send would use.
 */
async function routeWalletProvedShielded(credentials: { password?: string; prfSecret?: Uint8Array }) {
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
  await dispatchSend(credentials);
}

/** "Open settings" fallback action — navigates to Settings > Advanced (the
 * Midnight proof server section, WP-P4) via the same decoupled channel
 * GlobalSearch uses, so this dialog doesn't need a direct reference to
 * SettingsDialog/ContentLayout. */
function openProofServerSettings() {
  settingsNavRequest.value = { tab: 'advanced' };
}

/**
 * "Use Gero Cloud for this transaction" fallback action — sends this one
 * shielded transfer via the remote path without changing the user's stored
 * `proofServer.mode`. Reuses the already-entered credentials from the failed
 * local attempt (`pendingCredentials`) rather than asking the user to
 * re-authenticate. Still gated on cloud consent like any other remote send.
 */
function useCloudForThisTransaction() {
  const credentials = pendingCredentials.value;
  if (!credentials) return;
  localProverUnavailable.value = false;
  forceRemoteForNextSend.value = true;
  if (hasFreshConsent('cloud')) {
    pendingCredentials.value = null;
    void dispatchSend(credentials);
    return;
  }
  // pendingCredentials stays set — onConsentAccepted below reads it once the
  // user accepts the cloud consent dialog. The fallback always goes to Gero
  // Cloud (even from zkpaas mode), so the consent copy must say Gero Cloud.
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
  const mode = midnightStore.proofServer.mode;
  const recipient = forceRemoteForNextSend.value || mode !== 'zkpaas' ? 'cloud' : 'zkpaas';
  if (!forceRemoteForNextSend.value && mode !== 'local' && recipient !== consentProvider.value) {
    await routeSend(credentials);
    return;
  }
  // A freshly-consented zkPaaS send still needs its preflight; the one-off
  // "use Gero Cloud" fallback (forceRemoteForNextSend) goes straight to the
  // remote path instead — sendShielded consumes that flag.
  if (!forceRemoteForNextSend.value && midnightStore.proofServer.mode === 'zkpaas') {
    await routeWalletProvedShielded(credentials);
    return;
  }
  await dispatchSend(credentials);
}

async function dispatchSend(credentials: { password?: string; prfSecret?: Uint8Array }) {
  if (isShielded.value) await sendShielded(credentials);
  else await sendUnshielded(credentials);
}

async function sendUnshielded(credentials: { password?: string; prfSecret?: Uint8Array }) {
  const wallet = loggedWallet.value;
  if (!wallet) return;
  const forceRemote = forceRemoteForNextSend.value;
  forceRemoteForNextSend.value = false;
  localProverUnavailable.value = false;
  sending.value = true;
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
      forceRemote,
    );
    debugLog('🌙 Midnight unshielded tx submitted:', result.txHash, 'status:', result.status,
      'sponsor:', sponsorWalletId.value ?? 'none');

    // Remember who paid — for the dashboard indicator on BOTH wallets, and so
    // the transaction details screen can say the fee came from elsewhere.
    // Best effort: a storage failure must never fail a submitted transaction.
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
    // Brief completed-state hold so the user sees the timeline finish.
    await new Promise((r) => setTimeout(r, 550));
    resetForm();
    emit('close');
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e);
  } finally {
    sending.value = false;
    sendStage.value = 'idle';
  }
}

async function sendShielded(credentials: { password?: string; prfSecret?: Uint8Array }) {
  const wallet = loggedWallet.value;
  if (!wallet) return;
  // Consumed here (not left for sendShieldedNight to re-read) so a second,
  // unrelated shielded send later in the same dialog session never
  // accidentally inherits a one-off "use cloud" override.
  const forceRemote = forceRemoteForNextSend.value;
  forceRemoteForNextSend.value = false;
  // Every entry point into sendShielded (routeLocalShielded, the direct
  // fresh-consent path, and onConsentAccepted) should start from a clean
  // fallback state — otherwise a stale fallback from an earlier local-mode
  // attempt could resurface next to an unrelated later error.
  localProverUnavailable.value = false;
  sending.value = true;
  sendStage.value = 'authorizing';
  try {
    const { sendShieldedNight } = await import('@/services/midnight-tx.service');
    const result = await sendShieldedNight(
      wallet.network,
      [{
        receiverAddress: recipient.value.trim(),
        amount: parseAmount(amount.value),
        tokenType: selectedToken.value,
      }],
      credentials,
      'InBlock',
      (stage) => { sendStage.value = stage; },
      forceRemote,
      await buildSponsorArg(),
    );
    debugLog('🌙 Midnight shielded tx submitted:', result.txHash, 'status:', result.status);
    void addOptimisticPendingTx(result.txHash, true);
    await new Promise((r) => setTimeout(r, 550));
    resetForm();
    emit('close');
  } catch (e) {
    // Named rather than instanceof-checked: ProofServerUnreachableError is
    // reached here via a dynamic import, and name-based matching sidesteps
    // any doubt about identity across that boundary. Thrown by
    // sendShieldedNight's OWN internal preflight — normally routeLocalShielded
    // above already caught this before the "sending" overlay ever showed, so
    // reaching it here means the server dropped in the narrow window between
    // that preflight and this call. Same fallback either way.
    if (e instanceof Error && e.name === 'ProofServerUnreachableError') {
      pendingCredentials.value = credentials;
      localProverUnavailable.value = true;
    } else {
      errorMessage.value = e instanceof Error ? e.message : String(e);
    }
  } finally {
    sending.value = false;
    sendStage.value = 'idle';
  }
}

// Insert the just-submitted tx into history immediately (values captured
// synchronously so a later resetForm can't blank them out).
async function addOptimisticPendingTx(hash: string, shielded = false) {
  const amountBig = parseAmount(amount.value);
  const to = recipient.value.trim();
  // Preserve the selected public or private custom token in pending history.
  const token = selectedToken.value;
  try {
    const { addPendingMidnightTx } = await import('@/services/midnight-tx.service');
    await addPendingMidnightTx(hash, amountBig, to, shielded, token);
  } catch {
    /* non-fatal — gero-sync backfills the confirmed entry */
  }
}

// Block dismissal while a send is running (the BG work continues even if the
// UI closes, so keep the timeline visible until it resolves).
function onDialogClose() {
  if (sending.value) return;
  // Abandon any pending local-prover-fallback attempt rather than letting it
  // resurface stale on next open — matches the existing consent-cancel
  // behaviour (onConsentClose), which drops pendingCredentials the same way.
  localProverUnavailable.value = false;
  pendingCredentials.value = null;
  forceRemoteForNextSend.value = false;
  emit('close');
}

function resetForm() {
  recipient.value = '';
  amount.value = '';
  // Back to NIGHT: a fresh send shouldn't inherit the last session's asset.
  selectedToken.value = 'NIGHT';
  password.value = '';
  currentStep.value = 1;
  sendStage.value = 'idle';
  localProverUnavailable.value = false;
  forceRemoteForNextSend.value = false;
}

// Reset to step 1 whenever the dialog re-opens.
watch(
  () => currentStep.value,
  () => { errorMessage.value = null; },
);

/** Token colours are 64-char hex; show the head so a label stays readable. */
function shortToken(colour: string): string {
  return colour.length > 12 ? `${colour.slice(0, 6)}…` : colour;
}
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

.send-dialog-actions {
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
  box-shadow: 0 0 0 4px #00dff327;
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

/* ─── Recipient card + asset row — copied from SendRecipientCard /
   AssetsToSendStep so the Midnight step 1 matches the Cardano one. ─── */
.recipient-card {
  background-color: var(--g-hairline-1);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
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
  background-color: var(--g-raised) !important;
  border-radius: var(--g-r-control);
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
  border-color: var(--g-accent) !important;
  border-width: 1px !important;
}
.address-input.error--text :deep(fieldset) {
  border-color: var(--g-error) !important;
}

.assets-section {
  margin-top: 10px;
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
/* Vuetify's `dense` already gives the control its compact height; only the
   width needs constraining so the balance keeps its place in the row. */
.asset-select {
  max-width: 140px;
  flex: 0 0 auto;
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
.token-info {
  font-size: 11px;
  color: var(--g-text-3);
  padding: 4px 2px 0;
  display: flex;
  align-items: center;
  line-height: 1.4;
}

/* ─── Midnight-specific bits ─── */
/* Reads as a balance selector, not a privacy switch: quiet label above, the
   issuer-sets-shieldedness note below. */
.balance-source-label {
  color: var(--g-text-3);
  margin-bottom: 4px;
}

.balance-source-hint {
  font-size: 11px;
  line-height: 1.4;
  color: var(--g-text-3);
}

.midnight-send-tabs :deep(.v-tab) {
  text-transform: none;
  letter-spacing: 0;
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

/* Local proof-server fallback (WP-P5) — reuses .midnight-info-note's tone,
   adds the two-action row underneath the message. */
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

/* ─── Send-progress timeline (right-side, appears while sending) ─── */
.midnight-progress-view {
  display: flex;
  gap: 16px;
  padding: 14px 4px 18px;
  min-height: 230px;
  animation: mpv-fade 0.3s ease;
}
@keyframes mpv-fade {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: none; }
}

/* Left summary column */
.mpv-summary {
  width: 150px;
  flex-shrink: 0;
  border-right: 1px solid var(--g-hairline-1);
  padding-right: 14px;
}
.mpv-summary-amount {
  font-size: 20px;
  font-weight: 700;
  color: var(--g-accent);
  line-height: 1.2;
  word-break: break-word;
}
.mpv-summary-to {
  margin-top: 5px;
  font-size: 11px;
}
.mpv-summary-to-label {
  color: var(--g-text-3);
  margin-right: 4px;
}
.mpv-summary-to-addr {
  color: var(--g-text-2);
}
.mpv-summary-dust {
  margin-top: 16px;
}
.mpv-summary-dust-head {
  display: flex;
  align-items: center;
  font-size: 11px;
  font-weight: 600;
  color: var(--g-text-2);
}
.mpv-summary-dust-pct {
  margin-left: auto;
  color: var(--g-accent);
}
.mpv-summary-dust-track {
  margin-top: 5px;
  height: 4px;
  border-radius: 4px;
  background: var(--g-hairline-1);
  overflow: hidden;
}
.mpv-summary-dust-fill {
  height: 100%;
  border-radius: 4px;
  background: var(--g-accent);
  transition: width 0.45s ease;
}
.mpv-summary-dust-note {
  margin-top: 6px;
  font-size: 11px;
  line-height: 1.4;
  color: var(--g-warning);
}

/* Right timeline column */
.mpv-timeline {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.sponsor-unlock {
  margin-top: var(--g-s-2);
}

.sponsor-unlock__warn {
  margin-top: var(--g-s-1);
  font-size: 11px;
  color: var(--g-warning);
}

.sponsor-unlock__passkey {
  display: flex;
  align-items: flex-start;
  padding: var(--g-s-2);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  font-size: 11px;
  line-height: 1.45;
  color: var(--g-text-2);
}

.sponsor-unlock__note {
  margin-top: var(--g-s-1);
  font-size: 11px;
  color: var(--g-text-3);
}

.sponsor-review {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
}

.sponsor-review .grow {
  flex: 1 1 auto;
}

.sponsor-review__av {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-1);
  font-size: 9px;
  font-weight: 600;
  flex-shrink: 0;
}

.sponsor-review__body {
  display: flex;
  flex-direction: column;
}

.sponsor-review__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-1);
}

.sponsor-review__sub {
  font-size: 11px;
  color: var(--g-text-3);
}

.sponsor-review__change {
  color: var(--g-accent);
  font-size: 11px;
  font-weight: 600;
}
</style>
