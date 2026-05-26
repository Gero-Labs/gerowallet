<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :title="t('midnight.registerForDust')"
    :subtitle="t('midnight.registerForDustSubtitle')"
    :loading="loading"
    icon="mdi-shield-star"
    :width="560"
    :min-height="480"
  >
    <v-card-text class="px-0" style="z-index: 1">
      <!-- Status pill: compact one-liner with a colored dot. Replaces the
           previous full-bleed v-alert which dominated the dialog visually. -->
      <div class="status-pill" :class="`status-pill--${statusKey}`">
        <span class="status-dot" :class="`status-dot--${statusKey}`"></span>
        <span class="status-pill-label">{{ statusLabel }}</span>
        <v-spacer />
        <span class="status-pill-help">{{ statusHelp }}</span>
      </div>

      <!-- Hero card: the DUST recipient address. This is the thing the user is
           registering — give it visual weight. When dust=='' (legacy wallet),
           the same card swaps to an upgrade prompt instead of the address. -->
      <div class="recipient-card" v-if="dustAddress">
        <div class="recipient-label">{{ t('midnight.dustRecipientAddress') }}</div>
        <div class="recipient-row">
          <v-avatar size="32" color="amber darken-4" class="mr-3">
            <v-icon small color="amber lighten-2">mdi-star</v-icon>
          </v-avatar>
          <div class="recipient-address">
            <div class="recipient-address-text">{{ middleTruncate(dustAddress, 18, 8) }}</div>
            <div class="recipient-network">{{ networkLabel }} · DUST address</div>
          </div>
          <CopyButton :value="dustAddress" small />
        </div>
      </div>

      <!-- Upgrade card: shown when dust='' so the legacy wallet user can derive.
           Same recipient-card shape so the layout doesn't shift between states. -->
      <div class="recipient-card recipient-card--upgrade" v-else>
        <div class="recipient-label">{{ t('midnight.dustRecipientAddress') }}</div>
        <div class="upgrade-body">
          <v-icon small color="amber" class="mr-2">mdi-alert-outline</v-icon>
          <span class="upgrade-text">
            {{ isPrfWallet ? t('midnight.upgradeAddressesNoticePrf') : t('midnight.upgradeAddressesNotice') }}
          </span>
        </div>
        <v-text-field
          v-if="!isPrfWallet"
          v-model="upgradePassword"
          :label="t('common.spendingPassword')"
          type="password"
          dense
          outlined
          hide-details
          class="mt-2"
          :disabled="upgradeBusy"
          @keydown.enter="runUpgrade"
        />
        <div v-if="upgradeError" class="red--text text--lighten-2 text-caption mt-2">
          {{ upgradeError }}
        </div>
        <v-btn
          block
          small
          color="primary"
          class="mt-3"
          :loading="upgradeBusy"
          :disabled="!isPrfWallet && !upgradePassword"
          @click="runUpgrade"
        >
          <v-icon small left>{{ isPrfWallet ? 'mdi-fingerprint' : 'mdi-key-variant' }}</v-icon>
          {{ isPrfWallet ? t('midnight.authorizeWithPasskey') : t('midnight.deriveDustAddress') }}
        </v-btn>
      </div>

      <!-- Flow diagram: 3-stop horizontal map of the registration. Replaces
           the previous 3-bullet "How it works" block. Each stop is iconic. -->
      <div class="flow-diagram">
        <div class="flow-stop">
          <div class="flow-stop-icon flow-stop-icon--cardano">
            <v-icon small color="white">mdi-link-variant</v-icon>
          </div>
          <div class="flow-stop-label">Cardano cNIGHT</div>
        </div>
        <div class="flow-arrow">
          <v-icon small color="rgba(255,255,255,0.3)">mdi-arrow-right</v-icon>
          <span class="flow-arrow-label">{{ t('midnight.flowSign') }}</span>
        </div>
        <div class="flow-stop">
          <div class="flow-stop-icon flow-stop-icon--validator">
            <v-icon small color="white">mdi-shield-key</v-icon>
          </div>
          <div class="flow-stop-label">{{ t('midnight.flowValidator') }}</div>
        </div>
        <div class="flow-arrow">
          <v-icon small color="rgba(255,255,255,0.3)">mdi-arrow-right</v-icon>
          <span class="flow-arrow-label">~2.5h</span>
        </div>
        <div class="flow-stop">
          <div class="flow-stop-icon flow-stop-icon--midnight">
            <v-icon small color="white">mdi-star-four-points</v-icon>
          </div>
          <div class="flow-stop-label">{{ t('midnight.flowDust') }}</div>
        </div>
      </div>

      <!-- Generation stats: visible only after registration. Mirrors Cardano
           staking's "active delegation" detail surface. -->
      <div v-if="registrationStatus === 'Registered'" class="generation-stats">
        <div class="stat-pair">
          <div class="stat-label">{{ t('midnight.nightRegistered') }}</div>
          <div class="stat-value">{{ formatNight(nightRegistered) }} {{ nightCurrency }}</div>
        </div>
        <div class="stat-pair">
          <div class="stat-label">{{ t('midnight.generationRate') }}</div>
          <div class="stat-value">{{ formatDust(dustGenerating) }} {{ dustCurrency }}/s</div>
        </div>
        <div class="stat-pair">
          <div class="stat-label">{{ t('midnight.capacity') }}</div>
          <div class="stat-value">
            {{ formatDust(dustCurrent) }} / {{ formatDust(dustCap) }} {{ dustCurrency }}
          </div>
        </div>
        <v-progress-linear
          rounded
          color="cyan"
          height="6"
          :value="capProgress"
          striped
          class="mt-2"
        />
      </div>
    </v-card-text>

    <!-- Primary action: gradient button matches the wallet's geroButton style.
         The CTA changes per status so the user always sees the right next step. -->
    <v-card-actions class="px-0 pt-0" style="display: block">
      <!-- Unregistered / Invalid: Midnight-native register (Path A) flow -->
      <template v-if="registrationStatus === 'Unregistered' || registrationStatus === 'Invalid'">
        <!-- Stage 1: pre-build CTA. For PRF wallets `startRegistration` skips
             straight to the PassKey gesture; password wallets get the input. -->
        <template v-if="!inSigningPhase">
          <v-btn
            block
            large
            class="geroButton"
            :disabled="!dustAddress"
            @click="startRegistration"
          >
            <v-icon left>mdi-shield-plus</v-icon>
            {{ t('midnight.registerForDust') }}
          </v-btn>

          <!-- Fallback: external portal (Path B / foundation flow). Kept as a
               low-prominence option for users who want to use cNIGHT on Cardano
               instead of native NIGHT registration. -->
          <div class="text-center mt-3">
            <v-btn small text color="rgba(255,255,255,0.6)" @click="openRedemptionPortal">
              <v-icon small left>mdi-open-in-new</v-icon>
              {{ t('midnight.openRedemptionPortal') }}
            </v-btn>
          </div>
        </template>

        <!-- Stage 2: password input (or PassKey gesture) + Sign & Register.
             Path A is a single round-trip: build + sign + submit in one BG call. -->
        <template v-else>
          <v-text-field
            v-if="!isPrfWalletForSign"
            v-model="localPassword"
            :label="t('common.spendingPassword')"
            type="password"
            outlined
            dense
            :disabled="submitBusy"
            @keydown.enter="confirmRegistration"
            class="mb-2"
          />

          <div v-if="submitError" class="red--text text--lighten-2 text-caption mb-2">
            {{ submitError }}
          </div>

          <v-btn
            block
            large
            class="geroButton"
            :loading="submitBusy"
            :disabled="!canConfirmRegistration"
            @click="confirmRegistration"
          >
            <v-icon left>{{ isPrfWalletForSign ? 'mdi-fingerprint' : 'mdi-shield-check' }}</v-icon>
            {{ isPrfWalletForSign ? t('midnight.authorizeWithPasskey') : t('midnight.signAndRegister') }}
          </v-btn>

          <div class="text-center mt-2">
            <v-btn small text :disabled="submitBusy" @click="resetRegistrationState">
              {{ t('common.cancel') }}
            </v-btn>
          </div>
        </template>
      </template>

      <v-btn
        v-else-if="registrationStatus === 'Pending'"
        block
        large
        outlined
        @click="$emit('close')"
      >
        <v-icon left>mdi-clock-outline</v-icon>
        {{ t('common.close') }}
      </v-btn>
      <!-- Registered: show Done + a secondary Deregister action. -->
      <template v-else-if="registrationStatus === 'Registered'">
        <!-- Stage 1: pre-build CTA (mirrors the register flow). -->
        <template v-if="!inDeregisterPhase">
          <v-btn block large outlined @click="$emit('close')">
            {{ t('common.done') }}
          </v-btn>
          <div class="text-center mt-3">
            <v-btn small text color="rgba(255,255,255,0.6)" @click="startDeregister">
              <v-icon small left>mdi-link-off</v-icon>
              {{ t('midnight.deregisterFromDust') }}
            </v-btn>
          </div>
        </template>
        <!-- Stage 2: password / PassKey + Sign & Deregister. -->
        <template v-else>
          <v-text-field
            v-if="!isPrfWalletForSign"
            v-model="localPassword"
            :label="t('common.spendingPassword')"
            type="password"
            outlined
            dense
            :disabled="submitBusy"
            @keydown.enter="confirmDeregister"
            class="mb-2"
          />
          <div v-if="submitError" class="red--text text--lighten-2 text-caption mb-2">
            {{ submitError }}
          </div>
          <v-btn
            block
            large
            class="geroButton"
            :loading="submitBusy"
            :disabled="!canConfirmRegistration"
            @click="confirmDeregister"
          >
            <v-icon left>{{ isPrfWalletForSign ? 'mdi-fingerprint' : 'mdi-link-off' }}</v-icon>
            {{ isPrfWalletForSign ? t('midnight.authorizeWithPasskey') : t('midnight.signAndDeregister') }}
          </v-btn>
          <div class="text-center mt-2">
            <v-btn small text :disabled="submitBusy" @click="resetRegistrationState">
              {{ t('common.cancel') }}
            </v-btn>
          </div>
        </template>
      </template>
      <v-btn
        v-else
        block
        large
        outlined
        @click="$emit('close')"
      >
        {{ t('common.done') }}
      </v-btn>
    </v-card-actions>
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, ref, toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useMidnightDustLive } from '@/shared/composables/useMidnightDustLive';
import snackbar from '@/plugins/snackbar';

