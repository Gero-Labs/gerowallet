<template>
  <div class="sol-send">
    <!-- Sent: the signature and where to follow it -->
    <div v-if="sentSignature" class="sol-send__body" data-test="sol-sent">
      <div class="sol-notice sol-notice--success" role="status">
        <v-icon size="small">mdi-check-circle-outline</v-icon>
        <span class="sol-notice__text">{{ $t('solana.sent') }}</span>
      </div>
      <a v-if="sentUrl" :href="sentUrl" target="_blank" rel="noopener noreferrer" class="sol-link">
        {{ $t('solana.viewOnExplorer') }}
        <v-icon size="x-small">mdi-open-in-new</v-icon>
      </a>
      <div class="sol-send__nav">
        <span />
        <GButton tier="primary" @click="emit('close')">{{ $t('common.close') }}</GButton>
      </div>
    </div>

    <template v-else>
      <ol class="sol-send__steps">
        <li
          v-for="(label, i) in stepLabels"
          :key="label"
          :class="['sol-send__step', { 'sol-send__step--active': step === i + 1, 'sol-send__step--done': step > i + 1 }]"
          :aria-current="step === i + 1 ? 'step' : undefined"
        >
          <span class="sol-send__step-bar" />
          <span class="sol-send__step-label">{{ label }}</span>
        </li>
      </ol>

      <!-- Step 1: recipient, amount, fee -->
      <div v-if="step === 1" class="sol-send__body">
        <!-- SOL or one of the wallet's SPL tokens (shown by mint: Gero has no token names yet) -->
        <div v-if="nftGone" class="sol-notice sol-notice--error" role="alert" data-test="sol-nft-gone">
          <v-icon size="small">mdi-alert-circle-outline</v-icon>
          <span class="sol-notice__text">{{ $t('solana.nft.gone') }}</span>
        </div>
        <div v-else-if="nft" class="glass-tier sol-nft" data-test="sol-nft">
          <span class="t-label">{{ $t('solana.nft.sending') }}</span>
          <span class="sol-nft__name">{{ nftName }}</span>
          <span class="g-mono sol-review__address">{{ nft.mint }}</span>
        </div>
        <div v-else-if="pickerTokens.length && !props.nftMint" class="sol-field">
          <span class="t-label">{{ $t('solana.token.asset') }}</span>
          <v-select
            v-model="asset"
            :items="assetItems"
            item-title="title"
            item-value="value"
            variant="outlined"
            density="compact"
            hide-details
            attach
            data-test="sol-asset"
          />
        </div>

        <label class="sol-field">
          <span class="t-label">{{ $t('send.recipientAddress') }}</span>
          <span :class="['sol-input', { 'sol-input--error': !!addressError, 'sol-input--valid': recipient && !addressError }]">
            <input
              v-model.trim="recipient"
              class="sol-input__control g-mono"
              :placeholder="t('solana.addressPlaceholder')"
              autocomplete="off"
              spellcheck="false"
              data-test="sol-recipient"
            />
            <v-btn icon variant="text" size="small" :aria-label="t('common.paste')" :title="t('common.paste')" @click="pasteAddress()">
              <v-icon size="small">mdi-content-paste</v-icon>
            </v-btn>
          </span>
          <span v-if="addressError" class="sol-field__error">{{ addressError }}</span>
        </label>

        <label v-if="!props.nftMint" class="sol-field">
          <span class="t-label">{{ $t('send.amount') }}</span>
          <span :class="['sol-input', { 'sol-input--error': !!amountError }]">
            <span class="sol-input__unit g-mono">{{ unit }}</span>
            <input
              v-model.trim="amountText"
              class="sol-input__control sol-input__control--amount g-num"
              inputmode="decimal"
              placeholder="0.0"
              autocomplete="off"
              data-test="sol-amount"
            />
            <GButton tier="tertiary" compact :disabled="assetBalance === null" @click="setMax()">{{ $t('common.max') }}</GButton>
          </span>
          <span v-if="amountError" class="sol-field__error" data-test="sol-amount-error">{{ amountError }}</span>
        </label>

        <div v-if="!props.nftMint" class="sol-send__balance t-caption">
          <span>{{ $t('send.availableBalance') }}</span>
          <span class="g-num sol-send__balance-value">{{ assetBalance === null ? '—' : formatAsset(assetBalance) }} {{ unit }}</span>
        </div>

        <div class="sol-fees" role="radiogroup" :aria-label="t('send.fee')">
          <button
            v-for="level in FEE_LEVELS"
            :key="level"
            type="button"
            role="radio"
            :aria-checked="feeLevel === level ? 'true' : 'false'"
            :class="['glass-tier', 'sol-fee', { 'sol-fee--selected': feeLevel === level }]"
            @click="feeLevel = level"
          >
            <span class="sol-fee__name">{{ level === 'fast' ? $t('send.fast') : $t('solana.feeStandard') }}</span>
            <span class="t-caption g-num">{{ quote ? `${formatSol(levelFee(level))} ${ticker}` : '…' }}</span>
          </button>
        </div>
        <span v-if="quote && !quote.live" class="t-caption">{{ $t('solana.feesUnavailable') }}</span>
        <span v-else class="t-caption">{{ $t('solana.feeHint') }}</span>

        <div v-if="quoteError" class="sol-notice sol-notice--error" role="alert" data-test="sol-quote-error">
          <v-icon size="small">mdi-alert-circle-outline</v-icon>
          <span class="sol-notice__text">{{ quoteError }}</span>
        </div>
      </div>

      <!-- Step 2: review and sign -->
      <div v-else class="sol-send__body">
        <div class="glass-tier sol-review">
          <span class="t-label">{{ $t('perpetuals.deposit.youSend') }}</span>
          <span class="sol-review__amount">
            <span class="t-display g-num">{{ formatAsset(amount) }}</span>
            <span class="sol-review__unit g-mono">{{ unit }}</span>
          </span>
          <!-- A token is named by its whole mint, so it can be checked against the explorer -->
          <span v-if="selectedToken" class="g-mono sol-review__address" data-test="sol-review-mint">{{ selectedToken.mint }}</span>
          <span class="t-label sol-review__to">{{ $t('send.to') }}</span>
          <!-- The whole address, so it can be checked character by character before signing -->
          <span class="g-mono sol-review__address">{{ recipient }}</span>
          <dl v-if="tokenQuote" class="sol-summary" data-test="sol-token-summary">
            <div v-if="tokenQuote.received !== tokenQuote.amount" class="sol-summary__row">
              <dt>{{ $t('solana.token.recipientGets') }}</dt>
              <dd class="g-num">{{ formatAsset(BigInt(tokenQuote.received)) }} {{ unit }}</dd>
            </div>
            <div class="sol-summary__row">
              <dt>{{ $t('send.fee') }}</dt>
              <dd class="g-num">{{ formatSol(tokenQuote.feeLamports) }} {{ ticker }}</dd>
            </div>
            <div v-if="tokenQuote.createsAccount" class="sol-summary__row">
              <dt>{{ $t('solana.token.newAccount') }}</dt>
              <dd class="g-num">{{ formatSol(tokenQuote.rentLamports) }} {{ ticker }}</dd>
            </div>
            <div class="sol-summary__row sol-summary__row--total">
              <dt>{{ $t('solana.token.solCost') }}</dt>
              <dd class="g-num">{{ formatSol(BigInt(tokenQuote.feeLamports) + BigInt(tokenQuote.rentLamports)) }} {{ ticker }}</dd>
            </div>
          </dl>
          <dl v-else class="sol-summary">
            <div class="sol-summary__row">
              <dt>{{ $t('send.fee') }}</dt>
              <dd class="g-num">{{ formatSol(fee) }} {{ ticker }}</dd>
            </div>
            <div class="sol-summary__row sol-summary__row--total">
              <dt>{{ $t('send.total') }}</dt>
              <dd class="g-num">{{ formatSol(amount + fee) }} {{ ticker }}</dd>
            </div>
          </dl>
        </div>
        <span v-if="tokenQuote?.createsAccount" class="t-caption" data-test="sol-new-account-hint">
          {{ $t('solana.token.newAccountHint', { amount: formatSol(tokenQuote.rentLamports), ticker }) }}
        </span>

        <template v-if="isHardware">
          <div class="sol-auth" data-test="sol-hardware">
            <span class="t-caption">{{ $t('solana.hardware.signOnDevice', { device: loggedWallet?.type }) }}</span>
            <ToggleSwitch
              v-if="showBluetoothToggle"
              :text-left="$t('dashboard.usb')"
              icon-left="mdi-usb"
              :text-right="$t('dashboard.bluetooth')"
              icon-right="mdi-bluetooth"
              v-model="isBluetooth"
            />
          </div>
        </template>
        <template v-else-if="isPrfWallet">
          <div v-if="!prfBytes" class="sol-auth">
            <span class="t-caption">{{ $t('security.passKeyAuthRequired') }}</span>
            <GButton tier="secondary" block @click="authenticateWithPassKey()">
              <v-icon size="small" start>mdi-fingerprint</v-icon>
              {{ $t('security.authenticateWithPassKey') }}
            </GButton>
          </div>
          <div v-else class="sol-notice sol-notice--success">
            <v-icon size="small">mdi-check-circle-outline</v-icon>
            <span class="sol-notice__text">{{ $t('security.passKeyAuthenticated') }}</span>
          </div>
        </template>
        <label v-else class="sol-field">
          <span class="t-label">{{ $t('send.spendingPassword') }}</span>
          <span class="sol-input">
            <input
              v-model="password"
              class="sol-input__control"
              :type="showPassword ? 'text' : 'password'"
              autocomplete="current-password"
              data-test="sol-password"
              @keyup.enter="confirmSend()"
            />
            <v-btn
              icon
              variant="text"
              size="small"
              :aria-label="showPassword ? t('common.hidePassword') : t('common.showPassword')"
              @click="showPassword = !showPassword"
            >
              <v-icon size="small">{{ showPassword ? 'mdi-eye-off' : 'mdi-eye' }}</v-icon>
            </v-btn>
          </span>
        </label>

        <div v-if="sendError" class="sol-notice sol-notice--error" role="alert" data-test="sol-send-error">
          <v-icon size="small">mdi-alert-circle-outline</v-icon>
          <span class="sol-notice__text">{{ sendError }}</span>
        </div>
      </div>

      <div class="sol-send__nav">
        <GButton v-if="step > 1 && !loading" tier="secondary" @click="backToDetails()">
          <v-icon size="small" start>mdi-arrow-left</v-icon>
          {{ $t('common.back') }}
        </GButton>
        <span v-else />
        <GButton v-if="step === 1" tier="primary" :disabled="!canContinue" :loading="quoting" data-test="sol-continue" @click="toReview()">
          {{ $t('common.continue') }}
          <v-icon size="small" end>mdi-arrow-right</v-icon>
        </GButton>
        <GButton v-else tier="primary" :disabled="!canSign" :loading="loading" data-test="sol-send" @click="confirmSend()">
          <v-icon size="small" start>mdi-send</v-icon>
          {{ $t('send.send') }}
        </GButton>
      </div>
    </template>

    <!-- Keystone: the sign request as a QR, then the device's answer scanned back -->
    <template v-if="isHardware">
      <KeystoneSignSheet
        v-if="inPanel"
        :isOpen="keystone.keystoneShow.value"
        :keystoneType="keystone.keystoneType.value"
        :keystoneCbor="keystone.keystoneCbor.value"
        :urTypes="['sol-signature']"
        @scan="keystone.onKeystoneScan"
        @error="keystone.failKeystone"
        @close="keystone.cancelKeystone()"
      />
      <KeystoneSignDialog
        v-else
        :isOpen="keystone.keystoneShow.value"
        :keystoneType="keystone.keystoneType.value"
        :keystoneCbor="keystone.keystoneCbor.value"
        :urTypes="['sol-signature']"
        @scan="keystone.onKeystoneScan"
        @error="keystone.failKeystone"
        @close="keystone.cancelKeystone()"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
