<template>
  <v-tab-item>
    <v-layout class="py-2 notify-tab" column>
      <!-- B9: no push on this build or browser -->
      <div v-if="unsupported" class="notify-unsupported text-left">
        <v-icon color="var(--g-text-3)" class="mb-2">mdi-bell-off-outline</v-icon>
        <p class="helper my-0">{{ unsupported }}</p>
      </div>

      <template v-else>
        <!-- This browser -->
        <v-row no-gutters class="py-2">
          <v-col cols="9" class="text-left">
            <button type="button" class="notify-row__label" :disabled="busy || serverDisabled" @click="browserOn = !browserOn">
              <h3 style="color: white">{{ $t('notify.browser.title') }}</h3>
              <span class="helper my-0">{{ $t('notify.browser.hint') }}</span>
            </button>
            <div class="notify-status mt-1" :class="statusClass">
              <span class="notify-status__dot" aria-hidden="true"></span>
              <span class="notify-status__text">{{ statusText }}</span>
            </div>
            <span v-if="statusHint" class="helper my-0 d-block mt-1">{{ statusHint }}</span>
            <span v-if="browserError" class="helper my-0 d-block mt-1 error--text">{{ browserError }}</span>
          </v-col>
          <v-col cols="3" style="display: flex;">
            <ToggleSwitch :key="browserSwitchKey" text-left="OFF" text-right="ON" font-size="10px" v-model="browserOn" :disabled="busy || serverDisabled" style="margin: auto" />
          </v-col>
        </v-row>

        <div class="notify-divider" role="separator"></div>

        <!-- This wallet -->
        <v-row no-gutters class="py-2" v-if="logged">
          <v-col cols="9" class="text-left">
            <button type="button" class="notify-row__label" :disabled="walletDisabled" @click="walletOn = !walletOn">
              <h3 style="color: white">{{ $t('notify.wallet.title') }}</h3>
              <span class="helper my-0">{{ walletHint }}</span>
            </button>
            <button
              v-if="walletOn && link && link.needsProof"
              type="button"
              class="notify-reconfirm mt-1 warning--text"
              @click="openAuth"
            >{{ $t('notify.wallet.reconfirm') }}</button>
            <span v-if="walletError" class="helper my-0 d-block mt-1 error--text">{{ walletError }}</span>
          </v-col>
          <v-col cols="3" style="display: flex;">
            <ToggleSwitch text-left="OFF" text-right="ON" font-size="10px" v-model="walletOn" :disabled="walletDisabled" style="margin: auto" />
          </v-col>
        </v-row>

        <template v-if="logged && walletOn && link">
          <!-- Alert categories (synced) -->
          <div class="text-left pt-2">
            <h3 style="color: white">{{ $t('notify.categories.title') }}</h3>
            <span class="helper my-0">{{ $t('notify.categories.synced') }}</span>
          </div>
          <v-row v-for="cat in categories" :key="cat.id" no-gutters class="py-1">
            <v-col cols="9" class="text-left">
              <button type="button" class="notify-row__label" :disabled="busy" @click="setCategory(cat.id, categoriesOff.includes(cat.id))">
                <span class="notify-row-title">{{ cat.label }}</span>
                <span v-if="!cat.servedHere" class="helper my-0 d-block">{{ $t('notify.categories.notHere') }}</span>
              </button>
            </v-col>
            <v-col cols="3" style="display: flex;">
              <ToggleSwitch text-left="OFF" text-right="ON" font-size="10px" :value="!categoriesOff.includes(cat.id)" :disabled="busy" @input="(on) => setCategory(cat.id, on)" style="margin: auto" />
            </v-col>
          </v-row>
          <div class="text-left py-2">
            <span class="notify-row-title">{{ $t('notify.security.title') }}</span>
            <span class="helper my-0 d-block">{{ $t('notify.security.hint') }}</span>
          </div>

          <div class="notify-divider" role="separator"></div>

          <!-- Amounts (synced) -->
          <v-row no-gutters class="py-2">
            <v-col cols="9" class="text-left">
              <button type="button" class="notify-row__label" :disabled="busy" @click="setShowAmounts(!synced.showAmounts)">
                <h3 style="color: white">{{ $t('notify.showAmounts.title') }}</h3>
                <span class="helper my-0">{{ $t('notify.showAmounts.hint') }}</span>
              </button>
            </v-col>
            <v-col cols="3" style="display: flex;">
              <ToggleSwitch text-left="OFF" text-right="ON" font-size="10px" :value="synced.showAmounts" :disabled="busy" @input="setShowAmounts" style="margin: auto" />
            </v-col>
          </v-row>
          <v-row no-gutters class="py-2">
            <v-col cols="9" class="text-left">
              <h3 style="color: white">{{ $t('notify.minAmount.title') }}</h3>
              <span class="helper my-0">{{ $t('notify.minAmount.hint') }}</span>
            </v-col>
            <v-col cols="3" style="display: flex;">
              <v-text-field
                v-model="minAda"
                type="number"
                min="0"
                step="1"
                dense
                outlined
                hide-details
                suffix="ADA"
                class="notify-min-amount"
                :aria-label="$t('notify.minAmount.title')"
                :disabled="busy"
                @blur="commitMinAmount"
                @keyup.enter="commitMinAmount"
              />
            </v-col>
          </v-row>

          <div class="notify-divider" role="separator"></div>

          <!-- Mute (this browser only) -->
          <v-row no-gutters class="py-2">
            <v-col cols="9" class="text-left">
              <button type="button" class="notify-row__label" :disabled="busy" @click="setMuted(!muted)">
                <h3 style="color: white">{{ $t('notify.mute.title') }}</h3>
                <span class="helper my-0">{{ $t('notify.mute.hint') }}</span>
              </button>
            </v-col>
            <v-col cols="3" style="display: flex;">
              <ToggleSwitch text-left="OFF" text-right="ON" font-size="10px" :value="muted" :disabled="busy" @input="setMuted" style="margin: auto" />
            </v-col>
          </v-row>
        </template>

        <!-- Other wallets -->
        <template v-if="others.length">
          <div class="notify-divider" role="separator"></div>
          <div class="text-left pt-2">
            <h3 style="color: white">{{ $t('notify.others.title') }}</h3>
          </div>
          <v-row v-for="w in others" :key="w.id" no-gutters class="py-1">
            <v-col cols="8" class="text-left">
              <span class="notify-row-title">{{ w.name }}</span>
            </v-col>
            <v-col cols="4" class="text-right">
              <span class="helper my-0" :class="{ 'warning--text': w.needsProof }">{{ w.status }}</span>
            </v-col>
          </v-row>
        </template>
      </template>
    </v-layout>

    <!-- Wallet proof under spending auth (the same step remote signing uses) -->
    <BaseDialog
      :isOpen="authOpen"
      @close="cancelAuth"
      icon="mdi-bell-check-outline"
      :title="$t('notify.wallet.authTitle')"
      :subtitle="$t('notify.wallet.authBody')"
      size="sm"
      :min-height="0"
      :loading="authBusy"
    >
      <v-card-text class="px-0 pt-2 pb-0">
        <PassKeyAuthButton v-if="isPrfWallet" :disabled="authBusy" @success="onPasskeySuccess" @error="onPasskeyError" />
        <v-text-field
          v-else
          v-model="authPassword"
          type="password"
          outlined
          dense
          autofocus
          hide-details
          :label="$t('wallet.spendingPassword')"
          :disabled="authBusy"
          @keyup.enter="confirmWithPassword"
        />
        <div v-if="authError" class="helper mt-2 error--text">{{ authError }}</div>
      </v-card-text>
      <v-card-actions v-if="!isPrfWallet" class="px-0 pt-4 pb-0">
        <GButton tier="primary" block :loading="authBusy" :disabled="!authPassword" @click="confirmWithPassword()">
          {{ $t('notify.wallet.authConfirm') }}
        </GButton>
      </v-card-actions>
    </BaseDialog>
  </v-tab-item>