const props = defineProps<{ isOpen: boolean }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useTranslation();
const loading = ref(false);

// Legacy-wallet upgrade state
const upgradePassword = ref('');
const upgradeBusy = ref(false);
const upgradeError = ref<string | null>(null);

const { addresses, balances, dustState } = toRefs(midnightStore);
const { loggedWallet } = toRefs(walletStore);

const encryptionMethod = computed<'password' | 'prf' | undefined>(
  () => loggedWallet.value?.encryptionMethod,
);
const isPrfWallet = computed(() => encryptionMethod.value === 'prf');

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);
const DUST_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.DUST);

const isMainnet = computed(() => loggedWallet.value?.network === Network.MAINNET);
const nightCurrency = computed(() => (isMainnet.value ? 'NIGHT' : 'tNIGHT'));
const dustCurrency = computed(() => (isMainnet.value ? 'DUST' : 'tDUST'));
const networkLabel = computed(() => (isMainnet.value ? 'Mainnet' : 'Preview'));

const dustAddress = computed(() => addresses.value?.dust ?? '');

// Live DUST state — polled from Nexus every 5s, extrapolated locally
// every 1s. Module-scoped singleton so the portfolio + this dialog share
// one poll loop.
const dustLive = useMidnightDustLive();
const nightRegistered = computed(() => {
  if (dustLive.hasData.value) return dustLive.nightRegistered.value;
  return balances.value?.nightRegistered ?? 0n;
});
const dustGenerating = computed(() => {
  if (dustLive.hasData.value) return dustLive.dustGenerating.value;
  return balances.value?.dustGenerating ?? 0n;
});

