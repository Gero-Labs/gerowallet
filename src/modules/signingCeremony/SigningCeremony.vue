<template>
  <div class="signing-ceremony pa-2">
    <v-card class="glass-panel signing-ceremony__card" variant="flat">
      <v-card-title class="t-title px-5 pt-5">{{ t('signingCeremony.title') }}</v-card-title>
      <v-card-text class="px-5">
        <p class="t-body-sm mb-4">{{ t('signingCeremony.intro') }}</p>

        <v-btn-toggle v-model="kind" mandatory density="compact" color="primary" class="mb-4" data-testid="ceremony-kind">
          <v-btn value="delegation">{{ t('signingCeremony.approveKey') }}</v-btn>
          <v-btn value="revocation">{{ t('signingCeremony.revokeKeys') }}</v-btn>
        </v-btn-toggle>

        <template v-if="kind === 'delegation'">
          <v-text-field v-model.trim="kid" :label="t('signingCeremony.keyId')" :error-messages="fieldErrors.kid" density="compact" variant="outlined" data-testid="ceremony-kid" />
          <v-select v-model="service" :items="services" :label="t('signingCeremony.service')" density="compact" variant="outlined" attach />
          <v-text-field v-model.trim="host" :label="t('signingCeremony.host')" :error-messages="fieldErrors.host" density="compact" variant="outlined" data-testid="ceremony-host" />
          <v-row dense>
            <v-col cols="6">
              <v-text-field v-model.trim="from" :label="t('signingCeremony.from')" placeholder="YYYY-MM-DD" :error-messages="fieldErrors.from" density="compact" variant="outlined" />
            </v-col>
            <v-col cols="6">
              <v-text-field v-model.number="days" type="number" :label="t('signingCeremony.days')" :error-messages="fieldErrors.days" density="compact" variant="outlined" />
            </v-col>
          </v-row>
          <v-text-field v-model.trim="publicKeyHex" :label="t('signingCeremony.publicKey')" :error-messages="fieldErrors.key" density="compact" variant="outlined" class="g-mono" data-testid="ceremony-key" />
        </template>
        <template v-else>
          <v-text-field v-model.trim="issued" :label="t('signingCeremony.issued')" placeholder="YYYY-MM-DD" :error-messages="fieldErrors.issued" density="compact" variant="outlined" />
          <v-text-field v-model.trim="revokedKids" :label="t('signingCeremony.revokedKeyIds')" :error-messages="fieldErrors.revoked" density="compact" variant="outlined" data-testid="ceremony-revoked" />
        </template>

        <div class="t-label mb-1">{{ t('signingCeremony.statement', { bytes: statementBytes, max: MAX_STATEMENT_BYTES }) }}</div>
        <!-- Verbatim: this is the text the device shows and signs. -->
        <div class="signing-ceremony__statement glass-tier g-mono t-body-sm" data-testid="ceremony-statement">{{ statement }}</div>
        <v-alert v-if="statementError" type="warning" variant="text" density="compact" class="px-0" data-testid="ceremony-statement-error">
          {{ statementError }}
        </v-alert>
        <p class="t-caption mt-2">{{ t('signingCeremony.checkOnDevice') }}</p>
        <p class="t-caption mt-1" data-testid="ceremony-approvals">
          {{ kind === 'delegation' ? t('signingCeremony.bothSign') : t('signingCeremony.oneRevokes') }}
        </p>

        <div class="mt-4">
          <v-alert v-if="!isHardwareCardano" type="warning" variant="text" density="compact" class="px-0" data-testid="ceremony-unsupported">
            {{ t('signingCeremony.hardwareOnly') }}
          </v-alert>
          <ToggleSwitch
            v-else-if="walletType === WalletType.Ledger"
            :text-left="t('wallet.usb')"
            icon-left="mdi-usb"
            :text-right="t('wallet.bluetooth')"
            icon-right="mdi-bluetooth"
            :model-value="isBluetooth"
            :disabled="loading"
            @update:model-value="isBluetooth = $event"
          />
          <v-alert v-else type="info" color="primary" variant="text" density="compact" class="px-0">
            {{ t('wallet.confirmOnTrezor') }}
          </v-alert>
          <p v-if="stakeAddress" class="t-caption g-mono signing-ceremony__wrap">{{ t('signingCeremony.signsWith', { address: stakeAddress }) }}</p>
        </div>
      </v-card-text>
      <v-card-actions class="px-5 pb-5">
        <v-btn
          class="geroButton"
          block
          :loading="loading"
          :disabled="!canSign"
          data-testid="ceremony-sign"
          @click="sign()"
        >
          {{ t('signingCeremony.sign') }}
        </v-btn>
      </v-card-actions>

      <v-card-text v-if="result" class="px-5 pt-0" data-testid="ceremony-result">
        <div class="t-label mb-1">{{ t('signingCeremony.rootKey') }}</div>
        <div class="d-flex align-center ga-2">
          <span class="g-mono t-body-sm signing-ceremony__wrap" data-testid="ceremony-root-key">{{ result.rootPublicKeyHex }}</span>
          <CopyButton :value="result.rootPublicKeyHex" small />
        </div>
        <v-alert :type="result.pinned ? 'success' : 'info'" variant="text" density="compact" class="px-0" data-testid="ceremony-pinned">
          {{ result.pinned ? t('signingCeremony.pinned') : t('signingCeremony.notPinned') }}
        </v-alert>
        <div class="t-label mt-2 mb-1">{{ t('signingCeremony.entry') }}</div>
        <div class="d-flex align-start ga-2">
          <pre class="signing-ceremony__statement glass-tier g-mono t-body-sm flex-grow-1" data-testid="ceremony-entry">{{ entryJson }}</pre>
          <CopyButton :value="entryJson" small />
        </div>
      </v-card-text>
    </v-card>
  </div>
