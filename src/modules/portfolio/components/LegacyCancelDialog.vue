<template>
  <BaseDialog
    :is-open="isOpen"
    :title="t('legacyListings.title')"
    icon="mdi-lifebuoy"
    size="md"
    :min-height="0"
    :persistent="busy"
    @close="close()"
  >
    <v-card-text class="legacy-cancel pt-2 px-5 pb-5" data-testid="legacy-cancel">
      <!-- A hardware wallet no device has signed a rescue with yet: nothing to ask of anyone. -->
      <p v-if="view === 'hardware'" class="t-body-sm" data-testid="legacy-cancel-hardware">
        {{ t('legacyListings.hardwareSoon') }}
      </p>

      <!-- The worker is having Nexus build the cancel and checking it. -->
      <div v-else-if="view === 'preparing'" class="legacy-cancel__wait" data-testid="legacy-cancel-preparing">
        <v-progress-circular indeterminate :size="28" :width="3" color="var(--g-accent)" role="status" :aria-label="t('common.loading')" />
      </div>

      <!-- What the worker verified the cancel does. Nothing here comes from Nexus's word. -->
      <template v-else-if="view === 'review' && summary">
        <p class="legacy-cancel__heading t-label">{{ t('legacyListings.review') }}</p>
        <ul class="legacy-cancel__items" data-testid="legacy-cancel-items">
          <li v-for="item in summary.items" :key="`${item.txHash}#${item.outputIndex}`" class="legacy-cancel__item glass-tier">
            <LegacyItemLine :item="item" :meta="meta" />
          </li>
        </ul>
        <dl class="legacy-cancel__rows glass-tier" data-testid="legacy-cancel-review">
          <div class="legacy-cancel__row">
            <dt class="t-caption">{{ t('legacyListings.networkFee') }}</dt>
            <dd class="t-body-sm g-num">{{ feeText }}</dd>
          </div>
        </dl>
        <p v-if="summary.sponsoredCollateralRef" class="legacy-cancel__sponsored t-caption" data-testid="legacy-cancel-sponsored">
          <v-icon size="16" color="var(--g-success)">mdi-shield-check-outline</v-icon>
          <span>{{ t('legacyListings.sponsored') }}</span>
        </p>

        <v-alert v-if="failureText" type="error" variant="tonal" density="compact" class="mt-3" data-testid="legacy-cancel-error">
          {{ failureText }}
        </v-alert>

        <!-- Hardware wallets sign on the device, in the page. -->
        <div v-if="deviceType" class="legacy-cancel__device glass-tier mt-4" data-testid="legacy-cancel-device">
          <v-icon size="20" color="var(--g-accent)">{{ deviceIcon }}</v-icon>
          <p class="t-body-sm">{{ t(deviceHintKey) }}</p>
          <!-- `btSupported` says the Ledger CAN use Bluetooth, not that it is connected that
               way, so USB stays the default and the user picks. -->
          <ToggleSwitch
            v-if="deviceType === WalletType.Ledger && wallet?.btSupported"
            class="legacy-cancel__transport"
            :text-left="t('wallet.usb')"
            icon-left="mdi-usb"
            :text-right="t('wallet.bluetooth')"
            icon-right="mdi-bluetooth"
            :model-value="isBT"
            :disabled="busy"
            @update:model-value="isBT = $event"
          />
        </div>
        <v-alert
          v-if="deviceType === WalletType.Keystone"
          type="warning"
          variant="tonal"
          density="compact"
          class="mt-3"
          data-testid="legacy-cancel-keystone-hash"
        >
          {{ t('programmableTokens.send.keystoneHashOnly') }}
          <span class="d-block t-caption g-mono mt-1">{{ summary.txId }}</span>
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
        <div class="legacy-cancel__actions">
          <GButton tier="secondary" :disabled="busy" data-testid="legacy-cancel-cancel" @click="close()">
            {{ t('common.cancel') }}
          </GButton>
          <PassKeyAuthButton
            v-if="isPrfWallet"
            :block="false"
            :disabled="busy"
            :text="t('common.confirm')"
            @success="sendWithPassKey"
            @error="onPassKeyError"
          />
          <GButton
            v-else
            tier="primary"
            :loading="busy"
            :disabled="busy || (usesPassword && !password)"
            data-testid="legacy-cancel-confirm"
            @click="send()"
          >
            {{ t('common.confirm') }}
          </GButton>
        </div>
      </template>

      <!-- Submitted. -->
      <template v-else-if="view === 'done'">
        <div class="text-center py-2" data-testid="legacy-cancel-done">
          <v-icon size="48" color="var(--g-success)">mdi-check-circle-outline</v-icon>
          <p class="t-heading mt-2">{{ t('legacyListings.done') }}</p>
          <p class="t-caption mt-2">{{ t('transactions.transactionId') }}</p>
          <p class="t-caption g-mono">
            {{ flow.submittedTxId.value }}
            <CopyButton x-small :value="flow.submittedTxId.value ?? ''" class="ml-1" />
          </p>
          <v-btn v-if="txExplorerUrl" variant="text" size="small" :href="txExplorerUrl" target="_blank" rel="noopener noreferrer">
            {{ t('market.viewOnExplorer') }}
          </v-btn>
        </div>
        <div class="legacy-cancel__actions">
          <GButton tier="primary" block data-testid="legacy-cancel-done-button" @click="close()">{{ t('common.done') }}</GButton>
        </div>
      </template>

      <!-- Nothing was built, or the submit was not confirmed. -->
      <template v-else>
        <v-alert type="error" variant="tonal" density="compact" data-testid="legacy-cancel-error">
          {{ failureText }}
        </v-alert>
        <div class="legacy-cancel__actions">
          <GButton tier="secondary" data-testid="legacy-cancel-close" @click="close()">{{ t('common.close') }}</GButton>
          <!-- Items that are gone cannot be built again: the refreshed list shows what is left. -->
          <GButton v-if="!isGone" tier="primary" data-testid="legacy-cancel-retry" @click="start()">{{ t('common.tryAgain') }}</GButton>
        </div>
      </template>
    </v-card-text>

    <!-- Keystone signs by QR: this cancel's request out, the device's signature back in. -->
    <KeystoneSignDialog
      v-if="flow.keystone.keystoneShow.value"
      :is-open="flow.keystone.keystoneShow.value"
      :keystone-type="flow.keystone.keystoneType.value"
      :keystone-cbor="flow.keystone.keystoneCbor.value"
      @scan="flow.keystone.onKeystoneScan"
      @error="flow.keystone.failKeystone"
      @close="flow.keystone.cancelKeystone"
    />
  </BaseDialog>
