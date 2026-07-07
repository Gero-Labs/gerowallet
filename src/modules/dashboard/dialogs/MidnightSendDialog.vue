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
      <v-card-text class="px-3 pb-3 midnight-send-content">
        <!-- Tab toggle: unshielded ↔ shielded. Only renders the tab strip if
             the wallet record carries a viewing key (post-Step-4 wallets).
             Legacy wallets without it stay unshielded-only — without sync
             on the shielded side the send would just hang. -->
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

        <!-- Available balance reminder. Shielded balance display is a
             follow-up — for now we show an em-dash with a one-line hint
             so users aren't surprised the field is blank. -->
        <div class="midnight-balance-snapshot mb-4">
          <div class="midnight-snapshot-label">
            {{ isShielded ? t('midnight.shielded') : t('midnight.unshielded') }}
          </div>
          <div class="midnight-snapshot-amount">
            <template v-if="isShielded">
              {{ t('midnight.send.shieldedBalanceUnavailable') }}
            </template>
            <template v-else>
              {{ formattedAvailable }} {{ nightCurrency }}
            </template>
          </div>
          <div v-if="isShielded" class="midnight-snapshot-hint">
            {{ t('midnight.send.shieldedBalanceHint') }}
          </div>
        </div>

        <v-form ref="formRef" v-model="formValid">
          <v-text-field
            v-model="recipient"
            :label="recipientLabel"
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
            :hint="amountHint"
            persistent-hint
            class="mb-3"
          >
            <template v-slot:append>
              <v-btn
                v-if="!isShielded"
                x-small
                text
                @click="setMax"
                :disabled="sending"
              >MAX</v-btn>
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

          <div v-if="!shieldedAvailable" class="text-caption text--secondary text-center mt-3">
            {{ t('midnight.shieldedSendComingNote') }}
          </div>
        </v-form>
      </v-card-text>
    </BaseDialog>

    <!-- First-time-only consent gate for shielded sends. Opened lazily when
         the user clicks Send on the Shielded tab without a recorded consent
         (or with a consent older than SHIELDED_PROVING_CONSENT_VERSION). On
         accept we re-trigger the in-flight send using the credentials we
         captured at click-time, so the user doesn't have to re-auth. -->
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
import TransactionAuthSection from '@/shared/components/TransactionAuthSection.vue';
import ShieldedProvingConsentDialog from '@/modules/dashboard/dialogs/ShieldedProvingConsentDialog.vue';
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
const nightCurrency = computed(() =>
  loggedWallet.value?.network === Network.MAINNET ? 'NIGHT' : 'tNIGHT'
);

// Shielded send only offered if the wallet record carries a viewing key —
// otherwise gero-sync isn't running a shielded subscription and the user's
// note set is unknown. Step 6 will add an "upgrade this wallet" path to
// re-derive the viewing key for legacy wallets.
// Shielded is only offered when the wallet record carries a viewing key in
// the indexer-accepted `mn_shield-esk_` bech32m form (post-a3f76f1f). Legacy
// wallets (raw-hex / `mn_shield-epk_`) can't open a shielded indexer session,
// so we hide the tab rather than let a send fail at connect(). Matches the
// login-time gate in walletManager.
const shieldedAvailable = computed(() => {
  const vk = midnightStore.addresses?.zswapViewingKey;
  return typeof vk === 'string' && vk.startsWith('mn_shield-esk_');
});

// Tab index: 0 = unshielded (default), 1 = shielded. v-tabs v-model maps to
// the tab order in the template.
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

const formRef = ref<{ validate: () => boolean } | null>(null);
const formValid = ref(false);
const recipient = ref('');

// Prefix auto-routing (Dynamic.xyz's sendBalance pattern): when the user
// pastes a recipient address, select the pool that matches its prefix so
// they don't have to also flip the tab manually. `mn_shield-addr_…` →
// shielded; `mn_addr_…` → unshielded. Only acts when both tabs are available
// and the prefix is unambiguous; never fights a partially-typed address.
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
// Captured at the moment the user clicked Send. If we have to detour through
// the consent dialog we re-use these on the accepted handler so the user
// doesn't have to re-auth after consenting.
const pendingCredentials = ref<{ password?: string; prfSecret?: Uint8Array } | null>(null);

const passwordRules = [rules.required()];

const recipientLabel = computed(() =>
  isShielded.value
    ? t('midnight.send.shieldedRecipientLabel')
    : t('common.recipientAddress'),
);

const amountHint = computed(() =>
  isShielded.value ? '' : `Available: ${formattedAvailable.value} ${nightCurrency.value}`,
);

// Address shape check is intentionally permissive — the indexer is the final
// arbiter; we only catch obvious typos here. Networks: mainnet uses bare
// `mn_addr_`, others use `mn_addr_<network>_` (e.g. `mn_addr_preview_`).
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
    // Without shielded balance display we can't cap the amount client-side;
    // the SDK's transferTransaction will reject if the note set can't cover
    // it. Keep positive-amount as the only assertion here.
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

function preflight(): boolean {
  errorMessage.value = null;
  if (!formRef.value?.validate()) return false;
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
  // prfBytes are the RAW WebAuthn PRF output — these decrypt the wallet's
  // mnemonic in BG. Do NOT use `passkey-success`'s decrypted-Cardano-key
  // bytes for this; they're the wrong material and will fail with
  // `OperationError` inside `decryptMnemonicWithPrfOutput`.
  await routeSend({ prfSecret: prfBytes });
}

function onPasskeyError(error: Error) {
  errorMessage.value = error?.message || 'PassKey authentication failed';
}

/**
 * Submit-button router. Unshielded sends pass straight through; shielded
 * sends gate on a fresh consent record, deferring to the consent dialog if
 * needed. The credentials captured here survive the consent detour via
 * pendingCredentials so the user doesn't have to re-auth after accepting.
 */
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
  // Cancel — drop the pending credentials so a later send re-prompts auth.
  // Don't surface an error message; the user's intent was clear (cancel).
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
.midnight-snapshot-hint {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.45);
  margin-top: 6px;
  line-height: 1.4;
}
.midnight-send-content {
  background: transparent;
}
.midnight-send-tabs :deep(.v-tab) {
  text-transform: none;
  letter-spacing: 0.02em;
  font-size: 13px;
  min-width: 0;
  padding: 0 12px;
}
</style>