const registrationStatus = computed<'Unregistered' | 'Pending' | 'Registered' | 'Invalid'>(() => {
  return (dustState.value?.registrationStatus as 'Unregistered' | 'Pending' | 'Registered' | 'Invalid') ?? 'Unregistered';
});

// Live DUST balance + cap — composable handles polling + 1s tick. Fall back
// to gero-sync's AccountInfo snapshot before the first poll completes.
const dustCurrent = computed<bigint>(() => {
  if (dustLive.hasData.value) return dustLive.dustBalance.value;
  return dustState.value?.current ?? 0n;
});
const dustCap = computed(() => {
  if (dustLive.hasData.value) return dustLive.dustCap.value;
  return dustState.value?.cap ?? 0n;
});
const capProgress = computed(() => {
  if (dustCap.value === 0n) return 0;
  const pct = Number((dustCurrent.value * 10000n) / dustCap.value) / 100;
  return Math.min(100, pct);
});

const statusKey = computed(() => {
  switch (registrationStatus.value) {
    case 'Registered': return 'registered';
    case 'Pending': return 'pending';
    case 'Invalid': return 'invalid';
    default: return 'unregistered';
  }
});

const statusLabel = computed(() => {
  switch (registrationStatus.value) {
    case 'Registered': return t('midnight.statusRegistered');
    case 'Pending': return t('midnight.statusPending');
    case 'Invalid': return t('midnight.statusInvalid');
    default: return t('midnight.statusUnregistered');
  }
});

