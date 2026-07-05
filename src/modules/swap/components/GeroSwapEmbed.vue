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
        :token-out="resolvedTokenOut"
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
import TokenMetadataStore from '@/stores/tokenMetadataStore';
import { getTokenByUnit, marketTokensRef } from '@/modules/market/composables/useMarketData';
import { resolveAsset, resolvePaymentKeyHash } from '@/shared/utils/resolver';
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

// ── Default Buying token = GERO (only when the host didn't configure one) ──
// Resolved lazily from TokenMetadataStore once the swap-tradable registry has hydrated
// (it's `{}` right after login/reload — see useSwapTokenResolver.ts's hydration-race
// doc comment). Left unset (widget shows 'Select') until then.
const defaultGeroTokenOut = ref<string | undefined>(undefined);
// Set true the first time the user interacts with either token selector inside the
// widget (see onTokenChange below), so a later GERO resolution / catalog rebuild never
// stomps the user's own choice with the default.
const userPickedTokenOut = ref(false);

// Explicit host config (props.tokenOut) always wins; otherwise fall back to the
// resolved GERO default (undefined/'' until resolved or once the user has picked).
const resolvedTokenOut = computed(() => {
  if (props.tokenOut !== undefined) return props.tokenOut;
  if (userPickedTokenOut.value) return undefined;
  return defaultGeroTokenOut.value;
});

function resolveGeroUnit(): string | undefined {
  const stored = Object.values(TokenMetadataStore.state.tokens || {}) as StoredCatalogToken[];
  return stored.find(t => (t.ticker ?? '').toUpperCase() === 'GERO')?.unit;
}

function tryResolveDefaultGeroTokenOut() {
  if (props.tokenOut !== undefined || userPickedTokenOut.value || defaultGeroTokenOut.value) return;
  const unit = resolveGeroUnit();
  if (unit) defaultGeroTokenOut.value = unit;
}

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

// PASSIVE market-cache access: `getTokenByUnit` (token logos) and `marketTokensRef`
// (the reactive cache, to re-run buildTokenCatalog() once data arrives) are imported
// as module-level readers — we deliberately do NOT call useMarketData() here, so the
// swap never registers a poll consumer or starts the 15s price interval. It reads
// whatever the shared cache already holds (populated by the dashboard/market page)
// and reacts when that updates. Icons stay empty only if nothing else ever polled.
const allTokens = marketTokensRef;

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
 * Shape of a `node.tokens` catalog entry. `img` is deliberately optional/nullable
 * (not a required `string`): the lovelace/ADA entry omits it on purpose (see
 * `buildTokenCatalog()` below) so the widget falls back to its own bundled ADA
 * icon instead of a transiently-empty host-supplied chain logo.
 */