// Gero's own SOL send, shared by the dashboard dialog and the side panel sheet. The
// worker (chrome/solanaSend.ts) re-checks everything shown here, reads the balance and
// fee price itself, signs and submits.
import { computed, onBeforeUnmount, ref, toRefs, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import GButton from '@/shared/components/GButton/GButton.vue';
import networks from '@/utils/networks';
import { formatSol, formatUnits, parseRawAmount, parseSol, parseUnits } from '@/chains/solana/solanaAmount';
import { estimateTokenTransferFee } from '@/chains/solana/solanaTokenTransfer';
import { solanaNftName } from '@/chains/solana/solanaNfts';
import type { SolanaTokenAccountInfo, SolanaTokenQuote } from '@/chrome/solanaTokenSend';
import { isValidSolanaAddress } from '@/chains/solana/solanaKeyManager';
import {
  checkSolTransfer,
  maxSendableLamports,
  solanaSendErrorKey,
  SOLANA_RENT_EXEMPT_MINIMUM,
  type SolanaFeeLevel,
} from '@/chains/solana/solanaSendRules';
import { solscanUrl } from '@/chains/solana/solanaExplorer';
import type { SolanaSendQuote } from '@/chrome/solanaSend';
import { debugLog } from '@/utils/debug';
import { WalletType } from '@/models/types';
import { isSolanaHardware } from '@/chains/solana/solanaHardwarePolicy';
import { useSolanaHardwareSigner, SolanaHardwareSignError } from '@/shared/composables/useSolanaHardwareSigner';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import KeystoneSignSheet from '@/sidepanel/components/KeystoneSignSheet.vue';

/**
 * `open` loads a fee quote; closing it clears everything typed, the PassKey answer included.
 * `inPanel`: hosted by the side panel (its Keystone sheet; Ledger over USB only, as Bluetooth
 * pairing needs a window of its own there).
 */
const props = defineProps<{ open: boolean; inPanel?: boolean; nftMint?: string }>();
const emit = defineEmits<{
  (e: 'close'): void;
  /** While a PassKey ceremony or the send itself is in flight: the host holds its close. */
  (e: 'busy', value: boolean): void;
}>();

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

const FEE_LEVELS: SolanaFeeLevel[] = ['standard', 'fast'];
// A valid address that is never the wallet's own, for checking the amount alone.
const SYSTEM_PLACEHOLDER = '11111111111111111111111111111111';
const SOL_ASSET = 'SOL';

const step = ref(1);
const recipient = ref('');
const amountText = ref('');
const feeLevel = ref<SolanaFeeLevel>('standard');
const quote = ref<SolanaSendQuote | null>(null);
const password = ref('');
const showPassword = ref(false);
const prfBytes = ref<Uint8Array | null>(null);
const loading = ref(false);
const sendError = ref('');
const sentSignature = ref('');

const stepLabels = computed(() => [t('send.recipient'), t('send.confirm')]);
const ticker = computed(() => networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network));
const ownAddress = computed(() => loggedWallet.value?.publicKey ?? '');

