<template>
  <div class="programmable-send" data-testid="programmable-send">
    <!-- Step 1: what to send, and to whom. The worker chooses the UTxOs. -->
    <template v-if="step === 'form'">
      <p class="t-caption mb-3">
        {{ t('common.available') }}: <span class="g-num">{{ heldDisplay }}</span> {{ tokenLabel }}
      </p>
      <v-text-field
        v-model="amountInput"
        :label="t('common.amount')"
        inputmode="decimal"
        variant="outlined"
        density="comfortable"
        autocomplete="off"
        :suffix="tokenLabel"
        :error-messages="amountError"
        :disabled="busy"
        data-testid="programmable-send-amount"
      >
        <template #append-inner>
          <v-btn variant="text" size="small" :disabled="busy" @click="setMax()">{{ t('common.max') }}</v-btn>
        </template>
      </v-text-field>
      <v-text-field
        v-model="recipientInput"
        :label="t('wallet.recipient')"
        :placeholder="t('wallet.enterRecipientAddress')"
        variant="outlined"
        density="comfortable"
        autocomplete="off"
        spellcheck="false"
        :disabled="busy"
        data-testid="programmable-send-recipient"
      />
      <v-alert v-if="failureText" type="error" variant="tonal" density="compact" class="mb-3" data-testid="programmable-send-error">
        {{ failureText }}
      </v-alert>
      <div class="programmable-send__actions">
        <v-btn variant="outlined" :disabled="busy" @click="emit('close')">{{ t('common.cancel') }}</v-btn>
        <v-btn
          class="geroButton"
          :loading="flow.stage.value === 'preparing'"
          :disabled="!formReady || busy"
          data-testid="programmable-send-continue"
          @click="review()"
        >
          {{ t('common.continue') }}
        </v-btn>
      </div>
    </template>

    <!-- Step 2: what the worker verified the transaction does. Nothing here comes from Nexus's word. -->
    <template v-else-if="step === 'review' && summary">
      <dl class="programmable-send__rows glass-tier" data-testid="programmable-send-review">
        <div class="programmable-send__row">
          <dt class="t-caption">{{ t('common.amount') }}</dt>
          <dd class="t-body-sm g-num">
            {{ formatToken(summary.quantity) }} {{ tokenLabel }}
            <v-chip size="x-small" label class="programmable-send__chip ml-1">{{ t('programmableTokens.badge') }}</v-chip>
          </dd>
        </div>
        <div class="programmable-send__row">
          <dt class="t-caption">{{ t('transactions.policyId') }}</dt>
          <dd class="t-caption g-mono programmable-send__wrap">{{ policyId }}</dd>
        </div>
        <div class="programmable-send__row">
          <dt class="t-caption">{{ t('wallet.recipient') }}</dt>
          <dd class="t-caption g-mono programmable-send__wrap">{{ summary.recipientAddress }}</dd>
        </div>
        <div class="programmable-send__row">
          <dt class="t-caption">{{ t('programmableTokens.send.tokensGoTo') }}</dt>
          <dd class="t-caption g-mono programmable-send__wrap" data-testid="programmable-send-destination">
            {{ summary.recipientProgrammableAddress }}
          </dd>
        </div>
        <div class="programmable-send__row">
          <dt class="t-caption">{{ t('programmableTokens.send.ownedBy') }}</dt>
          <dd class="t-body-sm">{{ t(ownerKey) }}</dd>
        </div>
        <div class="programmable-send__row">
          <dt class="t-caption">{{ t('programmableTokens.send.adaWithTokens') }}</dt>
          <dd class="t-body-sm g-num">{{ formatAda(summary.lovelaceToRecipient) }}</dd>
        </div>
        <div v-if="summary.lovelaceToChange" class="programmable-send__row">
          <dt class="t-caption">{{ t('programmableTokens.send.adaWithChange') }}</dt>
          <dd class="t-body-sm g-num">{{ formatAda(summary.lovelaceToChange) }}</dd>
        </div>
        <div class="programmable-send__row">
          <dt class="t-caption">{{ t('signTx.networkFee') }}</dt>
          <dd class="t-body-sm g-num">{{ formatAda(summary.fee) }}</dd>
        </div>
        <div class="programmable-send__row">
          <dt class="t-caption">{{ t('transactions.collateral') }}</dt>
          <dd class="t-body-sm g-num">
            {{ summary.sponsoredCollateralRef ? t('programmableTokens.send.collateralSponsored') : formatAda(summary.collateralAtRisk) }}
          </dd>
        </div>
      </dl>
      <p v-if="!summary.sponsoredCollateralRef" class="t-caption mt-2">{{ t('programmableTokens.send.collateralHint') }}</p>
      <v-alert
        v-if="summary.moduleId === 'freeze-and-seize'"
        type="warning"
        variant="tonal"
        density="compact"
        class="mt-3"
        data-testid="programmable-send-seize"
      >
        {{ t('programmableTokens.send.seizeWarning') }}
      </v-alert>

      <v-alert v-if="failureText" type="error" variant="tonal" density="compact" class="mt-3" data-testid="programmable-send-error">
        {{ failureText }}
      </v-alert>

      <div class="mt-4">
        <PassKeyPasswordField
          v-if="usesPassword"
          :model-value="password"
          dense
          outlined
          hide-details
          :label="t('wallet.spendingPassword')"
          :placeholder="t('navigation.typeYourSpendingPassword')"
          :disabled="busy"
          required
          @update:model-value="password = $event"
          @enter="send()"
          @passkey-autofill-success="send()"
        />
      </div>
      <div class="programmable-send__actions">
        <v-btn variant="outlined" :disabled="busy" @click="back()">{{ t('common.back') }}</v-btn>
        <PassKeyAuthButton
          v-if="isPrfWallet"
          :block="false"
          :disabled="busy"
          :text="t('common.send')"
          @success="sendWithPassKey"
          @error="onPassKeyError"
        />
        <v-btn
          v-else
          class="geroButton"
          :loading="busy"
          :disabled="busy || (usesPassword && !password)"
          data-testid="programmable-send-confirm"
          @click="send()"
        >
          {{ t('common.send') }}
        </v-btn>
      </div>
    </template>

    <!-- Step 3: submitted. -->
    <template v-else-if="step === 'done'">
      <div class="text-center py-2" data-testid="programmable-send-done">
        <v-icon size="48" color="var(--g-success)">mdi-check-circle-outline</v-icon>
        <p class="t-heading mt-2">{{ t('programmableTokens.send.submitted') }}</p>
        <p class="t-caption mt-2">{{ t('transactions.transactionId') }}</p>
        <p class="t-caption g-mono programmable-send__wrap">
          {{ flow.submittedTxId.value }}
          <CopyButton x-small :value="flow.submittedTxId.value ?? ''" class="ml-1" />
        </p>
        <v-btn
          v-if="txExplorerUrl"
          variant="text"
          size="small"
          :href="txExplorerUrl"
          target="_blank"
          rel="noopener noreferrer"
        >
          {{ t('market.viewOnExplorer') }}
        </v-btn>
      </div>
      <div class="programmable-send__actions">
        <v-btn class="geroButton" block @click="emit('done', flow.submittedTxId.value ?? '')">{{ t('common.done') }}</v-btn>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, provide, ref, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { authorizationScopeKey } from '@/shared/composables/authorizationScope';