interface CatalogToken extends StoredCatalogToken {
  img?: string | null;
  balance?: string;
  /** ADA-denominated price (market-data), for the dialog's ADA price sub-line. */
  priceAda?: number;
  /** 24h price change %, drives the dialog's coloured ChangeBadge. */
  change24h?: number;
  /** Market cap (market-data), used to rank the picker's non-ADA/non-held tokens. */
  mcap?: number | null;
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
// DexHunter's swap-tradable registry (TokenMetadataStore) represents native ADA with
// its own entry — seen with an empty/`'ada'` unit and/or ticker 'ADA' — distinct from
// the `'lovelace'` unit this app uses everywhere else. Every such entry must be
// filtered out before the catalog is built so exactly ONE ADA/lovelace row survives
// (see buildTokenCatalog() below); otherwise the token list shows two ADA rows: the
// registry's own (no wallet balance attached) and the one this code adds (which does
// carry the real held balance).
function isAdaLike(token: { unit: string; ticker?: string }): boolean {
  return token.unit === 'lovelace' || token.unit === '' || token.unit === 'ada' ||
    (token.ticker ?? '').toUpperCase() === 'ADA';
}

function buildTokenCatalog(): CatalogToken[] {
  const heldBalances = buildHeldBalanceMap();
  const stored = Object.values(TokenMetadataStore.state.tokens || {}) as StoredCatalogToken[];

  // Token logos come from market-data (market.gerowallet.io via Nexus) — the
  // app's single source of truth. Use getTokenByUnit(unit)?.img (market logo
  // only, no chainLogo fallback) so an unlisted token shows a letter avatar
  // rather than the ADA logo. `unit` here is the same key `TokenMetadataStore`
  // is keyed by (DexHunter's token_id) and the same string useSwapTokenResolver.ts's
  // resolveToken() already passes to this same getTokenByUnit() — i.e. the plain
  // Cardano "unit" (policyId + assetNameHex, no separator) used consistently
  // everywhere in this codebase, so no key-format normalization is needed here.
  const catalog: CatalogToken[] = stored
    .filter(token => !isAdaLike(token))
    .map(token => {
      // Enrich each entry from market-data (single lookup). Price/priceAda/change
      // drive the dialog's price + 24h-change columns (the DexHunter store's own
      // `price` is often 0/stale, so prefer the market value). Logo falls back to
      // the on-chain asset cache (resolveAsset — a synchronous local lookup) when
      // market-data has no image, so more tokens show a real icon.
      const mkt = getTokenByUnit(token.unit);
      return {
        ...token,
        img: mkt?.img || resolveAsset({ unit: token.unit } as never)?.img || null,
        price: mkt?.price ?? token.price,
        priceAda: mkt?.priceAda,
        change24h: mkt?.change24h,
        mcap: mkt?.mcap ?? null,
        balance: heldBalances.get(token.unit),
      };
    });

  // Single canonical ADA/lovelace entry, always added (any registry duplicate was
  // already filtered out above), carrying the actual held balance + market price/change.
  // market-data keys the native token by 'lovelace' (see useMarketData nativeToken),
  // so getTokenByUnit('lovelace') gives ADA's USD price + 24h change for the dialog.
  const adaMkt = getTokenByUnit('lovelace');
  catalog.push({
    unit: 'lovelace',
    decimals: 6,
    ticker: 'ADA',
    name: 'Cardano', // dialog name line — show "Cardano", not the raw "lovelace" unit
    verified: true,
    price: adaMkt?.price,
    priceAda: 1,
    change24h: adaMkt?.change24h,
    // Deliberately NO `img` here — the widget seeds ADA's own bundled data-URI icon
    // (self-contained, no flicker), used in both the token trigger and the dialog.
    balance: heldBalances.get('lovelace'),
  });

  return catalog;
}

// The widget's Swap History needs the owner payment-key-hash to fetch indexed DEX orders.
// We already hold the wallet's bech32 base address; derive the pkh from it (handles base +
// enterprise addresses). Returns undefined when no wallet/address (widget then shows local
// pending swaps only). resolvePaymentKeyHash throws on an unresolvable address — never let
// that break wiring.
function resolveOwnerPkh(): string | undefined {
  const addr = walletStore.loggedWallet?.baseAddress;
  if (!addr) return undefined;
  try {
    return resolvePaymentKeyHash(addr).toString();
  } catch {
    return undefined;
  }
}

function wireProps() {
  const node = geroSwapEl.value as (HTMLElement & Record<string, unknown>) | null;
  if (!node) return;
  node.signer = signer;
  node.resolveToken = resolveToken;
  node.tokens = buildTokenCatalog(); // optional catalog
  node.ownerPkh = resolveOwnerPkh(); // for in-widget swap history (indexed orders lookup)
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
  // Any token-change event only ever originates from a genuine user interaction inside
  // the widget (inbound host->prop syncing is silent — see GeroSwap.ce.vue's "no echo
  // emit" comment), so from here on the default-GERO logic above must never override
  // whatever the user has chosen.
  userPickedTokenOut.value = true;
  emit('token-change', (e as CustomEvent).detail);
}

function attach() {
  const node = geroSwapEl.value;
  if (!node) return;
  wireProps();
  tryResolveDefaultGeroTokenOut();
  node.addEventListener('swap-submitted', onSwapSubmitted);
  node.addEventListener('swap-error', onSwapError);
  node.addEventListener('token-change', onTokenChange);
}

function detach() {
  if (catalogRebuildTimer) {
    clearTimeout(catalogRebuildTimer);
    catalogRebuildTimer = null;
  }
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

// ── Reactive catalog rebuild ──
// buildTokenCatalog() reads both TokenMetadataStore.state.tokens (the swap-tradable
// registry) and useMarketData()'s allTokens (icons/prices) — both hydrate
// asynchronously AFTER this component's initial mount/wireProps() call. Without this,
// node.tokens is assigned once, before either source has data, and icons stay
// permanently undefined even after the data arrives. Re-run wireProps() (which
// rebuilds the whole catalog and reassigns node.tokens, reusing the same geroSwapEl
// ref) whenever either source changes.
//
// Debounced (not immediate) because allTokens is replaced wholesale on every 15s
// price-poll tick (see useMarketData.ts's pollPrices) — coalesce those plus any
// near-simultaneous TokenMetadataStore update into a single rebuild rather than
// rebuilding the full catalog twice in the same tick.
let catalogRebuildTimer: ReturnType<typeof setTimeout> | null = null;
const CATALOG_REBUILD_DEBOUNCE_MS = 200;

// Only the TOKEN SET (which units exist) needs a full node.tokens rebuild — a price
// tick on allTokens replaces the whole array wholesale but essentially never changes
// which units exist, so without this guard every 15s poll would still rebuild+reassign
// the entire catalog (churning every TokenSelector/SelectTokenDialog row) for nothing.
// Sorted-units string is cheap to compute and cheap to compare.
let lastCatalogUnitsKey = '';
function computeCatalogUnitsKey(): string {
  const stored = Object.values(TokenMetadataStore.state.tokens || {}) as StoredCatalogToken[];
  const units = stored.filter(token => !isAdaLike(token)).map(token => token.unit);
  units.push('lovelace');
  return units.sort().join(',');
}

function scheduleCatalogRebuild() {
  if (catalogRebuildTimer) clearTimeout(catalogRebuildTimer);
  catalogRebuildTimer = setTimeout(() => {
    catalogRebuildTimer = null;

    // Independent of whether the token SET changed below: pick up GERO as soon as
    // the registry has it (see the default-GERO block near the top of this file).
    tryResolveDefaultGeroTokenOut();

    const key = computeCatalogUnitsKey();
    if (key === lastCatalogUnitsKey) return; // token SET unchanged — skip the rebuild
    lastCatalogUnitsKey = key;
    wireProps();
  }, CATALOG_REBUILD_DEBOUNCE_MS);
}

// Token catalog hydrates asynchronously post-login (see useSwapTokenResolver.ts) —
// rebuild once it lands. `state.tokens` is always reassigned wholesale (never
// mutated in place — see tokenMetadataStore.ts's setTokens()/broadcastTokenPatch()),
// so a shallow (non-deep) watch already fires correctly on every real update.
watch(() => TokenMetadataStore.state.tokens, scheduleCatalogRebuild);

// Market-data (icons/prices) also hydrates asynchronously — same reasoning as above.
// `allTokens.value` is always reassigned wholesale in fetchAllTokens() (never mutated
// in place), so a shallow watch is sufficient and far cheaper than a deep watch over
// what can be a large array of MarketToken objects (each carrying a sparkline array).
watch(allTokens, scheduleCatalogRebuild);

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

/* Let the widget fill (and be bounded by) our height in the height-constrained
   contexts so its internal body scrolls and the swap CTA stays pinned. In 'page'
   context we leave the element at natural height (the page itself scrolls). */
.gero-swap-embed > gero-swap { display: block; }
.gero-swap-embed--dialog > gero-swap,
.gero-swap-embed--sidepanel > gero-swap { height: 100%; min-height: 0; }

.gero-swap-embed__maintenance {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 32px 16px;
  text-align: center;
}
</style>
