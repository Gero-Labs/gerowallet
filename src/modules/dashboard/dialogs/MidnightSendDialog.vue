<template>
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
    <v-card-text class="px-3 pb-3 midnight-send-content">
      <!-- Available balance reminder -->
      <div class="midnight-balance-snapshot mb-4">
        <div class="midnight-snapshot-label">{{ t('midnight.unshielded') }}</div>
        <div class="midnight-snapshot-amount">
          {{ formattedAvailable }} {{ nightCurrency }}
        </div>
      </div>

      <v-form ref="formRef" v-model="formValid">
        <v-text-field
          v-model="recipient"
          :label="t('common.recipientAddress')"
          outlined
          dense
          :rules="addressRules"
          :disabled="sending"
          class="mb-2"
        />
        <v-text-field
          v-model="amount"
          :label="t('common.amount') + ' (' + nightCurrency + ')'"
          outlined
          dense
          type="number"
          min="0"
          step="0.000001"
          :rules="amountRules"
          :disabled="sending"
          :hint="`Available: ${formattedAvailable} ${nightCurrency}`"
          persistent-hint
          class="mb-3"
        >
          <template v-slot:append>
            <v-btn x-small text @click="setMax" :disabled="sending">MAX</v-btn>
          </template>
        </v-text-field>

        <!-- Auth: same component the Cardano stepper uses. Renders either a
             password field (Normal wallets) or a PassKey button (PRF wallets).
             We listen on `passkey-prf-output` (raw PRF bytes) rather than
             `passkey-success` (decrypted Cardano private key) because Midnight
             decrypts its own mnemonic from the raw PRF — the Cardano-specific
             private key bytes are the wrong material for our BG handler. -->
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

        <div v-if="errorMessage" class="red--text text--lighten-2 text-caption mt-2">
          {{ errorMessage }}
        </div>

        <div class="text-caption text--secondary text-center mt-3">
          {{ t('midnight.shieldedSendComingNote') }}
        </div>
      </v-form>
    </v-card-text>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { midnightStore } from '@/stores/midnightStore';
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
const nightCurrency = computed(() =>
  loggedWallet.value?.network === Network.MAINNET ? 'NIGHT' : 'tNIGHT'
);

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

const formRef = ref<{ validate: () => boolean } | null>(null);
const formValid = ref(false);
const recipient = ref('');
const amount = ref('');
const password = ref('');
const sending = ref(false);
const errorMessage = ref<string | null>(null);

const passwordRules = [rules.required()];

// Address shape check is intentionally permissive — the indexer is the final
// arbiter; we only catch obvious typos here. Networks: mainnet uses bare
// `mn_addr_`, others use `mn_addr_<network>_` (e.g. `mn_addr_preview_`).
// Error strings match the pre-extraction inline implementation; if these need
// translating later, add the keys to us.ts + de.ts in one pass.
const addressRules = computed(() => [
  (v: string) => !!v || 'Recipient address required',
  (v: string) => {
    const isMain = loggedWallet.value?.network === Network.MAINNET;
    const prefix = isMain ? 'mn_addr_' : `mn_addr_${(loggedWallet.value?.network || '').toLowerCase()}`;
    return v.startsWith('mn_addr_') || `Address should start with ${prefix}`;
  },
]);

const amountRules = computed(() => [
  (v: string) => !!v || 'Amount required',
  (v: string) => {
    const n = Number(v);
    return (Number.isFinite(n) && n > 0) || 'Must be positive';
  },
  (v: string) => parseAmount(v) <= available.value || 'Exceeds available balance',
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
  const value = available.value;
  const whole = value / NIGHT_DIVISOR;
  const remainder = value % NIGHT_DIVISOR;
  const remainderStr = remainder.toString().padStart(NIGHT_DIVISOR.toString().length - 1, '0');
  amount.value = remainder === 0n ? whole.toString() : `${whole}.${remainderStr.replace(/0+$/, '')}`;
}

function preflight(): boolean {
  errorMessage.value = null;
  if (!formRef.value?.validate()) return false;
  if (loggedWallet.value?.chain !== Blockchain.MIDNIGHT) {
    errorMessage.value = 'Not a Midnight wallet';
    return false;
  }
  return true;
}

async function submitWithPassword() {
  if (!preflight() || isPrfWallet.value) return;
  await send({ password: password.value });
}

async function onPasskeyPrfOutput(prfBytes: Uint8Array) {
  if (!preflight() || !isPrfWallet.value) return;
  // prfBytes are the RAW WebAuthn PRF output — these decrypt the wallet's
  // mnemonic in BG. Do NOT use `passkey-success`'s decrypted-Cardano-key
  // bytes for this; they're the wrong material and will fail with
  // `OperationError` inside `decryptMnemonicWithPrfOutput`.
  await send({ prfSecret: prfBytes });
}

function onPasskeyError(error: Error) {
  errorMessage.value = error?.message || 'PassKey authentication failed';
}

async function send(credentials: { password?: string; prfSecret?: Uint8Array }) {
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
    recipient.value = '';
    amount.value = '';
    password.value = '';
    debugLog('🌙 Midnight tx submitted:', result.txHash, 'status:', result.status);
    emit('close');
  } catch (e) {
    errorMessage.value = e instanceof Error ? e.message : String(e);
  } finally {
    sending.value = false;
  }
}
</script>

<style scoped>
/* Carried over from the legacy in-place Midnight branch in SendDialog.vue so
   the visual treatment stays identical after the extraction. */
.midnight-balance-snapshot {
  background: linear-gradient(135deg, rgba(0, 199, 243, 0.08) 0%, rgba(255, 216, 110, 0.06) 100%);
  border: 1px solid rgba(0, 199, 243, 0.2);
  border-radius: 10px;
  padding: 14px 16px;
  margin: 8px auto 16px;
  min-width: 200px;
}
.midnight-snapshot-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 4px;
}
.midnight-snapshot-amount {
  font-family: 'Roboto Mono', monospace;
  font-size: 18px;
  font-weight: 600;
  color: #ffffff;
}
.midnight-send-content {
  background: transparent;
}
</style>
