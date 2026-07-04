<template>
  <div class="gero-swap-embed" :class="context ? `gero-swap-embed--${context}` : null">
    <!-- ═══════ MAINTENANCE OVERLAY (feature-flag gate, mirrors SwapSheet.vue) ═══════ -->
    <div v-if="!isSwapEnabled" class="gero-swap-embed__maintenance">
      <v-icon size="56" color="warning">mdi-alert-circle-outline</v-icon>
      <div class="text-h6 mt-3">{{ $t('miniGero.swapMaintenance') }}</div>
    </div>

    <!-- ═══════ NETWORK GUARD: never mount the widget with network=undefined (e.g. Bitcoin,
         Apex, preview wallets — toNexusNetwork only resolves mainnet/preprod) ═══════ -->
    <div v-else-if="!network" class="gero-swap-embed__maintenance">
      <v-alert type="info" color="primary" text border="left" dense class="ma-0">
        {{ $t('miniGero.swapNetworkNotSupported') }}
      </v-alert>
    </div>

    <template v-else>
      <gero-swap
        ref="geroSwapEl"
        mode="native"
        :network="network"
        :base-url="baseUrl"
        :token-in="tokenIn"
        :token-out="tokenOut"
      />

      <!-- Keystone QR sign dialog — the SAME component + wiring SwapSheet.vue uses
           (SwapSheet.vue:463-469), driven here by the signer's own keystone refs. -->
      <KeystoneSignDialog
        v-if="keystone.keystoneShow.value"
        :isOpen="keystone.keystoneShow.value"
        :keystoneType="keystone.keystoneType.value"
        :keystoneCbor="keystone.keystoneCbor.value"
        @scan="keystone.onKeystoneScan"
        @error="keystone.failKeystone"
        @close="keystone.cancelKeystone"
      />

      <!-- PRF/PassKey host prompt — bridges PassKeyAuthButton's @success (the same
           component + flow SwapSheet.vue uses at SwapSheet.vue:229-235) into the
           signer's getPrfBytes() promise. -->
      <BaseDialog
        v-if="prfPromptVisible"
        :isOpen="prfPromptVisible"
        :width="380"
        :min-height="0"
        persistent
        :title="$t('security.authenticateWithPassKey')"
        :subtitle="$t('miniGero.prfAuthPrompt')"
        @close="onPassKeyCancel"
      >
        <v-card-text class="pt-4">
          <PassKeyAuthButton @success="onPassKeySuccess" @error="onPassKeyErrorHandler" />
        </v-card-text>
      </BaseDialog>

      <!-- Spending-password host prompt — no reusable "enter spending password" dialog
           exists; SwapSheet.vue collects it inline via a v-text-field in its own review
           step (SwapSheet.vue:200-221). We recreate that same input inside BaseDialog
           (the shared modal shell every other host prompt here uses) rather than
           inventing new input/validation logic. Backs the signer's getPassword(). -->
      <BaseDialog
        v-if="pwPromptVisible"
        :isOpen="pwPromptVisible"
        :width="380"
        :min-height="0"
        persistent
        :title="$t('wallet.spendingPassword')"
        @close="onPasswordCancel"
      >
        <v-card-text class="pt-4">
          <v-text-field
            v-model="pwValue"
            type="password"
            outlined
            dense
            hide-details
            autofocus
            :placeholder="$t('wallet.enterPassword')"
            @keydown.enter="onPasswordConfirm"
          />
          <div class="d-flex align-center mt-4" style="gap: 8px">
            <v-btn text @click="onPasswordCancel">{{ $t('common.cancel') }}</v-btn>
            <v-spacer />
            <v-btn color="primary" :disabled="!pwValue" @click="onPasswordConfirm">
              {{ $t('common.confirm') }}
            </v-btn>
          </div>
        </v-card-text>
      </BaseDialog>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useNativeSwapSigner } from '../composables/useNativeSwapSigner';
import { useSwapTokenResolver, buildHeldBalanceMap } from '../composables/useSwapTokenResolver';
import { resolveAsset } from '@/shared/utils/resolver';
import TokenMetadataStore from '@/stores/tokenMetadataStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { walletStore } from '@/stores/walletStore';
import { toNexusNetwork } from '@/api/nexus-tx-api';
import PassKeyAuthButton from '@/shared/components/PassKeyAuthButton.vue';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import snackbar from '@/plugins/snackbar';
import i18n from '@/plugins/i18n';

interface Props {
  tokenIn?: string;
  tokenOut?: string;
  context?: 'page' | 'dialog' | 'sidepanel';
}
const props = defineProps<Props>();