const statusHelp = computed(() => {
  switch (registrationStatus.value) {
    case 'Registered': return '';
    case 'Pending': return '~2.5h';
    case 'Invalid': return '';
    default: return '';
  }
});

function formatBigDecimal(value: bigint, divisor: bigint, fractionDigits: number): string {
  if (value < 0n) value = 0n;
  const whole = value / divisor;
  const remainder = value % divisor;
  if (fractionDigits === 0) return whole.toLocaleString('en-US');
  const remainderStr = remainder.toString().padStart(divisor.toString().length - 1, '0');
  const fraction = remainderStr.slice(0, fractionDigits).padEnd(fractionDigits, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

function formatNight(value: bigint): string {
  return formatBigDecimal(value, NIGHT_DIVISOR, 2);
}

function formatDust(value: bigint): string {
  return formatBigDecimal(value, DUST_DIVISOR, 4);
}

function middleTruncate(s: string, head = 16, tail = 8): string {
  if (!s || s.length <= head + tail + 1) return s;
  return `${s.slice(0, head)}…${s.slice(-tail)}`;
}

async function runUpgrade() {
  upgradeError.value = null;
  if (upgradeBusy.value) return;
  const wallet = loggedWallet.value;
  if (!wallet) {
    upgradeError.value = 'No wallet logged in';
    return;
  }

  upgradeBusy.value = true;
  try {
    let mnemonic = '';
    if (isPrfWallet.value) {
      if (!wallet.prfEncryptedMnemonic) {
        throw new Error('PRF wallet has no encrypted mnemonic. Re-restore from your seed phrase.');
      }
      if (!wallet.webAuthnCredentialId) {
        throw new Error('PRF wallet missing credential ID. Re-pair your PassKey or re-restore.');
      }
      const { decryptMnemonicWithPrf } = await import('@/shared/utils/webauthn-prf');
      try {
        mnemonic = await decryptMnemonicWithPrf(
          wallet.prfEncryptedMnemonic,
          wallet.webAuthnCredentialId,
          wallet.id.toString(),
        );
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        throw new Error(`PassKey authorization failed: ${msg}`);
      }
    } else {
      if (!wallet.encryptedMnemonic) {
        throw new Error('Wallet has no encrypted mnemonic. Re-restore from your seed phrase.');
      }
      const { decrypt } = await import('@/shared/utils/crypto');
      try {
        mnemonic = decrypt(wallet.encryptedMnemonic, upgradePassword.value);
      } catch {
        throw new Error('Wrong spending password');
      }
    }

    const { deriveMidnightAddresses } = await import('@/chains/midnight/midnightKeyManager');
    const derived = await deriveMidnightAddresses(mnemonic, wallet.network);

    const { Messaging } = await import('@/chrome/messaging');
    const { MessageTypes } = await import('@/models/MessageTypes');
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.UPDATE_MIDNIGHT_PUBLIC_KEY,
      data: {
        walletId: wallet.id,
        publicKey: JSON.stringify(derived),
      },
    }) as { data: { success: boolean; error?: string } };
    if (!response?.data?.success) {
      throw new Error(response?.data?.error || 'Failed to persist updated addresses');
    }

    const { midnightActions } = await import('@/stores/midnightStore');
    midnightActions.setActive(derived);

    upgradePassword.value = '';
  } catch (e) {
    upgradeError.value = e instanceof Error ? e.message : String(e);
  } finally {
    upgradeBusy.value = false;
  }
}