</template>

<script setup lang="ts">
import { computed, onScopeDispose, provide, ref, watch } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import PassKeyPasswordField from '@/shared/components/PassKeyPasswordField.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import LegacyItemLine from '@/modules/portfolio/components/LegacyItemLine.vue';
import { formatAda } from '@/modules/portfolio/components/legacyItemDisplay';
import { authorizationScopeKey } from '@/shared/composables/authorizationScope';
import { signsOnDevice } from '@/shared/composables/useHardwareTxSigner';
import { useExplorer } from '@/shared/composables/useExplorer';
import { useLegacyListings } from '@/shared/composables/useLegacyListings';
import { useLegacyRescue } from '@/shared/composables/useLegacyRescue';
import { PREPARED_TX_SIGN_FAILED, PREPARED_TX_WRONG_PASSWORD } from '@/shared/composables/usePreparedTxFlow';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { WalletType } from '@/models/types';
import { isLegacyRescueHardware } from '@/utils/legacyMarketScripts';

/**
 * Gets the picked stuck items back: the worker builds and verifies the cancel (prepare), the
 * dialog shows what it does, then signs and submits it. Hosted by PortfolioPage, outside the
 * card: a cancel that empties the list must not take this dialog's "done" screen with it.
 *
 *   open -> preparing -> review (items, network fee, who lends collateral) -> credentials
 *        -> submitting -> done (transaction link)  |  a failure
 *
 * Success hides the refs from the list at once (`forget`) and closing looks the list up again.
 * An item that was spent since the list was read (LISTING_NOT_FOUND) is said to be gone and the
 * list is refreshed. Hardware wallets stay out until a device has signed a real rescue
 * (LEGACY_RESCUE_HARDWARE_WALLET_TYPES): they are told so and nothing is built.
 */