/** Lamports per Gero Sync; null until it has reported (never read as 0). */
const balance = computed<bigint | null>(() => {
  const lamports = walletStore.solana?.lamports;
  return lamports == null ? null : parseRawAmount(lamports);
});

const priority = computed(() => BigInt(quote.value?.prices[feeLevel.value] ?? '0'));
const fee = computed(() => (quote.value ? BigInt(quote.value.fees[feeLevel.value]) : 0n));

// What is sent: 'SOL', or the mint of one of the wallet's tokens (as Gero Sync reports them).
const asset = ref<string>(SOL_ASSET);
const tokenItems = computed(() => (walletStore.solana?.tokens ?? [])
  .filter((token) => /^\d+$/.test(String(token.amount)) && BigInt(token.amount) > 0n && isValidSolanaAddress(token.mint))
  // One row per mint: a mint held in several accounts sends from the largest (the worker picks it too).
  .reduce<Array<{ mint: string; amount: bigint; decimals: number }>>((rows, token) => {
    const amountHeld = BigInt(token.amount);
    const row = rows.find((r) => r.mint === token.mint);
    if (!row) rows.push({ mint: token.mint, amount: amountHeld, decimals: token.decimals });
    else if (amountHeld > row.amount) row.amount = amountHeld;
    return rows;
  }, []));