async function openRedemptionPortal() {
  if (dustAddress.value && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(dustAddress.value);
    } catch {
      // Clipboard write can fail in restricted contexts; not fatal.
    }
  }
  const portalUrl = isMainnet.value
    ? 'https://redeem.midnight.gd/'
    : 'https://dust.preview.midnight.network/';
  window.open(portalUrl, '_blank', 'noopener,noreferrer');
}

// ─── DUST registration — Path A (Midnight-native NIGHT-for-DUST) ─────────────
//
// The wallet's own NIGHT UTxOs get registered to generate DUST for the
// wallet's own DUST address. Signed locally with the NightExternal key
// (same key the unshielded send pipeline already uses). No Cardano
// interaction, no ADA needed.
//
// Two phases:
//   • Stage 1: user clicks "Register" → spending password or PassKey gesture
//     gathered → call `registerNightForDust` which orchestrates
//     getKeys → build → sign → submit in one round-trip.
//   • UI lock during the round-trip (5–10s).
//
// Path B (Cardano-side mapping validator) remains in the codebase for users
// holding cNIGHT on Cardano but is no longer the primary action — see the
// Cardano wallet view for that flow (planned).

const submitBusy = ref(false);
const submitError = ref<string | null>(null);
/** Spending-password input bound to the password wallet sign UI. */
const localPassword = ref('');
/** Switches the action area from "Register" CTA to the password / PassKey gate. */
const inSigningPhase = ref(false);
/** Same idea as inSigningPhase but for the Deregister button (registered → confirm). */
const inDeregisterPhase = ref(false);

const isPrfWalletForSign = computed(() => isPrfWallet.value);

function resetRegistrationState() {
  submitBusy.value = false;
  submitError.value = null;
  inSigningPhase.value = false;
  inDeregisterPhase.value = false;
  localPassword.value = '';
}

function startDeregister() {
  inDeregisterPhase.value = true;
  if (isPrfWalletForSign.value) {
    confirmDeregister();
  }
}

