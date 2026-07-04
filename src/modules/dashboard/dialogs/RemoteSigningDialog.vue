<template>
  <v-dialog
    :value="isOpen"
    max-width="480"
    scrollable
    @input="(v) => { if (!v) $emit('close'); }"
  >
    <v-card class="liquid-glass remote-signing-card" rounded="lg">
      <v-card-title class="d-flex align-center px-4 pt-4 pb-2">
        <v-icon left color="#00DFF3" class="mr-2">mdi-cellphone-link</v-icon>
        <span class="rs-title">{{ $t('crossDevice.settings.title') }}</span>
        <v-spacer />
        <v-btn icon small @click="$emit('close')"><v-icon>mdi-close</v-icon></v-btn>
      </v-card-title>

      <v-card-text class="px-4 pb-4">
        <p class="rs-desc">{{ $t('crossDevice.settings.desc') }}</p>

        <!-- Master enable -->
        <div class="rs-row d-flex align-center">
          <div class="flex-grow-1">
            <div class="rs-label">{{ $t('crossDevice.settings.enable') }}</div>
            <div class="rs-hint">{{ $t('crossDevice.settings.enableHint') }}</div>
          </div>
          <v-switch
            :input-value="enabled"
            :loading="busy"
            color="#00DFF3"
            inset
            hide-details
            class="mt-0 ml-2"
            @change="onToggleEnabled"
          />
        </div>

        <template v-if="enabled">
          <v-divider class="rs-divider" />

          <!-- Signing policy -->
          <div class="rs-label mb-1">{{ $t('crossDevice.settings.policy') }}</div>
          <v-radio-group :value="policy" hide-details class="mt-0 rs-policy" @change="onPolicyChange">
            <v-radio value="ask" color="#00DFF3">
              <template #label>
                <div>
                  <div class="rs-radio-title">{{ $t('crossDevice.settings.policyAsk') }}</div>
                  <div class="rs-hint">{{ $t('crossDevice.settings.policyAskHint') }}</div>
                </div>
              </template>
            </v-radio>
            <v-radio value="require_remote" color="#00DFF3" :disabled="!hasPairedDevice">
              <template #label>
                <div>
                  <div class="rs-radio-title">{{ $t('crossDevice.settings.policyRequire') }}</div>
                  <div class="rs-hint">
                    {{ hasPairedDevice ? $t('crossDevice.settings.policyRequireHint') : $t('crossDevice.settings.needTrustedForPolicy') }}
                  </div>
                </div>
              </template>
            </v-radio>
          </v-radio-group>

          <v-divider class="rs-divider" />

          <!-- This device -->
          <div v-if="selfEntry" class="rs-label mb-2">{{ $t('crossDevice.settings.thisDevice') }}</div>
          <div v-if="selfEntry" class="rs-device rs-self d-flex align-center">
            <v-icon class="mr-3" color="#8a94a6">{{ platformIcon(selfEntry.device.platform) }}</v-icon>
            <div class="flex-grow-1">
              <div class="rs-device-label">{{ selfEntry.device.label || $t('crossDevice.settings.unnamed') }}</div>
              <div class="rs-fingerprint">{{ $t('crossDevice.settings.fingerprint') }}: {{ fingerprint(selfEntry.device.pubKey) }}</div>
            </div>
          </div>

          <!-- QR scan-to-pair: the fast path — the phone's camera does the pairing -->
          <v-btn
            v-if="!isHardwareWallet"
            block
            color="#00DFF3"
            class="black--text font-weight-bold rs-pair-btn"
            @click="openPairingQr"
          >
            <v-icon left small>mdi-qrcode-scan</v-icon>
            {{ $t('crossDevice.pair.button') }}
          </v-btn>

          <!-- Other devices -->
          <div class="rs-label mb-2 mt-3">{{ $t('crossDevice.settings.detected') }}</div>
          <p class="rs-pair-hint">{{ $t('crossDevice.settings.pairHint') }}</p>

          <div v-if="deviceList.length === 0" class="rs-empty">
            <v-icon color="#5a6472" class="mb-1">mdi-cellphone-off</v-icon>
            <div class="rs-hint">{{ $t('crossDevice.settings.noDevices') }}</div>
            <div class="rs-hint">{{ $t('crossDevice.settings.noDevicesHint') }}</div>
          </div>

          <div
            v-for="entry in deviceList"
            :key="entry.device.deviceId"
            class="rs-device d-flex align-center"
            :class="{ 'rs-trusted': entry.trusted, 'rs-offline': !entry.online }"
          >
            <v-icon class="mr-3" :color="entry.trusted ? '#00DFF3' : '#8a94a6'">
              {{ platformIcon(entry.device.platform) }}
            </v-icon>
            <div class="flex-grow-1">
              <div class="rs-device-label">
                {{ entry.device.label || $t('crossDevice.settings.unnamed') }}
                <span
                  v-if="entry.trusted"
                  class="rs-badge"
                  :class="pairVerified(entry.device.deviceId) ? 'rs-verified' : 'rs-sas'"
                >
                  <v-icon x-small :color="pairVerified(entry.device.deviceId) ? '#37d67a' : '#8a94a6'">
                    {{ pairVerified(entry.device.deviceId) ? 'mdi-shield-check' : 'mdi-shield-account-outline' }}
                  </v-icon>
                  {{ pairVerified(entry.device.deviceId) ? $t('crossDevice.settings.walletVerified') : $t('crossDevice.settings.sasOnly') }}
                </span>
                <span class="rs-status" :class="entry.online ? 'rs-online' : 'rs-off'">
                  {{ entry.online ? $t('crossDevice.settings.online') : $t('crossDevice.settings.offline') }}
                </span>
              </div>
              <div class="rs-fingerprint">{{ $t('crossDevice.settings.fingerprint') }}: {{ fingerprint(entry.device.pubKey) }}</div>
              <div v-if="entry.trusted && trustedAt(entry.device.deviceId)" class="rs-hint">
                {{ $t('crossDevice.settings.trustedOn', { date: trustedAt(entry.device.deviceId) }) }}
              </div>
            </div>
            <v-btn
              v-if="!entry.trusted"
              small
              outlined
              color="#00DFF3"
              :disabled="!entry.online"
              :loading="busy"
              @click="startPairing(entry)"
            >{{ $t('crossDevice.settings.pair') }}</v-btn>
            <v-btn
              v-else
              small
              text
              color="error"
              :loading="busy"
              @click="onUntrust(entry.device.deviceId)"
            >{{ $t('crossDevice.settings.untrust') }}</v-btn>
          </div>
        </template>

        <v-alert dense text color="#8a94a6" class="rs-note mt-4 mb-0">
          <div class="d-flex">
            <v-icon small color="#8a94a6" class="mr-2 mt-1">mdi-information-outline</v-icon>
            <span class="rs-note-text">{{ $t('crossDevice.settings.securityNote') }}</span>
          </div>
        </v-alert>
      </v-card-text>
    </v-card>

    <!-- SAS pairing confirmation: the code must be compared on both devices -->
    <v-dialog :value="!!pairingCandidate" max-width="360" @input="(v) => { if (!v) pairingCandidate = null; }">
      <v-card class="liquid-glass rs-confirm-card" rounded="lg" v-if="pairingCandidate">
        <v-card-title class="rs-title px-4 pt-4 pb-1">{{ $t('crossDevice.settings.pairConfirmTitle') }}</v-card-title>
        <v-card-text class="px-4 pb-2">
          <p class="rs-hint mb-3">
            {{ $t('crossDevice.settings.pairConfirmBody', { device: pairingCandidate.device.label || $t('crossDevice.settings.unnamed') }) }}
          </p>
          <div class="rs-confirm-code">{{ fingerprint(pairingCandidate.device.pubKey) }}</div>
        </v-card-text>
        <v-card-actions class="px-4 pb-4 pt-0">
          <v-btn text small @click="pairingCandidate = null">{{ $t('common.cancel') }}</v-btn>
          <v-spacer />
          <v-btn small color="#00DFF3" class="black--text font-weight-bold" :loading="busy" @click="confirmPairing">
            {{ $t('crossDevice.settings.pairConfirmMatch') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- QR scan-to-pair: the phone scans this code; we poll for the pinned result -->
    <v-dialog :value="qrDialogOpen" max-width="360" @input="(v) => { if (!v) closePairingQr(); }">
      <v-card class="liquid-glass rs-confirm-card" rounded="lg">
        <v-card-title class="rs-title px-4 pt-4 pb-1">
          <span>{{ qrState === 'paired' ? $t('crossDevice.pair.pairedTitle') : $t('crossDevice.pair.title') }}</span>
          <v-spacer />
          <v-btn icon small @click="closePairingQr"><v-icon>mdi-close</v-icon></v-btn>
        </v-card-title>
        <v-card-text class="px-4 pb-4 text-center">
          <!-- minting the payload -->
          <div v-if="qrState === 'loading'" class="rs-qr-loading">
            <v-progress-circular indeterminate color="#00DFF3" />
          </div>

          <!-- no cached proof: prompt to re-enable -->
          <div v-else-if="qrState === 'error'">
            <v-icon color="#ff6b6b" size="40">mdi-alert-circle-outline</v-icon>
            <p class="rs-hint mt-3">{{ $t('crossDevice.pair.noProof') }}</p>
          </div>

          <!-- waiting: show the QR + a live "waiting for your phone" state -->
          <template v-else-if="qrState === 'waiting'">
            <p class="rs-hint mb-3">{{ $t('crossDevice.pair.scanHint') }}</p>
            <div class="rs-qr-frame">
              <div ref="qrContainer" class="rs-qr"></div>
              <span class="rs-qr-scanline"></span>
            </div>
            <div class="rs-waiting mt-3">
              <v-progress-circular indeterminate size="16" width="2" color="#00DFF3" class="mr-2" />
              {{ $t('crossDevice.pair.waiting') }}
            </div>
          </template>

          <!-- paired: success morph -->
          <div v-else-if="qrState === 'paired'" class="rs-qr-success">
            <v-icon color="#37d67a" size="60">mdi-shield-check</v-icon>
            <p class="rs-paired-title mt-3">
              {{ $t('crossDevice.pair.pairedWith', { device: pairedResult && pairedResult.label ? pairedResult.label : $t('crossDevice.settings.unnamed') }) }}
            </p>
          </div>

          <!-- expired: single-use nonce timed out -->
          <div v-else-if="qrState === 'expired'">
            <v-icon color="#ffb020" size="40">mdi-clock-alert-outline</v-icon>
            <p class="rs-hint mt-3 mb-3">{{ $t('crossDevice.pair.expired') }}</p>
            <v-btn small color="#00DFF3" class="black--text font-weight-bold" @click="openPairingQr">
              {{ $t('crossDevice.pair.newCode') }}
            </v-btn>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <!-- Enable-time auth: sign the one-time wallet-control proof before turning on -->
    <v-dialog :value="enableAuthOpen" max-width="380" persistent @input="(v) => { if (!v) cancelEnableAuth(); }">
      <v-card class="liquid-glass rs-confirm-card" rounded="lg">
        <v-card-title class="rs-title px-4 pt-4 pb-1">{{ $t('crossDevice.settings.enableAuthTitle') }}</v-card-title>
        <v-card-text class="px-4 pb-2">
          <p class="rs-hint mb-3">{{ $t('crossDevice.settings.enableAuthBody') }}</p>

          <PassKeyAuthButton
            v-if="isPrfWallet"
            :disabled="enableBusy"
            @success="onEnablePasskeySuccess"
            @error="onEnablePasskeyError"
          />
          <v-text-field
            v-else
            v-model="enablePassword"
            type="password"
            outlined
            dense
            autofocus
            hide-details
            :label="$t('wallet.spendingPassword')"
            :disabled="enableBusy"
            @keyup.enter="confirmEnableWithPassword"
          />

          <div v-if="enableError" class="rs-error mt-2">{{ enableError }}</div>
        </v-card-text>
        <v-card-actions class="px-4 pb-4 pt-0">
          <v-btn text small :disabled="enableBusy" @click="cancelEnableAuth">{{ $t('common.cancel') }}</v-btn>
          <v-spacer />
          <v-btn
            v-if="!isPrfWallet"
            small
            color="#00DFF3"
            class="black--text font-weight-bold"
            :loading="enableBusy"
            :disabled="!enablePassword"
            @click="confirmEnableWithPassword"
          >{{ $t('crossDevice.settings.enableConfirm') }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue';
import QRCodeStyling from 'qr-code-styling';
import { remoteSigningStore, type CrossDeviceListEntry, type PairedResult } from '@/stores/remoteSigningStore';
import { pairingFingerprint, type SigningPolicy } from '@/services/crossDevice/crossDeviceTrust';
import { encodePairingQr, type PairingQrPayload } from '@/services/crossDevice/pairingQr';
import snackbar from '@/plugins/snackbar';
import { useTranslation } from '@/shared/composables/useTranslation';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import { walletStore } from '@/stores/walletStore';
import { WalletType } from '@/models/types';

const props = defineProps<{ isOpen: boolean }>();
// Template emits via $emit('close'); declared here for type-checking.
defineEmits<{ (e: 'close'): void }>();
const { t } = useTranslation();

const state = remoteSigningStore.state;

const busy = computed(() => state.loading);
const enabled = computed(() => state.settings.enabled);
const policy = computed(() => state.settings.policy);
// Persistent pairing gates the policy toggle (survives the phone going offline).
const hasPairedDevice = computed(() => remoteSigningStore.hasPairedDevice());

const selfEntry = computed(() => state.devices.find((e) => e.isSelf) || null);

// Merge the live registry with persisted paired devices, so a paired phone still
// appears (as "offline") when it briefly drops instead of vanishing from the list.
// Live entries win; a paired device not currently live is synthesized from
// settings so the user can still see and untrust it. Pairing is only offered for
// ONLINE untrusted devices (an offline device isn't in the registry to verify).
type DeviceRow = CrossDeviceListEntry & { online: boolean };
const deviceList = computed<DeviceRow[]>(() => {
  const live: DeviceRow[] = state.devices.filter((e) => !e.isSelf).map((e) => ({ ...e, online: true }));
  const liveIds = new Set(live.map((e) => e.device.deviceId));
  const offline: DeviceRow[] = Object.values(state.settings.trustedDevices)
    .filter((td) => !liveIds.has(td.deviceId))
    .map((td) => ({
      device: {
        deviceId: td.deviceId, pubKey: td.pubKey, label: td.label,
        platform: td.platform, hasSigningKey: true,
      } as CrossDeviceListEntry['device'],
      trusted: true,
      isSelf: false,
      online: false,
    }));
  return [...live, ...offline];
});

const fingerprint = (pubKey: string) => pairingFingerprint(pubKey);

const platformIcon = (platform: string) => {
  if (platform === 'ios') return 'mdi-apple-ios';
  if (platform === 'android') return 'mdi-android';
  if (platform === 'extension') return 'mdi-google-chrome';
  return 'mdi-devices';
};

// True if the pairing verified a wallet-control proof (vs SAS-only). Drives the
// "wallet-verified" / "SAS only" badge — the log-free readout for the interop test.
const pairVerified = (deviceId: string): boolean =>
  !!state.settings.trustedDevices[deviceId]?.verified;

const trustedAt = (deviceId: string): string => {
  const d = state.settings.trustedDevices[deviceId];
  if (!d?.trustedAt) return '';
  try {
    return new Date(d.trustedAt * 1000).toLocaleDateString();
  } catch {
    return '';
  }
};

// Wallet-type detection drives the enable-time auth: software wallets sign the
// one-time wallet-control proof (password or passkey), hardware wallets cannot
// COSE-sign in the background (v1 exclusion) so they enable without one.
const loggedWallet = computed(() => walletStore.loggedWallet as {
  type?: string; encryptionMethod?: string; prfEncryptedPrivateKey?: string; webAuthnCredentialId?: string;
} | null);
const isPrfWallet = computed(() =>
  loggedWallet.value?.encryptionMethod === 'prf'
  || (!!loggedWallet.value?.prfEncryptedPrivateKey && !!loggedWallet.value?.webAuthnCredentialId),
);
const isHardwareWallet = computed(() => {
  const type = loggedWallet.value?.type;
  return type === WalletType.Ledger || type === WalletType.Trezor || type === WalletType.Keystone;
});

const enableAuthOpen = ref(false);
const enablePassword = ref('');
const enableBusy = ref(false);
const enableError = ref('');

async function onToggleEnabled(value: boolean) {
  if (!value) {
    await remoteSigningStore.setEnabled(false);
    return;
  }
  // Turning ON. Hardware wallets enable directly (no background COSE proof in v1).
  if (isHardwareWallet.value) {
    await remoteSigningStore.setEnabled(true);
    return;
  }
  enableError.value = '';
  enablePassword.value = '';
  enableAuthOpen.value = true;
}

async function runEnableProof(auth: { password?: string; privateKeyBytes?: number[] }) {
  if (enableBusy.value) return;
  enableBusy.value = true;
  enableError.value = '';
  try {
    const res = await remoteSigningStore.produceProof(auth);
    if (!res.success) {
      enableError.value = t('crossDevice.settings.enableProofFailed');
      return;
    }
    await remoteSigningStore.setEnabled(true);
    enableAuthOpen.value = false;
    enablePassword.value = '';
  } catch (e) {
    enableError.value = (e as Error)?.message || t('crossDevice.settings.enableProofFailed');
  } finally {
    enableBusy.value = false;
  }
}

function confirmEnableWithPassword() {
  if (!enablePassword.value) return;
  void runEnableProof({ password: enablePassword.value });
}

function onEnablePasskeySuccess(bytes: Uint8Array) {
  void runEnableProof({ privateKeyBytes: Array.from(bytes) });
}

function onEnablePasskeyError(e: Error) {
  enableError.value = e?.message || t('crossDevice.settings.enableProofFailed');
}

function cancelEnableAuth() {
  enableAuthOpen.value = false;
  enablePassword.value = '';
  enableError.value = '';
  enableBusy.value = false;
}

async function onPolicyChange(value: SigningPolicy) {
  if (value === 'require_remote' && !hasPairedDevice.value) return; // guarded in UI
  await remoteSigningStore.setPolicy(value);
}

// SAS pairing: never trust straight from the list. Open a confirm step so the
// user actively asserts the pairing code matches on both devices first.
const pairingCandidate = ref<CrossDeviceListEntry | null>(null);

function startPairing(entry: CrossDeviceListEntry) {
  pairingCandidate.value = entry;
}

async function confirmPairing() {
  const entry = pairingCandidate.value;
  if (!entry) return;
  const ok = await remoteSigningStore.trust(entry.device.deviceId);
  pairingCandidate.value = null;
  if (!ok) snackbar.setError(t('crossDevice.settings.pairFailed'));
}

async function onUntrust(deviceId: string) {
  await remoteSigningStore.untrust(deviceId);
  // If untrusting removed the last paired device, drop back to "ask" so the policy is coherent.
  if (!hasPairedDevice.value && policy.value === 'require_remote') {
    await remoteSigningStore.setPolicy('ask');
  }
}

// ---- QR scan-to-pair -------------------------------------------------------
// The phone's camera does the pairing: we render a QR carrying this device's
// identity + wallet-control proof + a single-use nonce, then poll the background
// for the pinned result while the code is on screen.
type QrState = 'loading' | 'waiting' | 'paired' | 'expired' | 'error';
const qrDialogOpen = ref(false);
const qrState = ref<QrState>('loading');
const qrPayload = ref<PairingQrPayload | null>(null);
const pairedResult = ref<PairedResult | null>(null);
const qrContainer = ref<HTMLElement | null>(null);
let qrCode: QRCodeStyling | null = null;
let qrPoll: ReturnType<typeof setInterval> | null = null;
let qrAutoDismiss: ReturnType<typeof setTimeout> | null = null;

function stopQrPoll() {
  if (qrPoll) { clearInterval(qrPoll); qrPoll = null; }
}

async function renderQr(payload: PairingQrPayload) {
  await nextTick(); // wait for the waiting-state container to mount
  const el = qrContainer.value;
  if (!el) return;
  // Recreate each time: the container remounts with the dialog / "show new code".
  qrCode = new QRCodeStyling({
    width: 260,
    height: 260,
    type: 'svg',
    data: encodePairingQr(payload),
    margin: 2,
    // Level M (not Q): the payload embeds the wallet-control proof (~1-1.5 KB), so
    // trade some redundancy for capacity. No center logo, for the same reason.
    qrOptions: { typeNumber: 0, mode: 'Byte', errorCorrectionLevel: 'M' },
    backgroundOptions: { color: '#ffffff' },
    dotsOptions: { color: '#0a0c10' },
    cornersSquareOptions: { type: 'extra-rounded', color: '#0a0c10' },
    cornersDotOptions: { type: 'dot', color: '#00b6d4' },
  });
  el.innerHTML = '';
  qrCode.append(el);
}

async function tickQr() {
  const payload = qrPayload.value;
  if (!payload || qrState.value !== 'waiting') return;
  // Single-use nonce expiry (local check; the background enforces it authoritatively).
  if (Math.floor(Date.now() / 1000) >= payload.exp) {
    qrState.value = 'expired';
    stopQrPoll();
    return;
  }
  const paired = await remoteSigningStore.getPairingStatus();
  if (paired && qrState.value === 'waiting') {
    qrState.value = 'paired';
    pairedResult.value = paired;
    stopQrPoll();
    void remoteSigningStore.refreshDevices(); // the new phone appears with the verified badge
    if (qrAutoDismiss) clearTimeout(qrAutoDismiss);
    qrAutoDismiss = setTimeout(closePairingQr, 2200);
  }
}

async function openPairingQr() {
  qrState.value = 'loading';
  pairedResult.value = null;
  qrDialogOpen.value = true;
  const payload = await remoteSigningStore.getPairingQr();
  if (!payload) {
    // No cached wallet-control proof (or no stake): can't render a QR.
    qrState.value = 'error';
    return;
  }
  qrPayload.value = payload;
  qrState.value = 'waiting';
  await renderQr(payload);
  stopQrPoll();
  qrPoll = setInterval(() => { void tickQr(); }, 1000);
}

function closePairingQr() {
  qrDialogOpen.value = false;
  stopQrPoll();
  if (qrAutoDismiss) { clearTimeout(qrAutoDismiss); qrAutoDismiss = null; }
  qrPayload.value = null;
  pairedResult.value = null;
  qrCode = null;
  qrState.value = 'loading';
}

// While the dialog is open, poll the live device list. The background device
// registry populates ASYNCHRONOUSLY: a DEVICES snapshot arrives only after the
// relay round-trip, a sibling may connect after the dialog opens, and the MV3
// service worker recycles roughly every 42s (each cold start re-registers and
// re-fetches a fresh snapshot). A one-shot fetch on open therefore races the
// registry and often shows an empty list even when a phone is connected. Polling
// makes the list eventually-consistent for as long as the user is looking at it.
let devicePoll: ReturnType<typeof setInterval> | null = null;
function stopDevicePoll() {
  if (devicePoll) { clearInterval(devicePoll); devicePoll = null; }
}

// Refresh whenever the dialog opens; drop any in-flight SAS confirm + enable-auth
// on close so a stale screen can never resurface on reopen (the component stays
// mounted via :is-open, so this state would otherwise persist).
watch(
  () => props.isOpen,
  (open) => {
    if (open) {
      void remoteSigningStore.refresh();
      stopDevicePoll();
      devicePoll = setInterval(() => { void remoteSigningStore.refreshDevices(); }, 3000);
    } else {
      stopDevicePoll();
      pairingCandidate.value = null;
      cancelEnableAuth();
      closePairingQr();
    }
  },
  { immediate: true },
);

onBeforeUnmount(() => {
  stopDevicePoll();
  stopQrPoll();
  if (qrAutoDismiss) clearTimeout(qrAutoDismiss);
});
</script>

<style scoped>
.remote-signing-card {
  background: rgba(18, 20, 26, 0.92) !important;
  color: #fff;
}
.rs-title { font-size: 18px; font-weight: 600; color: #fff; }
.rs-desc { font-size: 13px; color: #b3bccb; margin-bottom: 16px; }
.rs-row { padding: 6px 0; }
.rs-label { font-size: 14px; font-weight: 600; color: #fff; }
.rs-hint { font-size: 12px; color: #8a94a6; line-height: 1.35; }
.rs-radio-title { font-size: 14px; color: #e6ebf2; }
.rs-policy :deep(.v-radio) { align-items: flex-start; margin-bottom: 10px; }
.rs-divider { margin: 14px 0; border-color: rgba(255,255,255,0.08); }
.rs-device {
  padding: 10px 12px;
  border: 1px solid rgba(255,255,255,0.08);
  border-radius: 10px;
  margin-bottom: 8px;
}
.rs-device.rs-trusted { border-color: rgba(0, 223, 243, 0.4); background: rgba(0, 223, 243, 0.05); }
.rs-device.rs-offline { opacity: 0.6; }
.rs-status { font-size: 10px; text-transform: uppercase; letter-spacing: 0.5px; margin-left: 6px; }
.rs-status.rs-online { color: #37d67a; }
.rs-status.rs-off { color: #8a94a6; }
.rs-badge { font-size: 10px; letter-spacing: 0.3px; margin-left: 6px; white-space: nowrap; }
.rs-badge.rs-verified { color: #37d67a; }
.rs-badge.rs-sas { color: #8a94a6; }
.rs-self { opacity: 0.85; }
.rs-device-label { font-size: 14px; color: #fff; }
.rs-fingerprint { font-size: 12px; color: #9aa5b5; font-family: 'Courier New', monospace; letter-spacing: 0.5px; }
.rs-pair-hint { font-size: 12px; color: #8a94a6; margin-bottom: 10px; }
.rs-empty { text-align: center; padding: 20px 8px; }
.rs-note { border: 1px solid rgba(255,255,255,0.06) !important; }
.rs-note-text { font-size: 11.5px; color: #9aa5b5; line-height: 1.4; }
.rs-confirm-card { background: rgba(18, 20, 26, 0.96) !important; color: #fff; }
.rs-error { font-size: 12px; color: #ff6b6b; line-height: 1.35; }
.rs-confirm-code {
  font-family: 'Courier New', monospace;
  font-size: 26px;
  font-weight: 700;
  letter-spacing: 3px;
  text-align: center;
  color: #00DFF3;
  padding: 12px;
  border: 1px solid rgba(0, 223, 243, 0.35);
  border-radius: 10px;
  background: rgba(0, 223, 243, 0.06);
}

/* QR scan-to-pair */
.rs-pair-btn { margin: 4px 0 14px; }
.rs-qr-loading { padding: 40px 0; }
.rs-qr-frame {
  position: relative;
  width: 260px;
  max-width: 100%;
  margin: 0 auto;
  border-radius: 14px;
  overflow: hidden;
  background: #fff;
}
.rs-qr { display: block; line-height: 0; }
.rs-qr :deep(svg) { display: block; width: 100%; height: auto; }
/* A cyan scanline sweeping the code to signal "waiting / scanning". */
.rs-qr-scanline {
  position: absolute;
  left: 6%;
  right: 6%;
  top: 0;
  height: 2px;
  background: linear-gradient(90deg, transparent, #00DFF3, transparent);
  box-shadow: 0 0 10px #00DFF3;
  animation: rs-scan 2.2s ease-in-out infinite;
}
@keyframes rs-scan {
  0% { top: 6%; opacity: 0; }
  15% { opacity: 1; }
  85% { opacity: 1; }
  100% { top: 94%; opacity: 0; }
}
.rs-waiting { font-size: 13px; color: #b3bccb; display: flex; align-items: center; justify-content: center; }
.rs-qr-success { padding: 20px 0 8px; animation: rs-pop 0.4s cubic-bezier(0.2, 1.4, 0.4, 1); }
.rs-paired-title { font-size: 16px; font-weight: 600; color: #fff; }
@keyframes rs-pop {
  0% { transform: scale(0.7); opacity: 0; }
  100% { transform: scale(1); opacity: 1; }
}
@media (prefers-reduced-motion: reduce) {
  .rs-qr-scanline, .rs-qr-success { animation: none; }
}
</style>