</template>
<script setup lang="ts">
import { computed, ref, toRefs, watch } from 'vue';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { Messaging, type BackgroundResponse, type SignDataResponse } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { Blockchain, WalletType } from '@/models/types';
import snackbar from '@/plugins/snackbar';
import hardwareLoading from '@/plugins/hardwareLoading';
import networks from '@/utils/networks';
import ledger from '@/shared/utils/ledger';
import { accountIndexFromKeys } from '@/shared/utils/walletAccount';
import { dispatchTrezor } from '@/shared/utils/trezorDispatch';
import { getErrorMessage } from '@/shared/utils/errorHandler';
import {
  MAX_DELEGATION_DAYS,
  MAX_STATEMENT_BYTES,
  SIGNING_SERVICES,
  buildDelegationStatement,
  buildRevocationStatement,
  daySeconds,
  isHost,
  isKeyId,
  type SigningService,
} from '@/shared/utils/signedResponseRoots';
import { addDays, checkCeremonySignature, splitList, textToHex, utcDay, type CeremonyCheck } from './ceremony';

/**
 * Signing page for the two root-key holders (no navigation entry: open
 * `#/signing-ceremony`). It builds a delegation or revocation statement, has the
 * logged hardware wallet sign it with its stake key, checks the signature as every
 * wallet will, and prints the entry for gero-backend's delegations file. Wallets
 * accept a delegation only once both holders have signed the same text (one entry
 * each); one holder's revocation is enough.
 *
 * Hardware wallets only: a root key that ever sat in a password wallet is a key
 * that has been on a computer.
 */
const { t } = useTranslation();
const { loggedWallet, keys } = toRefs(walletStore);

type Kind = 'delegation' | 'revocation';
type Signed = { signature: string; key: string };

const services = SIGNING_SERVICES as readonly SigningService[];
const today = utcDay(Date.now());

const kind = ref<Kind>('delegation');
const kid = ref('');
const service = ref<SigningService>('gero-backend');
const host = ref('api.gerowallet.io');
const from = ref(today);
const days = ref(90);
const publicKeyHex = ref('');
const issued = ref(today);
const revokedKids = ref('');
const isBluetooth = ref(false);
const loading = ref(false);
const result = ref<Extract<CeremonyCheck, { ok: true }> | null>(null);

const walletType = computed<string | undefined>(() => loggedWallet.value?.type);
const isHardwareCardano = computed(() =>
  loggedWallet.value?.chain === Blockchain.CARDANO &&
  (walletType.value === WalletType.Ledger || walletType.value === WalletType.Trezor),
);
const stakeAddress = computed<string | undefined>(() => keys.value?.stake?.[0]?.address);

type Field = 'kid' | 'host' | 'from' | 'days' | 'key' | 'issued' | 'revoked';

const fieldErrors = computed(() => {
  const errors: Partial<Record<Field, string>> = {};
  if (kind.value === 'delegation') {
    if (kid.value && !isKeyId(kid.value)) errors.kid = t('signingCeremony.keyIdRule');
    if (!isHost(host.value)) errors.host = t('signingCeremony.hostRule');
    if (daySeconds(from.value) === undefined) errors.from = t('signingCeremony.dayRule');
    if (!Number.isInteger(days.value) || days.value < 1 || days.value > MAX_DELEGATION_DAYS) {
      errors.days = t('signingCeremony.daysRule', { max: MAX_DELEGATION_DAYS });
    }
    if (publicKeyHex.value && !/^[0-9a-fA-F]{64}$/.test(publicKeyHex.value)) errors.key = t('signingCeremony.publicKeyRule');
  } else {
    if (daySeconds(issued.value) === undefined) errors.issued = t('signingCeremony.dayRule');
    if (!splitList(revokedKids.value).every(isKeyId)) errors.revoked = t('signingCeremony.keyIdRule');
  }
  return errors;
});