async function confirmDeregister() {
  const wallet = loggedWallet.value;
  if (!wallet) return;
  if (!wallet.baseAddress) {
    submitError.value = 'Wallet missing Midnight address';
    snackbar.setError(submitError.value);
    return;
  }
  submitBusy.value = true;
  submitError.value = null;
  try {
    let prfSecret: Uint8Array | undefined;
    if (isPrfWalletForSign.value) {
      if (!wallet.webAuthnCredentialId) {
        throw new Error('PRF wallet missing credential ID');
      }
      const { evaluatePrfForWallet } = await import('@/shared/utils/webauthn-prf');
      const prfBuf = await evaluatePrfForWallet(wallet.webAuthnCredentialId, wallet.id.toString());
      prfSecret = new Uint8Array(prfBuf);
    }
    const { deregisterNightForDust } = await import('@/services/midnight-tx.service');
    const result = await deregisterNightForDust(
      wallet.network,
      { fromAddress: wallet.baseAddress },
      {
        password: isPrfWalletForSign.value ? undefined : localPassword.value,
        prfSecret,
      },
    );
    snackbar.fireSuccess(t('midnight.dustDeregistrationSubmitted'));
    void result;
    resetRegistrationState();
    emit('close');
  } catch (e) {
    submitError.value = e instanceof Error ? e.message : String(e);
    snackbar.setError(submitError.value);
  } finally {
    submitBusy.value = false;
  }
}

function startRegistration() {
  if (!dustAddress.value) return;
  // For PRF wallets, kick straight into the PassKey gesture (no input field).
  // For password wallets, show the inline password field first.
  inSigningPhase.value = true;
  if (isPrfWalletForSign.value) {
    confirmRegistration();
  }
}

const canConfirmRegistration = computed(() => {
  if (submitBusy.value) return false;
  if (!dustAddress.value) return false;
  if (isPrfWalletForSign.value) return true;
  return !!localPassword.value;
});

async function confirmRegistration() {
  const wallet = loggedWallet.value;
  if (!wallet) return;
  if (!dustAddress.value) return;
  if (!wallet.baseAddress) {
    submitError.value = 'Wallet missing Midnight address';
    snackbar.setError(submitError.value);
    return;
  }

  submitBusy.value = true;
  submitError.value = null;
  try {
    let prfSecret: Uint8Array | undefined;
    if (isPrfWalletForSign.value) {
      if (!wallet.webAuthnCredentialId) {
        throw new Error('PRF wallet missing credential ID');
      }
      const { evaluatePrfForWallet } = await import('@/shared/utils/webauthn-prf');
      const prfBuf = await evaluatePrfForWallet(wallet.webAuthnCredentialId, wallet.id.toString());
      prfSecret = new Uint8Array(prfBuf);
    }

    const { registerNightForDust } = await import('@/services/midnight-tx.service');
    const result = await registerNightForDust(
      wallet.network,
      {
        fromAddress: wallet.baseAddress,
        dustReceiverAddressBech32: dustAddress.value,
      },
      {
        password: isPrfWalletForSign.value ? undefined : localPassword.value,
        prfSecret,
      },
    );

    snackbar.fireSuccess(t('midnight.dustRegistrationSubmitted'));
    void result; // result.txHash available for future "view tx" link
    resetRegistrationState();
    emit('close');
  } catch (e) {
    submitError.value = e instanceof Error ? e.message : String(e);
    snackbar.setError(submitError.value);
  } finally {
    submitBusy.value = false;
  }
}

void props;
</script>

<style scoped>
/* ── Status pill ─────────────────────────────────────────────────────────────
   Compact one-liner replacing the previous full-bleed alert. Color-coded dot
   communicates state at a glance without dominating the dialog. */

.status-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 16px;
  font-size: 12px;
}

.status-pill-label {
  font-weight: 600;
  color: rgba(255, 255, 255, 0.95);
}

.status-pill-help {
  color: rgba(255, 255, 255, 0.45);
  font-size: 11px;
  font-family: 'Roboto Mono', monospace;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  flex-shrink: 0;
  position: relative;
}

.status-dot::after {
  content: '';
  position: absolute;
  inset: -3px;
  border-radius: 50%;
  opacity: 0.5;
  animation: dot-pulse 2.4s ease-in-out infinite;
}

.status-dot--unregistered { background: rgba(255, 255, 255, 0.5); }
.status-dot--unregistered::after { background: rgba(255, 255, 255, 0.5); }