const selectedToken = computed(() => (asset.value === SOL_ASSET ? null : tokenItems.value.find((token) => token.mint === asset.value) ?? null));
// NFTs are sent from their own detail (`nftMint`), not picked here among tokens.
const pickerTokens = computed(() => tokenItems.value.filter((token) => !walletStore.solanaNfts?.[token.mint]));
const assetItems = computed(() => [
  { value: SOL_ASSET, title: ticker.value },
  ...pickerTokens.value.map((token) => ({ value: token.mint, title: `${shortMint(token.mint)} · ${formatUnits(token.amount, token.decimals)}` })),
]);
/** The NFT this form sends, when opened from its detail; null for any other send. */
const nft = computed(() => {
  if (!props.nftMint) return null;
  const entry = walletStore.solanaNfts?.[props.nftMint];
  return entry && tokenItems.value.some((token) => token.mint === props.nftMint) ? entry : null;
});
const nftName = computed(() => (nft.value ? solanaNftName(nft.value) : ''));
// Opened for an NFT that is no longer here (just sent, or its metadata gone): never fall back
// to an ordinary send of whatever the form last held.
const nftGone = computed(() => !!props.nftMint && !nft.value);
// An NFT is one indivisible unit: the asset and amount are fixed.
function applyNft(): void {
  if (!nft.value) return;
  asset.value = nft.value.mint;
  amountText.value = '1';
}
watch(nft, applyNft, { immediate: true });
const unit = computed(() => {
  if (nft.value) return nftName.value;
  return selectedToken.value ? shortMint(selectedToken.value.mint) : ticker.value;
});
const assetBalance = computed<bigint | null>(() => (selectedToken.value ? selectedToken.value.amount : balance.value));

function shortMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

/** Raw units of the asset being sent, as a decimal string's value. */
function formatAsset(raw: bigint | string): string {
  return selectedToken.value ? formatUnits(raw, selectedToken.value.decimals) : formatSol(raw);
}

/** The amount in the asset's raw units; -1 for text that is not an amount. */
const amount = computed<bigint>(() => {
  if (!amountText.value) return 0n;
  try {
    // A decimal comma (German, Spanish keyboards) reads as the point.
    const text = amountText.value.replace(',', '.');
    return selectedToken.value ? parseUnits(text, selectedToken.value.decimals) : parseSol(text);
  } catch {
    return -1n;
  }
});

/** The network fee at `level`: a SOL transfer's, or a token transfer's to an existing account. */
function levelFee(level: SolanaFeeLevel): bigint {
  if (!quote.value) return 0n;
  if (!selectedToken.value) return BigInt(quote.value.fees[level]);
  return estimateTokenTransferFee(BigInt(quote.value.prices[level]), false);
}

function errorText(code: string): string {
  return t(solanaSendErrorKey(code), { amount: formatSol(SOLANA_RENT_EXEMPT_MINIMUM), ticker: ticker.value });
}

const addressError = computed(() => {
  if (!recipient.value) return '';
  if (!isValidSolanaAddress(recipient.value)) return errorText('INVALID_ADDRESS');
  if (recipient.value === ownAddress.value) return errorText('SAME_ADDRESS');
  return '';
});

const amountError = computed(() => {
  if (!amountText.value) return '';
  if (amount.value <= 0n) return errorText('INVALID_AMOUNT');
  // A token: its own balance here; the SOL for the fee (and a new account) is the worker's check.
  if (selectedToken.value) return amount.value > selectedToken.value.amount ? errorText('TOKEN_BALANCE') : '';
  const refusal = checkSolTransfer({
    from: ownAddress.value,
    // Only the amount's rules here: the address has its own line.
    to: isValidSolanaAddress(recipient.value) && recipient.value !== ownAddress.value ? recipient.value : SYSTEM_PLACEHOLDER,
    lamports: amount.value,
    balance: balance.value,
    priorityMicroLamports: priority.value,
  });
  return refusal && refusal !== 'INVALID_ADDRESS' && refusal !== 'SAME_ADDRESS' ? errorText(refusal) : '';
});