import { CIP113_SEND_SIGN_FAILED, cip113SendErrorKey, useCip113Send } from '@/shared/composables/useCip113Send';
import { useExplorer } from '@/shared/composables/useExplorer';
import { baseUnitsToDecimalString, decimalToBaseUnits, exceedsDecimals } from '@/shared/utils/amount';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import { walletStore } from '@/stores/walletStore';
import { WalletType } from '@/models/types';
import networks from '@/utils/networks';

/**
 * Gero's own Send of a CIP-113 programmable token: amount and recipient, then the review of
 * what the worker verified the transaction does, then the signature. Hosted by
 * ProgrammableSendDialog (options) and ProgrammableSendSheet (side panel).
 */
const props = defineProps<{
  unit: string;
  ticker?: string;
  name?: string;
  /** The token's decimals; 0 when unknown, so amounts are in base units. */
  decimals?: number;
}>();

const emit = defineEmits<{
  (e: 'close'): void;
  (e: 'done', txId: string): void;
  /** True while a request is in flight, so the host can refuse to close. */
  (e: 'busy', busy: boolean): void;
}>();

const { t } = useTranslation();
const flow = useCip113Send();
const { explorerUrl } = useExplorer();

const amountInput = ref('');
const recipientInput = ref('');
const password = ref('');

const decimals = computed(() => (Number.isSafeInteger(props.decimals) && (props.decimals ?? 0) >= 0 ? props.decimals ?? 0 : 0));
const tokenLabel = computed(() => props.ticker || props.name || '');
const policyId = computed(() => props.unit.slice(0, 56));

/** What the wallet holds of this token at its programmable addresses, in base units. */
const held = computed<bigint>(() => {
  const entry = (walletStore.programmableTokens ?? {})[props.unit] as { quantity?: unknown } | undefined;
  try {
    return BigInt(String(entry?.quantity ?? '0'));
  } catch {
    return 0n;
  }
});
const heldDisplay = computed(() => baseUnitsToDecimalString(held.value, decimals.value));

const quantity = computed(() => decimalToBaseUnits(amountInput.value, decimals.value));
const amountError = computed(() => {
  if (!amountInput.value.trim()) return [];
  if (exceedsDecimals(amountInput.value, decimals.value)) {
    return [t('programmableTokens.send.tooManyDecimals', { decimals: decimals.value })];
  }
  if (quantity.value <= 0n) return [t('wallet.enterAmount')];
  if (quantity.value > held.value) return [t('errors.insufficientBalance')];
  return [];
});
const formReady = computed(() =>
  quantity.value > 0n && amountError.value.length === 0 && recipientInput.value.trim().length > 0,
);