/** The statement as typed, built only from fields that pass; '' while any field is missing or wrong. */
const built = computed<{ statement: string; tooLong: boolean }>(() => {
  if (Object.values(fieldErrors.value).some(Boolean)) return { statement: '', tooLong: false };
  try {
    if (kind.value === 'delegation') {
      const until = addDays(from.value, days.value);
      if (!kid.value || !publicKeyHex.value || !until) return { statement: '', tooLong: false };
      return { statement: buildDelegationStatement({ kid: kid.value, service: service.value, host: host.value, from: from.value, until, publicKeyHex: publicKeyHex.value }), tooLong: false };
    }
    const kids = splitList(revokedKids.value);
    if (kids.length === 0) return { statement: '', tooLong: false };
    return { statement: buildRevocationStatement(issued.value, kids), tooLong: false };
  } catch {
    // Every field passed its own check, so the only refusal left is the length.
    return { statement: '', tooLong: true };
  }
});
const statement = computed(() => built.value.statement);
const statementBytes = computed(() => new TextEncoder().encode(statement.value).length);
const statementError = computed(() => (built.value.tooLong ? t('signingCeremony.tooLong', { max: MAX_STATEMENT_BYTES }) : ''));

const canSign = computed(() => !loading.value && isHardwareCardano.value && !!stakeAddress.value && !!statement.value);
const entryJson = computed(() => (result.value ? JSON.stringify(result.value.entry, null, 2) : ''));

// A result belongs to the statement and wallet it was signed for.
watch([statement, () => loggedWallet.value?.id], () => {
  result.value = null;
});

async function signWithLedger(address: string, payloadHex: string): Promise<Signed> {
  const network = networks.resolveNetwork(loggedWallet.value.chain, loggedWallet.value.network);
  hardwareLoading.begin('Ledger', t('wallet.ledgerPleaseConfirmDevice') as string);
  try {
    const known = ledger.createKnownAddressesFromKeys(keys.value, network);
    const signed = await ledger.signData(address, payloadHex, network, accountIndexFromKeys(keys.value), !isBluetooth.value, known);
    return { signature: signed.signatureHex, key: signed.signingPublicKeyHex };
  } finally {
    hardwareLoading.end();
  }
}

async function signWithTrezor(address: string, payloadHex: string): Promise<Signed> {
  const data = { method: 'signData', address, payload: payloadHex };
  hardwareLoading.begin('Trezor', t('wallet.confirmOnTrezor') as string);
  try {
    const response = (featureFlagsStore.state.flags.isTrezorWebUsbEnabled
      ? await dispatchTrezor(data)
      : await Messaging.sendToBackgroundFromOptions({ method: MessageTypes.TREZOR, data })) as BackgroundResponse<SignDataResponse>;
    if (!response?.data?.success) throw new Error(response?.data?.error || t('wallet.trezorSigningFailed'));
    return { signature: response.data.signatureData.signatureHex, key: response.data.signatureData.signingPublicKeyHex };
  } finally {
    hardwareLoading.end();
  }
}

async function sign() {
  if (!canSign.value) return;
  // What is on screen now is what is approved; a later edit never receives this signature.
  const approved = statement.value;
  const address = stakeAddress.value!;
  const walletId = loggedWallet.value?.id;
  loading.value = true;
  result.value = null;
  try {
    const signer = walletType.value === WalletType.Ledger ? signWithLedger : signWithTrezor;
    const signed = await signer(address, textToHex(approved));
    if (statement.value !== approved || loggedWallet.value?.id !== walletId) return;
    const checked = await checkCeremonySignature(approved, signed.signature, signed.key);
    if ('reason' in checked) {
      snackbar.setError(checked.reason === 'no-public-key' ? t('signingCeremony.noPublicKey') : t('signingCeremony.notVerified'));
      return;
    }
    result.value = checked;
  } catch (error: unknown) {
    snackbar.setError(getErrorMessage(error, t('signingCeremony.signFailed')));
  } finally {
    loading.value = false;
  }
}
</script>
<style scoped lang="scss">
.signing-ceremony__card {
  max-width: 720px;
  margin: 0 auto;
}

.signing-ceremony__statement {
  min-height: 48px;
  padding: var(--g-s-3);
  border-radius: var(--g-r-control);
  white-space: pre-wrap;
  word-break: break-all;
}

.signing-ceremony__wrap {
  word-break: break-all;
}
</style>