const emit = defineEmits<{
  (e: 'swap-submitted', detail: unknown): void;
  (e: 'swap-error', detail: unknown): void;
  (e: 'token-change', detail: unknown): void;
}>();

const geroSwapEl = ref<HTMLElement | null>(null);

const isSwapEnabled = computed(() => featureFlagsStore.isSwapEnabled());

// gero-backend's Nexus proxy — same base URL every other Nexus-facing client in this
// codebase uses (nexus-tx-api.ts, nexus-swap.api.ts).
const baseUrl = (import.meta.env['VITE_NEXUS_URL'] as string | undefined) || undefined;

// Nexus's aggregator endpoints expect the chain-prefixed slug ('cardano-mainnet' /
// 'cardano-preprod'), same as nexus-tx-api.ts's other endpoints — see toNexusNetwork's
// doc comment there. Reused (not duplicated) for consistency.
const network = computed(() => toNexusNetwork(walletStore.loggedWallet?.network));

// ── Spending-password host prompt (Normal wallet path) ──
const pwPromptVisible = ref(false);
const pwValue = ref('');
let pwResolve: ((v: string) => void) | null = null;
let pwReject: ((e: Error) => void) | null = null;

async function getPassword(): Promise<string> {
  pwValue.value = '';
  pwPromptVisible.value = true;
  return new Promise<string>((resolve, reject) => {
    pwResolve = resolve;
    pwReject = reject;
  });
}

function onPasswordConfirm() {
  if (!pwValue.value) return;
  const value = pwValue.value;
  pwPromptVisible.value = false;
  pwValue.value = '';
  pwResolve?.(value);
  pwResolve = null;
  pwReject = null;
}

function onPasswordCancel() {
  pwPromptVisible.value = false;
  pwValue.value = '';
  pwReject?.(new Error('Spending password entry cancelled'));
  pwResolve = null;
  pwReject = null;
}

// ── PRF/PassKey host prompt ──
// Backs getPrfBytes() with the SAME PassKeyAuthButton component + @success flow
// SwapSheet.vue uses for PRF wallets: the button drives its own WebAuthn/popup flow
// and emits the raw PRF-decrypted private key bytes on success.
const prfPromptVisible = ref(false);
let prfResolve: ((bytes: Uint8Array) => void) | null = null;
let prfReject: ((e: Error) => void) | null = null;

async function getPrfBytes(): Promise<Uint8Array> {
  prfPromptVisible.value = true;
  return new Promise<Uint8Array>((resolve, reject) => {
    prfResolve = resolve;
    prfReject = reject;
  });
}

function onPassKeySuccess(privateKeyBytes: Uint8Array) {
  prfPromptVisible.value = false;
  prfResolve?.(privateKeyBytes);
  prfResolve = null;
  prfReject = null;
}

function onPassKeyErrorHandler(error: Error) {
  prfPromptVisible.value = false;
  prfReject?.(error);
  prfResolve = null;
  prfReject = null;
}

function onPassKeyCancel() {
  prfPromptVisible.value = false;
  prfReject?.(new Error('PassKey authentication cancelled'));
  prfResolve = null;
  prfReject = null;
}

const { signer, keystone } = useNativeSwapSigner({
  getPassword,
  getPrfBytes,
  // Wire the wallet's actual Bluetooth-Ledger support so BT users aren't forced onto
  // USB (see useTransactionSigning.ts's isBTSupported for the same field usage).
  getIsBT: () => walletStore.loggedWallet?.btSupported ?? false,
});
const { resolveToken } = useSwapTokenResolver();

// ── MAX button: no host wiring needed ──
// Investigated src/vendor/gero-swap/gero-swap.js: the widget's internal
// TokenSelector emits a local `setMax` event that the top-level widget
// component already handles itself (never dispatched as a CustomEvent on the
// <gero-swap> host element, so there's nothing for GeroSwapEmbed.vue to
// listen for). Its handler reads `token.balance` directly off the resolved
// TokenMeta we now supply, subtracts a fixed 3,000,000-lovelace (3 ADA)
// reserve when the From side is lovelace, and writes the result straight into
// the amount field. So supplying `balance` via resolveToken()/buildTokenCatalog()
// above is the ONLY host-side requirement — MAX is fully functional end-to-end
// with no further wiring here.

/**
 * Shape of an entry in `tokenMetadataStore.state.tokens` (see
 * `useSwapTokenResolver.ts`'s `StoredTokenMeta` for the source-of-truth
 * definition — duplicated minimally here since that type isn't exported).
 */
interface StoredCatalogToken {
  unit: string;
  name?: string;
  ticker?: string;
  decimals?: number | string;
  verified?: boolean;
  price?: number;
}