const props = defineProps<{
  isOpen: boolean;
  /** The picked items' `txHash#index` refs, at most LEGACY_CANCEL_MAX. */
  refs: string[];
}>();

const emit = defineEmits<{ (e: 'close'): void }>();

const { t } = useTranslation();
// Ledger only: Bluetooth when the user picks it for this signature, USB otherwise.
const isBT = ref(false);
const flow = useLegacyRescue({ getIsBT: () => isBT.value });
const { meta, forget, refresh } = useLegacyListings();
const { explorerUrl } = useExplorer();

const password = ref('');

const wallet = computed(() => walletStore.loggedWallet);
const stage = computed(() => flow.stage.value);
const busy = computed(() => stage.value === 'preparing' || stage.value === 'signing' || stage.value === 'submitting');
const summary = computed(() => flow.prepared.value?.summary ?? null);

const isPrfWallet = computed(() =>
  wallet.value?.type === WalletType.Normal && (
    wallet.value?.encryptionMethod === 'prf'
    || (!!wallet.value?.prfEncryptedPrivateKey && !!wallet.value?.webAuthnCredentialId)
  ),
);
const usesPassword = computed(() => wallet.value?.type === WalletType.Normal && !isPrfWallet.value);
/** A hardware wallet no device has signed a rescue with: told it is coming, nothing is built. */
const hardwareBlocked = computed(() => signsOnDevice(wallet.value?.type) && !isLegacyRescueHardware(wallet.value?.type));
/** The device that signs, for a hardware wallet the rescue allows; null otherwise. */
const deviceType = computed(() => (signsOnDevice(wallet.value?.type) && isLegacyRescueHardware(wallet.value?.type) ? wallet.value?.type ?? null : null));
const deviceIcon = computed(() => {
  if (deviceType.value === WalletType.Keystone) return 'mdi-qrcode-scan';
  return deviceType.value === WalletType.Ledger && isBT.value ? 'mdi-bluetooth' : 'mdi-usb';
});
const deviceHintKey = computed(() => {
  switch (deviceType.value) {
    case WalletType.Ledger: return 'miniGero.connectLedger';
    case WalletType.Trezor: return 'miniGero.connectTrezor';
    default: return 'miniGero.keystoneSign';
  }
});

const view = computed<'hardware' | 'preparing' | 'review' | 'done' | 'failed'>(() => {
  if (hardwareBlocked.value) return 'hardware';
  if (stage.value === 'done') return 'done';
  if (summary.value && (stage.value === 'review' || stage.value === 'signing' || stage.value === 'submitting')) return 'review';
  // Nothing built, or a submit that was not confirmed: back at idle with the reason.
  if (stage.value === 'idle' && flow.failure.value) return 'failed';
  return 'preparing';
});

const isGone = computed(() => flow.failure.value?.code === 'LISTING_NOT_FOUND');
/** One message for every failure but two: an item that is gone, and a wrong password. */
const failureText = computed(() => {
  const code = flow.failure.value?.code;
  if (!code) return '';
  if (code === 'LISTING_NOT_FOUND') return t('legacyListings.gone');
  if (code === PREPARED_TX_WRONG_PASSWORD) return t('errors.wrongPassword');
  return t('legacyListings.failed');
});

const feeText = computed(() => `${formatAda(summary.value?.feeLovelace ?? '0')} ADA`);
const txExplorerUrl = computed(() => explorerUrl('tx', flow.submittedTxId.value));