const canContinue = computed(() =>
  !nftGone.value && !quoting.value && !!recipient.value && !addressError.value && amount.value > 0n && !amountError.value && !!quote.value,
);

// A token send is planned and simulated by the worker before the review shows it.
const tokenQuote = ref<SolanaTokenQuote | null>(null);
const quoting = ref(false);
const quoteError = ref('');

/** The request the worker plans a token send from: never more than the user chose. */
function tokenRequest(): Record<string, unknown> {
  return { mint: selectedToken.value?.mint, recipientAddress: recipient.value, amount: amount.value.toString(), feeLevel: feeLevel.value };
}

async function toReview(): Promise<void> {
  if (!canContinue.value) return;
  quoteError.value = '';
  if (!selectedToken.value) {
    step.value = 2;
    return;
  }
  quoting.value = true;
  try {
    const response = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.SOLANA_TOKEN_SEND_QUOTE, data: tokenRequest() }) as
      { data?: { success?: boolean; error?: string; result?: SolanaTokenQuote } };
    if (response.data?.success && response.data.result) {
      tokenQuote.value = response.data.result;
      step.value = 2;
    } else {
      quoteError.value = errorText(response.data?.error ?? '');
    }
  } catch (error) {
    debugLog('Solana token send: quote failed', error);
    quoteError.value = errorText('LOOKUP_FAILED');
  } finally {
    quoting.value = false;
  }
}

function backToDetails(): void {
  step.value = 1;
  tokenQuote.value = null;
  sendError.value = '';
}

// Another asset, recipient, amount or fee level is another plan.
watch([asset, recipient, amountText, feeLevel], () => { quoteError.value = ''; });
watch(asset, () => { if (!nft.value) amountText.value = ''; });
// Ledger, Trezor and Keystone sign in this page; the worker builds the message and checks
// the signature (PREPARE_SOLANA_SEND / SUBMIT_SOLANA_SEND).
const isHardware = computed(() => isSolanaHardware(loggedWallet.value?.type));
const isBluetooth = ref(false);
const showBluetoothToggle = computed(() => !props.inPanel && loggedWallet.value?.type === WalletType.Ledger && !!loggedWallet.value?.btSupported);
const { sign: signOnDevice, keystone } = useSolanaHardwareSigner({ getIsBT: () => showBluetoothToggle.value && isBluetooth.value });

const canSign = computed(() => !loading.value && !nftGone.value
  && (isHardware.value || (isPrfWallet.value ? !!prfBytes.value : !!password.value)));

const isPrfWallet = computed(() =>
  loggedWallet.value?.encryptionMethod === 'prf'
  || (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId),
);

const sentUrl = computed(() => solscanUrl('tx', sentSignature.value, loggedWallet.value?.network ?? ''));

function setMax(): void {
  // A token's whole balance (its fee is paid in SOL); SOL less the fee.
  const max = selectedToken.value ? selectedToken.value.amount : maxSendableLamports(balance.value, priority.value);
  amountText.value = max > 0n ? formatAsset(max) : '';
}

async function pasteAddress(): Promise<void> {
  try {
    recipient.value = (await navigator.clipboard.readText()).trim();
  } catch {
    // Clipboard read refused or unavailable: the field stays as it was
  }
}

async function loadQuote(): Promise<void> {
  try {
    const response = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.SOLANA_SEND_QUOTE, data: {} }) as
      { data?: { success?: boolean; result?: SolanaSendQuote } };
    if (response.data?.success && response.data.result) quote.value = response.data.result;
  } catch (error) {
    debugLog('Solana send: quote failed', error);
  }
}

async function authenticateWithPassKey(): Promise<void> {
  if (!loggedWallet.value?.webAuthnCredentialId) {
    sendError.value = t('security.passKeyNotConfigured');
    return;
  }
  loading.value = true;
  try {
    const { evaluateWalletPrf } = await import('@/shared/utils/passkeyPrf');
    prfBytes.value = new Uint8Array(await evaluateWalletPrf(loggedWallet.value));
    sendError.value = '';
  } catch {
    sendError.value = t('security.passKeyAuthFailed');
  } finally {
    loading.value = false;
  }
}