/**
 * Builds the widget's optional token-search catalog (`node.tokens`), enriching
 * each swap-tradable entry with `img` (from `resolveAsset`'s local-cache
 * lookup — same sourcing as `useSwapTokenResolver.ts`'s `resolveToken`) and
 * `balance` (base-units string, from a single held-balance lookup built once
 * via `buildHeldBalanceMap()` rather than re-derived per token). Also ensures
 * ADA/lovelace appears as a catalog entry — it's swap's native currency but
 * isn't part of DexHunter's tradable-token registry.
 */
function buildTokenCatalog(): Record<string, unknown>[] {
  const heldBalances = buildHeldBalanceMap();
  const stored = Object.values(TokenMetadataStore.state.tokens || {}) as StoredCatalogToken[];

  const catalog = stored.map(token => ({
    ...token,
    img: resolveAsset({ unit: token.unit } as never)?.img ?? null,
    balance: heldBalances.get(token.unit),
  }));

  if (!catalog.some(token => token.unit === 'lovelace')) {
    catalog.push({
      unit: 'lovelace',
      decimals: 6,
      ticker: 'ADA',
      verified: true,
      // Widget seeds ADA's own icon — deliberately no img here (see
      // useSwapTokenResolver.ts's lovelace/img contract).
      balance: heldBalances.get('lovelace'),
    });
  }

  return catalog;
}

function wireProps() {
  const node = geroSwapEl.value as (HTMLElement & Record<string, unknown>) | null;
  if (!node) return;
  node.signer = signer;
  node.resolveToken = resolveToken;
  node.tokens = buildTokenCatalog(); // optional catalog
}

function onSwapSubmitted(e: Event) {
  emit('swap-submitted', (e as CustomEvent).detail);
}

// Widget error codes observed in src/vendor/gero-swap/gero-swap.js — mapped to existing
// i18n keys where one already fits, so all 5 mount sites get a friendly, translated
// message even though only SwapDialog.vue listens for @swap-error itself.
const SWAP_ERROR_CODE_TO_I18N_KEY: Record<string, string> = {
  NO_ROUTE: 'swap.poolNotFound',
  UNKNOWN_TOKEN_DECIMALS: 'swap.unknownTokenDecimals',
  UNKNOWN: 'errors.unknownError',
};

function onSwapError(e: Event) {
  const detail = (e as CustomEvent).detail as { code?: string; message?: string } | undefined;
  emit('swap-error', detail);

  const key = detail?.code ? SWAP_ERROR_CODE_TO_I18N_KEY[detail.code] : undefined;
  const text = key ? (i18n.t(key) as string) : detail?.message || (i18n.t('errors.unknownError') as string);
  snackbar.setError(text);
}
function onTokenChange(e: Event) {
  emit('token-change', (e as CustomEvent).detail);
}

function attach() {
  const node = geroSwapEl.value;
  if (!node) return;
  wireProps();
  node.addEventListener('swap-submitted', onSwapSubmitted);
  node.addEventListener('swap-error', onSwapError);
  node.addEventListener('token-change', onTokenChange);
}

function detach() {
  const node = geroSwapEl.value;
  if (!node) return;
  node.removeEventListener('swap-submitted', onSwapSubmitted);
  node.removeEventListener('swap-error', onSwapError);
  node.removeEventListener('token-change', onTokenChange);
}

onMounted(attach);
onBeforeUnmount(detach);

// Re-seed the pair when the host changes tokenIn/tokenOut props (attributes update
// automatically via the template binding; properties need an explicit re-wire).
watch(() => [props.tokenIn, props.tokenOut], wireProps);

// Token catalog hydrates asynchronously post-login (see useSwapTokenResolver.ts) —
// re-wire once it lands.
watch(() => TokenMetadataStore.state.tokens, wireProps);

// isSwapEnabled can flip the maintenance overlay in/out while mounted, which
// destroys/recreates the <gero-swap> element (v-if/v-else) — re-attach on re-entry.
watch(isSwapEnabled, async (enabled) => {
  if (!enabled) return;
  await nextTick();
  attach();
});

// network can flip from unsupported (undefined) to supported while mounted (e.g. the
// user switches wallets) — the network-guard branch also destroys/recreates
// <gero-swap>, so re-attach the same way.
watch(network, async (value) => {
  if (!value) return;
  await nextTick();
  attach();
});
</script>

<style scoped>
.gero-swap-embed {
  width: 100%;
  height: 100%;
}

.gero-swap-embed__maintenance {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  text-align: center;
}
</style>