</template>

<script setup lang="ts">
// Notifications settings tab (handover B7 + B9). The worker owns every subscription
// and API call; this tab reads notifySettingsStore and sends the NOTIFY_* messages.
// Opt-in only: the browser switch first, then each wallet, each with its own auth
// step when no wallet proof is cached yet.
import { computed, onMounted, ref, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import ToggleSwitch from '@/shared/components/ToggleSwitch.vue';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { notifySettingsStore } from '@/stores/notifySettingsStore';
import { walletStore } from '@/stores/walletStore';
import { isFirefox } from '@/env';

const { t } = useTranslation();
/** True while the dialog is open on this tab: the pane stays mounted across closes, so this is the refresh trigger. */
const props = defineProps<{ active?: boolean }>();
const store = notifySettingsStore;
const state = computed(() => store.state.state);
const busy = computed(() => store.state.loading);
const device = computed(() => state.value?.device ?? null);
const config = computed(() => state.value?.config ?? null);
const logged = computed(() => state.value?.logged ?? null);
const link = computed(() => store.loggedLink());

// ---- B9: where push cannot work at all ----
const isBeta = import.meta.env['VITE_IS_BETA'] === 'true';
const isBrave = ref(false);
const unsupported = computed(() => {
  if (isFirefox) return t('notify.unsupported.firefox');
  if (isBeta) return t('notify.unsupported.beta');
  if (state.value && !state.value.pushSupported) return t('notify.unsupported.firefox');
  return '';
});

// ---- This browser ----
/** No usable /config (not served yet, unreachable, enabled:false or no VAPID key): the feature stays dark here. */
const serverDisabled = computed(() => store.state.loaded && (!config.value || !config.value.enabled || !config.value.vapidPublicKey));
const browserOn = computed({
  get: () => !!device.value?.browserEnabled,
  set: (on: boolean) => { void turnBrowser(on); },
});
const browserSwitchKey = ref(0);
const browserError = ref('');
async function turnBrowser(on: boolean): Promise<void> {
  browserError.value = '';
  const r = await store.setBrowserEnabled(on);
  if (r === 'error') browserError.value = t('notify.saveFailed');
  // The switch keeps its own toggled look; when the worker did not follow (subscribe failed, error), snap it back.
  if (on !== !!device.value?.browserEnabled) browserSwitchKey.value++;
}
const statusText = computed(() => {
  const d = device.value;
  if (serverDisabled.value) return t('notify.status.notYet');
  if (!d || !d.browserEnabled) return d?.unavailable ? t('notify.status.unavailable') : t('notify.status.off');
  if (d.targetStatus === 'needs_attention' || d.targetStatus === 'invalid') return t('notify.status.attention');
  if (d.protocolUnsupported) return t('notify.status.attention');
  return t('notify.status.active');
});
const statusClass = computed(() => {
  const d = device.value;
  if (serverDisabled.value || !d?.browserEnabled) return 'notify-status--off';
  if (d.targetStatus === 'active' && !d.protocolUnsupported) return 'notify-status--on';
  return 'notify-status--warn';
});
const statusHint = computed(() => {
  const d = device.value;
  if (serverDisabled.value) return t('notify.status.notYetHint');
  if (d?.protocolUnsupported) return t('notify.status.protocol');
  if (d?.unavailable === 'subscribe_failed') return isBrave.value ? t('notify.status.braveHint') : t('notify.status.subscribeFailed');
  if (d?.unavailable === 'endpoint_not_allowed') return t('notify.status.endpointNotAllowed');
  if (d?.browserEnabled && (d.targetStatus === 'needs_attention' || d.targetStatus === 'invalid')) return t('notify.status.attentionHint');
  return '';
});

// ---- This wallet ----
const walletError = ref('');
const registeredCount = computed(() => Object.values(state.value?.wallets ?? {}).filter((w) => w.registeredAt !== null).length);
const walletOn = computed({
  get: () => !!link.value && link.value.registeredAt !== null,
  set: (on: boolean) => { void (on ? turnWalletOn() : turnWalletOff()); },
});
/** Turning ON needs the browser switch; turning OFF (unlinking) is always allowed, since links survive a browser-off (§4.2). */
const walletDisabled = computed(() => busy.value || !logged.value?.eligible || (!walletOn.value && !browserOn.value));
const walletHint = computed(() => {
  if (!logged.value?.eligible) return t('notify.wallet.ineligible');
  if (!browserOn.value) return t('notify.wallet.browserOff');
  if (walletOn.value && link.value?.needsProof) return t('notify.wallet.reconfirmHint');
  return t('notify.wallet.hint');
});

async function turnWalletOn(): Promise<void> {
  walletError.value = '';
  const r = await store.enableWallet();
  if (r === 'needs_auth') { openAuth(); return; }
  walletError.value = walletResultError(r);
}
async function turnWalletOff(): Promise<void> {
  if (!logged.value) return;
  walletError.value = '';
  await store.disableWallet(logged.value.walletId);
}
function walletResultError(r: string): string {
  if (r === 'ok') return '';
  if (r === 'proof_failed' || r === 'proof_invalid') return t('notify.wallet.authFailed');
  if (r === 'ineligible') return t('notify.wallet.ineligible');
  if (r === 'browser_off') return t('notify.wallet.browserOff');
  if (r === 'limit') return registeredCount.value >= (config.value?.limits.walletsPerDevice ?? Infinity) ? t('notify.wallet.limitWallets') : t('notify.wallet.limitDevices');
  if (r === 'deferred') return '';
  return t('notify.saveFailed');
}

// ---- Auth step (password or PassKey), the same shape remote signing uses ----
const authOpen = ref(false);
const authPassword = ref('');
const authBusy = ref(false);
const authError = ref('');
const isPrfWallet = computed(() => {
  const w = walletStore.loggedWallet as { encryptionMethod?: string; prfEncryptedPrivateKey?: string; webAuthnCredentialId?: string } | null;
  return w?.encryptionMethod === 'prf' || (!!w?.prfEncryptedPrivateKey && !!w?.webAuthnCredentialId);
});
function openAuth() { authError.value = ''; authPassword.value = ''; authOpen.value = true; }
function cancelAuth() { authOpen.value = false; authPassword.value = ''; authError.value = ''; authBusy.value = false; }
async function runAuth(auth: { password?: string; privateKeyBytes?: number[] }) {
  if (authBusy.value) return;
  authBusy.value = true;
  authError.value = '';
  try {
    const r = await store.enableWallet(auth);
    if (r !== 'ok') { authError.value = walletResultError(r) || t('notify.wallet.authFailed'); return; }
    cancelAuth();
  } finally { authBusy.value = false; }
}
function confirmWithPassword() { if (authPassword.value) void runAuth({ password: authPassword.value }); }
function onPasskeySuccess(bytes: Uint8Array) { void runAuth({ privateKeyBytes: Array.from(bytes) }); }
function onPasskeyError(e: Error) { authError.value = e?.message || t('notify.wallet.authFailed'); }

// ---- Preferences (synced sections are written whole, §4.8) ----
const synced = computed(() => link.value?.prefs?.synced ?? { categoriesOff: [], showAmounts: false, minReceiveLovelace: 1_000_000, updatedAt: null });
const categoriesOff = computed(() => synced.value.categoriesOff);
const CATEGORY_LABEL: Record<string, string> = { funds: 'notify.category.funds', staking: 'notify.category.staking', swap: 'notify.category.swap', adam: 'notify.category.adam', governance: 'notify.category.governance' };
/** Open question 6: show a category served on ANY transport for the wallet's network; hide one served nowhere. */
const categories = computed(() => {
  const c = config.value;
  const net = logged.value?.network;
  if (!c || !net) return [];
  const servedHere = new Set(link.value?.servedCategories ?? c.servedCategories['webpush']?.[net] ?? []);
  const servedAnywhere = new Set(Object.values(c.servedCategories).flatMap((byNet) => byNet[net] ?? []));
  return c.categories
    .filter((id) => !c.securityCategories.includes(id) && servedAnywhere.has(id))
    .map((id) => ({ id, label: CATEGORY_LABEL[id] ? t(CATEGORY_LABEL[id]) : id, servedHere: servedHere.has(id) }));
});
async function writeSynced(patch: Partial<{ categoriesOff: string[]; showAmounts: boolean; minReceiveLovelace: number }>) {
  // One write per change: Vuetify fires keyup/change twice on some paths, and the second call would still see the old state.
  if (!logged.value || busy.value) return;
  const { categoriesOff: off, showAmounts, minReceiveLovelace } = synced.value;
  const ok = await store.setPrefs(logged.value.walletId, { synced: { categoriesOff: off, showAmounts, minReceiveLovelace, ...patch } });
  walletError.value = ok ? '' : t('notify.saveFailed');
}
function setCategory(id: string, on: boolean) {
  const off = categoriesOff.value.filter((c) => c !== id);
  void writeSynced({ categoriesOff: on ? off : [...off, id] });
}
function setShowAmounts(on: boolean) { void writeSynced({ showAmounts: on }); }
const minAda = ref('1');
watch(() => synced.value.minReceiveLovelace, (lovelace) => { minAda.value = String(lovelace / 1_000_000); }, { immediate: true });
function commitMinAmount() {
  const ada = Number(minAda.value);
  if (!Number.isFinite(ada) || ada < 0) { minAda.value = String(synced.value.minReceiveLovelace / 1_000_000); return; }
  const lovelace = Math.min(1e12, Math.round(ada * 1_000_000));
  if (lovelace !== synced.value.minReceiveLovelace) void writeSynced({ minReceiveLovelace: lovelace });
}
const muted = computed(() => !!link.value?.prefs?.device.muted);
async function setMuted(on: boolean) {
  if (!logged.value || busy.value) return;
  const ok = await store.setPrefs(logged.value.walletId, { device: { muted: on } });
  walletError.value = ok ? '' : t('notify.saveFailed');
}

// ---- Other wallets ----
const others = computed(() => (state.value?.installed ?? [])
  .filter((w) => w.id !== logged.value?.walletId)
  .map((w) => {
    const l = state.value?.wallets[String(w.id)];
    const on = !!l && l.registeredAt !== null;
    const needsProof = !!l?.needsProof;
    const status = on ? (needsProof ? t('notify.wallet.reconfirm') : t('notify.status.active')) : w.eligible ? t('notify.others.open') : t('notify.others.ineligible');
    return { id: w.id, name: w.name, status, needsProof };
  }));

onMounted(async () => {
  const nav = navigator as Navigator & { brave?: { isBrave?: () => Promise<boolean> } };
  try { isBrave.value = !!(await nav.brave?.isBrave?.()); } catch { isBrave.value = false; }
});
// Every opening of the tab re-reads the worker (and, through it, /config and this wallet's server prefs).
let retries = 0;
async function refreshWhenActive(): Promise<void> {
  await store.refresh(true);
  // Right after an extension reload the worker answers before its wallets are hydrated: ask again.
  const s = store.state.state;
  const pageHasWallet = !!walletStore.loggedWallet;
  if (props.active && (!s || (pageHasWallet && !s.logged) || store.state.error) && retries < 4) {
    retries++;
    setTimeout(() => { if (props.active) void refreshWhenActive(); }, 1500 * retries);
  } else if (s?.logged) retries = 0;
}
watch(() => props.active, (active) => { if (active) void refreshWhenActive(); }, { immediate: true });
</script>

<style scoped lang="scss">
.notify-tab { gap: 2px; }
.notify-divider { border-top: 1px solid var(--g-hairline-1); margin: 6px 0; }
.notify-row-title { font-size: 14px; color: var(--g-text-1); }
.notify-row__label {
  display: block;
  width: 100%;
  padding: 0;
  text-align: left;
  background: none;
  border: 0;
  color: inherit;
  font: inherit;
  cursor: pointer;
  &:disabled { cursor: default; }
}
.notify-unsupported { padding: 16px 0; }
.notify-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--g-text-2);
}
.notify-status__dot {
  width: 8px;
  height: 8px;
  border-radius: var(--g-r-pill);
  background: var(--g-text-3);
}
.notify-status--on .notify-status__dot { background: var(--g-success); }
.notify-status--warn .notify-status__dot { background: var(--g-warning); }
.notify-reconfirm {
  display: block;
  padding: 0;
  font-size: 12px;
  text-decoration: underline;
  background: none;
  border: 0;
  cursor: pointer;
}
.notify-min-amount { margin: auto; max-width: 120px; }
</style>