type SendResponse = { data?: { success?: boolean; error?: string; result?: { signature: string } } };

/** The device signs the message the worker built; the worker checks it and submits. */
async function sendFromDevice(data: Record<string, unknown>): Promise<SendResponse> {
  const prepared = await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.PREPARE_SOLANA_SEND, data }) as
    { data?: { success?: boolean; error?: string; result?: { message: number[]; tokenAccounts?: SolanaTokenAccountInfo[] } } };
  if (!prepared.data?.success || !prepared.data.result) return { data: { success: false, error: prepared.data?.error } };
  let signature: Uint8Array;
  try {
    const { message, tokenAccounts } = prepared.data.result;
    signature = await signOnDevice(Uint8Array.from(message), 'transaction', tokenAccounts);
  } catch (error) {
    debugLog('Solana send: device did not sign', error);
    // Cancelled on purpose: no error to show.
    return { data: { success: false, error: error instanceof SolanaHardwareSignError && error.cancelled ? 'CANCELLED' : 'DEVICE_FAILED' } };
  }
  return await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.SUBMIT_SOLANA_SEND,
    data: { signature: Array.from(signature) },
  }) as SendResponse;
}

async function confirmSend(): Promise<void> {
  if (!canSign.value) return;
  loading.value = true;
  sendError.value = '';
  try {
    // A token send carries the reviewed cost and amount received as limits the worker holds it to.
    const data: Record<string, unknown> = selectedToken.value
      ? {
        ...tokenRequest(),
        ...(tokenQuote.value ? {
          maxSolCost: (BigInt(tokenQuote.value.feeLamports) + BigInt(tokenQuote.value.rentLamports)).toString(),
          minReceived: tokenQuote.value.received,
        } : {}),
      }
      : { recipientAddress: recipient.value, lamports: amount.value.toString(), feeLevel: feeLevel.value };
    if (isHardware.value) {
      const response = await sendFromDevice(data);
      if (response.data?.success && response.data.result) sentSignature.value = response.data.result.signature;
      else if (response.data?.error !== 'CANCELLED') sendError.value = errorText(response.data?.error ?? '');
      return;
    }
    if (isPrfWallet.value && prfBytes.value) data['privateKeyBytes'] = Array.from(prfBytes.value);
    else data['password'] = password.value;
    const method = selectedToken.value ? MessageTypes.SEND_SOLANA_TOKEN : MessageTypes.SEND_SOLANA;
    const response = await Messaging.sendToBackgroundFromOptions({ method, data }) as
      { data?: { success?: boolean; error?: string; result?: { signature: string } } };
    if (response.data?.success && response.data.result) {
      sentSignature.value = response.data.result.signature;
    } else {
      sendError.value = errorText(response.data?.error ?? '');
      // A PassKey answer is single-use in spirit: ask again after a failure.
      prfBytes.value = null;
    }
  } catch (error) {
    debugLog('Solana send failed', error);
    sendError.value = errorText('');
  } finally {
    password.value = '';
    loading.value = false;
  }
}

function reset(): void {
  // A Keystone request still showing is abandoned with the form.
  if (keystone.keystoneShow.value) keystone.cancelKeystone();
  isBluetooth.value = false;
  asset.value = SOL_ASSET;
  tokenQuote.value = null;
  quoteError.value = '';
  quoting.value = false;
  step.value = 1;
  recipient.value = '';
  amountText.value = '';
  feeLevel.value = 'standard';
  password.value = '';
  showPassword.value = false;
  prfBytes.value?.fill(0);
  prfBytes.value = null;
  sendError.value = '';
  sentSignature.value = '';
  quote.value = null;
}

// Immediate: a host's open state can outlive this form, so it can mount already open
watch(() => props.open, (open) => {
  if (!open) return reset();
  applyNft();
  void loadQuote();
}, { immediate: true });
watch(loading, (busy) => emit('busy', busy));
onBeforeUnmount(reset);
</script>