.status-dot--pending { background: #FFD86E; }
.status-dot--pending::after { background: #FFD86E; }

.status-dot--registered { background: #47CD89; }
.status-dot--registered::after { background: #47CD89; }

.status-dot--invalid { background: #F97066; }
.status-dot--invalid::after { background: #F97066; }

@keyframes dot-pulse {
  0%, 100% { transform: scale(1); opacity: 0.4; }
  50% { transform: scale(1.6); opacity: 0; }
}

.status-pill--unregistered {
  border-color: rgba(255, 255, 255, 0.08);
}
.status-pill--pending {
  background: rgba(255, 216, 110, 0.06);
  border-color: rgba(255, 216, 110, 0.2);
}
.status-pill--registered {
  background: rgba(71, 205, 137, 0.06);
  border-color: rgba(71, 205, 137, 0.2);
}
.status-pill--invalid {
  background: rgba(249, 112, 102, 0.06);
  border-color: rgba(249, 112, 102, 0.2);
}

/* ── Recipient card ──────────────────────────────────────────────────────────
   The DUST address is the focal element of the dialog — give it a card with
   real visual weight so the user knows that's what they're mapping TO. */

.recipient-card {
  background: linear-gradient(135deg, rgba(255, 216, 110, 0.04) 0%, rgba(0, 199, 243, 0.04) 100%);
  border: 1px solid rgba(255, 216, 110, 0.18);
  border-radius: 12px;
  padding: 14px 16px;
  margin-bottom: 16px;
}

.recipient-card--upgrade {
  background: rgba(255, 216, 110, 0.04);
  border-color: rgba(255, 216, 110, 0.25);
}

.recipient-label {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.08em;
  color: rgba(255, 255, 255, 0.5);
  margin-bottom: 8px;
}

.recipient-row {
  display: flex;
  align-items: center;
}

.recipient-address {
  flex: 1 1 auto;
  min-width: 0;
}

.recipient-address-text {
  font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 13px;
  color: #ffffff;
  font-weight: 500;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.recipient-network {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.4);
  margin-top: 2px;
}

.upgrade-body {
  display: flex;
  align-items: flex-start;
  font-size: 12px;
  color: rgba(255, 255, 255, 0.75);
  line-height: 1.5;
}

.upgrade-text {
  flex: 1 1 auto;
}

/* ── Flow diagram ────────────────────────────────────────────────────────────
   Horizontal 3-stop map. Replaces the prior 3-bullet "How it works" block —
   the icons + arrows communicate the cross-chain flow at a glance. */

.flow-diagram {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 4px;
  padding: 12px 0 16px;
  margin-bottom: 12px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
}

.flow-stop {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  min-width: 0;
}

.flow-stop-icon {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid rgba(255, 255, 255, 0.1);
}

.flow-stop-icon--cardano {
  background: linear-gradient(135deg, #0033ad 0%, #1c4ec5 100%);
}

.flow-stop-icon--validator {
  background: linear-gradient(135deg, #5e35b1 0%, #7c4dff 100%);
}

.flow-stop-icon--midnight {
  background: linear-gradient(135deg, #00838f 0%, #00bcd4 100%);
}

.flow-stop-label {
  font-size: 10px;
  color: rgba(255, 255, 255, 0.65);
  text-align: center;
  white-space: nowrap;
  font-weight: 500;
}

.flow-arrow {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  min-width: 0;
}

.flow-arrow-label {
  font-size: 9px;
  color: rgba(255, 255, 255, 0.35);
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

/* ── Generation stats (post-registration) ──────────────────────────────────── */

.generation-stats {
  background: rgba(0, 0, 0, 0.2);
  border-radius: 8px;
  padding: 12px 14px;
  margin-top: 8px;
}

.stat-pair {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 4px 0;
}

.stat-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.5);
}

.stat-value {
  font-family: 'Roboto Mono', monospace;
  font-size: 12px;
  font-weight: 500;
  color: #ffffff;
}
</style>