const step = computed(() => {
  const stage = flow.stage.value;
  if (stage === 'done') return 'done';
  if (stage === 'review' || stage === 'signing' || stage === 'submitting') return 'review';
  return 'form';
});
const busy = computed(() => ['preparing', 'signing', 'submitting'].includes(flow.stage.value));
watch(busy, (value) => emit('busy', value));

const summary = computed(() => flow.prepared.value?.summary ?? null);
const ownerKey = computed(() => {
  switch (summary.value?.recipientOwner.type) {
    case 'payment_key': return 'programmableTokens.send.ownerPaymentKey';
    case 'as_given': return 'programmableTokens.send.ownerAsGiven';
    default: return 'programmableTokens.send.ownerStakeKey';
  }
});

const failureText = computed(() => {
  const failure = flow.failure.value;
  if (!failure) return '';
  const max = failure.maxSingleTransfer
    ? `${baseUnitsToDecimalString(BigInt(failure.maxSingleTransfer), decimals.value)} ${tokenLabel.value}`
    : '';
  return t(cip113SendErrorKey(failure.code), { max });
});

const wallet = computed(() => walletStore.loggedWallet);
const isPrfWallet = computed(() =>
  wallet.value?.type === WalletType.Normal && (
    wallet.value?.encryptionMethod === 'prf'
    || (!!wallet.value?.prfEncryptedPrivateKey && !!wallet.value?.webAuthnCredentialId)
  ),
);
const usesPassword = computed(() => wallet.value?.type === WalletType.Normal && !isPrfWallet.value);
const adaTicker = computed(() => networks.resolveNetwork(wallet.value?.chain ?? '', wallet.value?.network ?? '')?.currencyTicker ?? 'ADA');
const txExplorerUrl = computed(() => explorerUrl('tx', flow.submittedTxId.value));

// A PassKey result belongs to the transfer on screen when the ceremony started: a new build,
// a step change or a wallet switch makes it stale (PassKeyAuthButton checks before emitting).
let epoch = 0;
let disposed = false;
provide(authorizationScopeKey, {
  capture() {
    const captured = epoch;
    return () => !disposed && captured === epoch;
  },
});
watch(() => [flow.prepared.value?.txId, step.value, wallet.value?.id] as const, () => { epoch++; }, { flush: 'sync' });
onScopeDispose(() => { disposed = true; epoch++; });

// A transfer belongs to the wallet it was built for: another wallet starts from the form
// (the worker would refuse to sign it anyway).
watch(() => wallet.value?.id, (id, previous) => {
  if (id !== previous && !busy.value) {
    password.value = '';
    flow.reset();
  }
});

function formatToken(baseUnits: string): string {
  return baseUnitsToDecimalString(BigInt(baseUnits), decimals.value);
}

function formatAda(lovelace: string | undefined): string {
  return `${baseUnitsToDecimalString(BigInt(lovelace ?? '0'), 6)} ${adaTicker.value}`;
}

function setMax(): void {
  amountInput.value = heldDisplay.value;
}

async function review(): Promise<void> {
  if (!formReady.value || busy.value) return;
  password.value = '';
  await flow.prepare({
    unit: props.unit,
    quantity: quantity.value.toString(),
    recipientAddress: recipientInput.value.trim(),
  });
}

function back(): void {
  password.value = '';
  flow.reset();
}

async function send(): Promise<void> {
  if (busy.value || step.value !== 'review') return;
  if (usesPassword.value) {
    if (!password.value) return;
    const typed = password.value;
    password.value = '';
    await flow.signAndSubmit({ password: typed });
    return;
  }
  // Google wallets sign with the unlocked session; nothing to ask for.
  await flow.signAndSubmit();
}

async function sendWithPassKey(privateKeyBytes: Uint8Array): Promise<void> {
  if (busy.value || step.value !== 'review') {
    privateKeyBytes.fill(0);
    return;
  }
  await flow.signAndSubmit({ privateKeyBytes });
}

function onPassKeyError(): void {
  flow.failure.value = { code: CIP113_SEND_SIGN_FAILED };
}
</script>

<style scoped lang="scss">
.programmable-send__rows {
  margin: 0;
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
}

.programmable-send__row {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-3);
  padding: var(--g-s-1) 0;

  dt {
    color: var(--g-text-2);
    flex-shrink: 0;
  }

  dd {
    margin: 0;
    color: var(--g-text-1);
    text-align: right;
  }
}

.programmable-send__wrap {
  word-break: break-all;
}

.programmable-send__chip {
  color: var(--g-warning);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
}

.programmable-send__actions {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-3);
  margin-top: var(--g-s-4);
}
</style>