<style scoped lang="scss">
.sol-send,
.sol-send__body {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.sol-send__steps {
  display: flex;
  gap: var(--g-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}

.sol-send__step {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 6px;
  color: var(--g-text-3);
}

.sol-send__step-bar {
  height: 3px;
  border-radius: var(--g-r-chip);
  background: var(--g-hairline-2);
}

.sol-send__step-label {
  font-size: 12px;
  font-weight: 500;
}

.sol-send__step--active .sol-send__step-bar,
.sol-send__step--done .sol-send__step-bar {
  background: var(--g-accent);
}

.sol-send__step--active .sol-send__step-label {
  color: var(--g-accent);
}

.sol-field {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sol-field__error {
  color: var(--g-error);
  font-size: 12px;
}

/* Inputs are controls, not surfaces: solid raised fill. The bare input inside keeps the
   baseline focus ring; the wrapper's accent border marks which field is active. */
.sol-input {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  min-height: var(--g-btn-h);
  padding: 0 var(--g-s-1) 0 var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  background: var(--g-raised);
  transition: border-color var(--g-dur-fast) var(--g-ease);
}

.sol-input:focus-within {
  border-color: var(--g-accent);
}

.sol-input--valid {
  border-color: var(--g-success-line);
}

.sol-input--error,
.sol-input--error:focus-within {
  border-color: var(--g-error);
}

.sol-input__control {
  flex: 1 1 auto;
  min-width: 0;
  height: var(--g-btn-h);
  border: 0;
  background: transparent;
  color: var(--g-text-1);
  font-size: 13px;
}

.sol-input__control::placeholder {
  color: var(--g-text-3);
}

.sol-input__control--amount {
  font-size: 16px;
  font-weight: 600;
}

.sol-input__unit {
  color: var(--g-text-3);
  font-size: 12px;
}

.sol-send__balance {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
}

.sol-send__balance-value {
  color: var(--g-text-1);
}

.sol-fees {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: var(--g-s-2);
}

.sol-fee {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
  padding: var(--g-s-3);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background-color var(--g-dur-fast) var(--g-ease), border-color var(--g-dur-fast) var(--g-ease);
}

.sol-fee:hover {
  @include g-glass-tier-hover;
}

.sol-fee--selected,
.sol-fee--selected:hover {
  @include g-glass-tier-active;
}

.sol-fee__name {
  color: var(--g-text-1);
  font-size: 13px;
  font-weight: 600;
}

.sol-nft {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-3);
}

.sol-nft__name {
  color: var(--g-text-1);
  font-weight: 600;
  overflow-wrap: anywhere;
}

.sol-review {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  padding: var(--g-s-4);
}

.sol-review__amount {
  display: flex;
  align-items: baseline;
  gap: var(--g-s-2);
  line-height: 1.1;
}

.sol-review__unit {
  color: var(--g-text-3);
  font-size: 14px;
}

.sol-review__to {
  margin-top: var(--g-s-3);
}

.sol-review__address {
  color: var(--g-text-1);
  font-size: 12px;
  word-break: break-all;
}

.sol-summary {
  display: flex;
  flex-direction: column;
  margin: var(--g-s-3) 0 0;
}

.sol-summary__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-2) 0;
  border-top: 1px solid var(--g-hairline-1);
  font-size: 13px;
}

.sol-summary__row dt {
  color: var(--g-text-3);
}

.sol-summary__row dd {
  margin: 0;
  color: var(--g-text-1);
  text-align: right;
}

.sol-summary__row--total dd {
  font-weight: 600;
}

.sol-auth {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.sol-notice {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-2) var(--g-s-3);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  color: var(--g-text-2);
  font-size: 13px;
}

.sol-notice .v-icon {
  color: inherit;
}

.sol-notice__text {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}

.sol-notice--success {
  border-color: var(--g-success-line);
  background: var(--g-success-fill);
  color: var(--g-success);
}

.sol-notice--error {
  border-color: var(--g-error-line);
  background: var(--g-error-fill);
  color: var(--g-error);
}

.sol-link {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  color: var(--g-accent);
  font-size: 13px;
}

.sol-send__nav {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}
</style>