// A PassKey result belongs to the cancel on screen when the ceremony started: a new build, a
// step change or a wallet switch makes it stale (PassKeyAuthButton checks before emitting).
let epoch = 0;
let disposed = false;
provide(authorizationScopeKey, {
  capture() {
    const captured = epoch;
    return () => !disposed && captured === epoch;
  },
});
watch(() => [flow.prepared.value?.txId, view.value, wallet.value?.id] as const, () => { epoch++; }, { flush: 'sync' });
onScopeDispose(() => { disposed = true; epoch++; });

// The refs belong to the wallet they were listed for: another wallet closes the dialog (the worker
// would refuse to build or sign for it anyway). Checked again when a request settles, since a
// switch while one is in flight cannot close it then.
let builtForWalletId: number | undefined;
watch(() => [wallet.value?.id, busy.value] as const, ([id, isBusy]) => {
  if (!props.isOpen || isBusy || builtForWalletId === undefined || id === builtForWalletId) return;
  builtForWalletId = undefined;
  password.value = '';
  flow.reset();
  emit('close');
});

/** Start over: a clean flow, then have the worker build the cancel of the given refs. */
function start(): void {
  password.value = '';
  flow.reset();
  builtForWalletId = wallet.value?.id;
  if (hardwareBlocked.value) return;
  void flow.prepare([...props.refs]);
}

// An item spent since the list was read: say so, and let the list catch up behind the dialog.
watch(isGone, (gone) => { if (gone) void refresh(); });

// The cancel went to the network: those items leave the list now, not when the server catches up.
watch(stage, (value) => { if (value === 'done') forget([...(summary.value?.refs ?? props.refs)]); });

// State is reset when the dialog opens, not when it closes: the content stays as it was while
// the dialog fades out. Last of the watchers: it starts the build, whose outcome the others watch.
watch(() => props.isOpen, (open) => { if (open) start(); }, { immediate: true });

function close(): void {
  if (busy.value) return;
  const rescued = stage.value === 'done';
  password.value = '';
  emit('close');
  if (rescued) void refresh();
}

async function send(): Promise<void> {
  if (busy.value || view.value !== 'review') return;
  if (usesPassword.value) {
    if (!password.value) return;
    const typed = password.value;
    // OX Agent: Sensitive Data Protection prevented by taking the typed password out of the field before signing; it is never logged or kept
    password.value = '';
    await flow.signAndSubmit({ password: typed });
    return;
  }
  // Google wallets sign with the unlocked session and hardware wallets on the device:
  // nothing to type.
  await flow.signAndSubmit();
}

async function sendWithPassKey(privateKeyBytes: Uint8Array): Promise<void> {
  if (busy.value || view.value !== 'review') {
    privateKeyBytes.fill(0);
    return;
  }
  await flow.signAndSubmit({ privateKeyBytes });
}

function onPassKeyError(): void {
  flow.failure.value = { code: PREPARED_TX_SIGN_FAILED };
}
</script>

<style scoped lang="scss">
.legacy-cancel__wait {
  display: flex;
  justify-content: center;
  padding: var(--g-s-6) 0;
}

.legacy-cancel__heading {
  margin: 0 0 var(--g-s-2);
}

.legacy-cancel__items {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
  // Up to ten items: they scroll inside the dialog, the fee and the buttons stay in view.
  max-height: 240px;
  overflow-y: auto;
}

.legacy-cancel__item {
  padding: var(--g-s-2) var(--g-s-3);
}

.legacy-cancel__rows {
  margin: var(--g-s-3) 0 0;
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
}

.legacy-cancel__row {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-3);

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

.legacy-cancel__sponsored {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  margin: var(--g-s-2) 0 0;
}

.legacy-cancel__device {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
  text-align: center;

  p {
    margin: 0;
    color: var(--g-text-2);
  }
}

.legacy-cancel__transport {
  width: 100%;
  padding-top: var(--g-s-2);
  border-top: 1px solid var(--g-hairline-1);
}

.legacy-cancel__actions {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-3);
  margin-top: var(--g-s-4);
}
</style>
