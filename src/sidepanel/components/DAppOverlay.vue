<template>
  <BottomSheet
    v-if="!isApex"
    :value="isVisible"
    :persistent="true"
    :show-handle="false"
    :height="currentRequest?.method === 'enable' ? '70%' : '85%'"
    :draggable="false"
  >
    <div v-if="currentRequest" class="dapp-overlay">
      <!-- Queue indicator -->
      <div v-if="requestQueue.length > 0" class="queue-indicator mb-2">
        <span class="grey--text text-caption">
          {{ $t('miniGero.requestQueueIndicator', { current: 1, total: requestQueue.length + 1 }) }}
        </span>
      </div>

      <!-- DApp Connect -->
      <div v-if="currentRequest.method === 'enable'" class="dapp-connect">
        <!-- Favicon + domain -->
        <div class="dapp-identity mb-4">
          <div class="favicon-wrapper">
            <img
              :src="faviconUrl"
              class="favicon-img"
              @error="onFaviconError"
              v-if="!faviconFailed"
            />
            <v-icon v-else size="32" :color="primaryColor">mdi-web</v-icon>
          </div>
          <div class="dapp-domain-info">
            <h3 class="white--text text-subtitle-1 font-weight-bold mb-0">{{ $t('miniGero.connectRequest') }}</h3>
            <span class="dapp-url grey--text text-caption">{{ enableDomain }}</span>
          </div>
        </div>

        <!-- URL warning -->
        <div class="url-warning mb-3">
          <v-icon size="14" color="#FFA726" class="mr-1">mdi-alert-outline</v-icon>
          <span class="text-caption" style="color: #FFA726;">{{ $t('navigation.confirmUrlBeforeGranting') }}</span>
        </div>

        <!-- Permissions -->
        <div class="permissions-section mb-3">
          <p class="white--text text-body-2 font-weight-medium mb-2">{{ $t('navigation.allowTheSiteTo') }}</p>
          <v-checkbox
            v-model="enableConsent"
            :color="primaryColor"
            hide-details
            dark
            dense
            class="consent-checkbox mt-0"
            :label="$t('navigation.viewAddressAndBalance')"
          />
        </div>

        <!-- Security note -->
        <div class="security-note mb-4">
          <v-icon size="14" color="rgba(255,255,255,0.4)" class="mr-1 flex-shrink-0" style="margin-top: 2px;">mdi-shield-check-outline</v-icon>
          <span class="grey--text text-caption">
            {{ $t('miniGero.futureTransactionsNote') }}
          </span>
        </div>

        <div class="action-buttons">
          <v-btn outlined rounded dark @click="reject()">{{ $t('miniGero.reject') }}</v-btn>
          <v-btn class="geroButton" rounded depressed :disabled="!enableConsent" @click="approve(true)">
            {{ $t('miniGero.approve') }}
          </v-btn>
        </div>
      </div>

      <!-- Sign Transaction -->
      <div v-else-if="currentRequest.method === 'signTx'" class="dapp-sign-tx">
        <!-- Favicon + domain (same style as signData / connect) -->
        <div class="dapp-identity mb-4">
          <div class="favicon-wrapper">
            <img
              :src="faviconUrl"
              class="favicon-img"
              @error="onFaviconError"
              v-if="!faviconFailed"
            />
            <v-icon v-else size="32" color="#FFF59E">mdi-file-document-edit-outline</v-icon>
          </div>
          <div class="dapp-domain-info">
            <h3 class="white--text text-subtitle-1 font-weight-bold mb-0">{{ $t('miniGero.signTxRequest') }}</h3>
            <span class="dapp-url grey--text text-caption">{{ signDataDomain }}</span>
          </div>
        </div>

        <!-- Decoded transaction summary -->
<TransactionDetailsCard
          v-if="signTxSummary"
          :outputs="signTxSummary.outputs"
          :withdrawal="signTxSummary.withdrawal"
          :totals="signTxSummary.totals"
          :risk-badge="txRiskBadge"
          :risk-loading="txRiskLoading"
          :cbor-hex="txCborForSummary"
          class="mb-3"
        />

        <!-- Expired banner — shown once the live TTL countdown reaches 0. Sign buttons
             below all gate on `ttlDisplay.expired`, so the user is forced to reject. -->
        <div v-if="ttlDisplay.expired" class="tx-expired-banner">
          <v-icon color="#ff6464" size="20" class="mr-2">mdi-clock-alert-outline</v-icon>
          <div class="tx-expired-text">
            <div class="tx-expired-title">{{ $t('signTx.expiredTitle') }}</div>
            <div class="tx-expired-body">{{ $t('signTx.expiredBody') }}</div>
          </div>
        </div>

        <!-- Normal wallet: password input -->
        <template v-if="walletType === WalletType.Normal || walletType === WalletType.Google">
          <template v-if="!isPrfWallet">
            <v-text-field
              v-model="spendingPassword"
              :type="showPassword ? 'text' : 'password'"
              :label="$t('miniGero.spendingPassword')"
              :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
              :error-messages="signError"
              outlined dense dark
              class="password-input"
              @click:append="showPassword = !showPassword"
              @keyup.enter="signNormal"
            />
            <div class="action-buttons">
              <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
              <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="!spendingPassword || ttlDisplay.expired" @click="signNormal">
                {{ $t('miniGero.sign') }}
              </v-btn>
            </div>
          </template>

          <!-- PRF wallet: PassKey authentication -->
          <template v-else>
            <p class="grey--text text-body-2 text-center mb-2">{{ $t('miniGero.passKeyRequired') }}</p>
            <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
            <div class="action-buttons">
              <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
              <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="ttlDisplay.expired" @click="signPrf">
                {{ $t('miniGero.sign') }}
              </v-btn>
            </div>
          </template>
        </template>

        <!-- Ledger wallet -->
        <template v-else-if="walletType === WalletType.Ledger">
          <div class="hw-notice pa-3 mb-3">
            <v-icon :color="primaryColor" class="mb-2">mdi-usb</v-icon>
            <p class="white--text text-body-2 text-center">{{ $t('miniGero.connectLedger') }}</p>
          </div>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="ttlDisplay.expired" @click="signLedger">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- Trezor wallet -->
        <template v-else-if="walletType === WalletType.Trezor">
          <div class="hw-notice pa-3 mb-3">
            <v-icon :color="primaryColor" class="mb-2">mdi-usb</v-icon>
            <p class="white--text text-body-2 text-center">{{ $t('miniGero.connectTrezor') }}</p>
          </div>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="ttlDisplay.expired" @click="signTrezor">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- Keystone wallet -->
        <template v-else-if="walletType === WalletType.Keystone">
          <div class="hw-notice pa-3 mb-3">
            <v-icon :color="primaryColor" class="mb-2">mdi-qrcode-scan</v-icon>
            <p class="white--text text-body-2 text-center">{{ $t('miniGero.keystoneSign') }}</p>
          </div>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="ttlDisplay.expired" @click="signKeystone">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- Live TTL footer — pinned to the very bottom of the bottom sheet, beneath
             the action buttons. Single instance for all wallet types. Centered,
             monospaced so digits don't shift width as the countdown ticks. Hidden
             once expired (the red banner above replaces the message). -->
        <v-tooltip
          v-if="ttlDisplay.relative && !ttlDisplay.expired"
          top
          content-class="custom-tooltip"
          max-width="260"
        >
          <template v-slot:activator="{ on, attrs }">
            <div class="tx-ttl-footer" v-bind="attrs" v-on="on">
              <span>{{ $t('signTx.expiresIn') }}</span>
              <span class="tx-ttl-footer-value">{{ ttlDisplay.relative }}</span>
            </div>
          </template>
          <span>{{ $t('signTx.expiresTooltip', { slot: signTxSummary?.ttlSlot }) }}</span>
        </v-tooltip>
      </div>

      <!-- Sign Data -->
      <div v-else-if="currentRequest.method === 'signData'" class="dapp-sign-data">
        <!-- Favicon + domain (same style as connect) -->
        <div class="dapp-identity mb-4">
          <div class="favicon-wrapper">
            <img
              :src="faviconUrl"
              class="favicon-img"
              @error="onFaviconError"
              v-if="!faviconFailed"
            />
            <v-icon v-else size="32" color="#FDA29B">mdi-file-sign</v-icon>
          </div>
          <div class="dapp-domain-info">
            <h3 class="white--text text-subtitle-1 font-weight-bold mb-0">{{ $t('miniGero.signDataRequest') }}</h3>
            <span class="dapp-url grey--text text-caption">{{ signDataDomain }}</span>
          </div>
        </div>

        <!-- Message content -->
        <p class="white--text text-body-2 font-weight-medium mb-2">{{ $t('navigation.signData') }}</p>
        <div class="sign-data-message">
          <p class="white--text text-caption" style="word-break: break-all;">
            {{ signDataMessage }}
          </p>
        </div>

        <!-- Normal wallet: password input -->
        <template v-if="(walletType === WalletType.Normal || walletType === WalletType.Google) && !isPrfWallet">
          <v-text-field
            v-model="spendingPassword"
            :type="showPassword ? 'text' : 'password'"
            :label="$t('miniGero.spendingPassword')"
            :append-icon="showPassword ? 'mdi-eye' : 'mdi-eye-off'"
            :error-messages="signError"
            outlined dense dark
            class="password-input"
            @click:append="showPassword = !showPassword"
            @keyup.enter="signDataNormal"
          />
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" :disabled="!spendingPassword" @click="signDataNormal">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- PRF wallet: PassKey authentication -->
        <template v-else-if="isPrfWallet">
          <p class="grey--text text-body-2 text-center mb-2 mt-3">{{ $t('miniGero.passKeyRequired') }}</p>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" @click="signDataPrf">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- Ledger wallet -->
        <template v-else-if="walletType === WalletType.Ledger">
          <div class="hw-notice pa-3 mb-3 mt-3">
            <v-icon :color="primaryColor" class="mb-2">mdi-usb</v-icon>
            <p class="white--text text-body-2 text-center">{{ $t('miniGero.connectLedger') }}</p>
          </div>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" @click="signDataHw">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- Trezor wallet -->
        <template v-else-if="walletType === WalletType.Trezor">
          <div class="hw-notice pa-3 mb-3 mt-3">
            <v-icon :color="primaryColor" class="mb-2">mdi-usb</v-icon>
            <p class="white--text text-body-2 text-center">{{ $t('miniGero.connectTrezor') }}</p>
          </div>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" @click="signDataHw">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>

        <!-- Fallback -->
        <template v-else>
          <p v-if="signError" class="error--text text-caption text-center mb-2">{{ signError }}</p>
          <div class="action-buttons">
            <v-btn outlined rounded dark @click="rejectSign">{{ $t('miniGero.reject') }}</v-btn>
            <v-btn class="geroButton" rounded depressed :loading="signing" @click="signDataNormal">
              {{ $t('miniGero.sign') }}
            </v-btn>
          </div>
        </template>
      </div>
    </div>

    <!-- Keystone QR dialog -->
    <KeystoneSignDialog
      v-if="showKeystoneDialog"
      :visible="showKeystoneDialog"
      :type="keystoneType"
      :cbor="keystoneCbor"
      @scan="onKeystoneScan"
      @error="onKeystoneError"
      @close="showKeystoneDialog = false"
    />
  </BottomSheet>
</template>

<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { useDAppOverlay } from '../composables/useDAppOverlay';
import { useChainContext } from '../composables/useChainContext';
import BottomSheet from './BottomSheet.vue';
import TransactionDetailsCard, {
  type TxDetailsWithdrawal,
  type TxDetailsTotals,
} from '@/shared/components/TransactionDetailsCard.vue';
import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import WalletStore from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { WalletType } from '@/models/types';
import { deserializeCardanoJsSdkTx } from '@/chrome/cardanoJsSdkCbor';
import filters from '@/shared/utils/filters';
import cardanoShieldApi from '@/api/cardano-shield-api';
import { DappScore, type TxScanResponse } from '@/models/cardano-shield-types';
import ledgerUtils from '@/shared/utils/ledger';
import { createKeystoneSignRequest, KeystoneSignRequestResponse, parseSignature } from '@/shared/utils/keystone';
import { UR } from '@keystonehq/keystone-sdk';
import networks from '@/utils/networks';
import KeystoneSignDialog from '@/shared/dialogs/KeystoneSignDialog.vue';

interface BackgroundResponse<T> { data: T }
interface SignTxResponse { success: boolean; error?: string; signatures?: Array<[string, string]> }

const { isVisible, currentRequest, requestQueue, approve, reject } = useDAppOverlay();
const { isApex, themeColors } = useChainContext();
const primaryColor = computed(() => themeColors.value.primary);

const spendingPassword = ref('');
const showPassword = ref(false);
const signing = ref(false);
const signError = ref('');
const enableConsent = ref(false);
const faviconFailed = ref(false);

const enableDomain = computed(() => {
  const website = currentRequest.value?.payload?.website || '';
  try {
    return new URL(website).hostname;
  } catch {
    return website;
  }
});

// Index of the favicon source currently being tried (advanced via @error).
const faviconAttempt = ref(0);

// Ordered favicon sources, best first.
const faviconSources = computed(() => {
  const domain = enableDomain.value;
  if (!domain) return [];
  const tabFavicon = currentRequest.value?.payload?.favIconUrl;
  return [
    // Source 1: the real favicon Chrome already loaded for the dApp tab.
    ...(tabFavicon ? [tabFavicon] : []),
    // Source 2: Google favicon service by domain.
    `https://www.google.com/s2/favicons?domain=${domain}&sz=64`,
  ];
});

const faviconUrl = computed(() => faviconSources.value[faviconAttempt.value] || '');

function onFaviconError() {
  if (faviconAttempt.value < faviconSources.value.length - 1) {
    faviconAttempt.value += 1; // try next source
  } else {
    faviconFailed.value = true; // exhausted → globe fallback
  }
}

// Sign Data — domain + decoded message
const signDataDomain = computed(() => {
  const website = currentRequest.value?.payload?.website || '';
  try {
    return new URL(website).hostname;
  } catch {
    return website;
  }
});

const signDataMessage = computed(() => {
  const payload = currentRequest.value?.payload?.message || currentRequest.value?.payload?.payload;
  if (!payload) return '';
  try {
    return Buffer.from(payload, 'hex').toString('utf-8');
  } catch {
    return payload;
  }
});

// ── Sign Tx — decoded summary so users see what they're signing ──

interface SignTxAssetInfo {
  unit: string;
  label: string;             // human-readable name (ticker, asset_name, or "Unknown token")
  quantity: string;          // raw quantity as string (always integer)
  formattedQuantity: string; // decimal-adjusted quantity for display (e.g. "94.07059" for 94070590 USDM @ 6 decimals)
}

type OutputKind = 'change' | 'external';

interface SignTxOutputSummary {
  address: string;
  truncatedAddress: string;
  ada: string;
  kind: OutputKind;
  isOwn: boolean; // convenience: kind !== 'external'
  assets: SignTxAssetInfo[];
  // Compact pill label: empty if no assets, single token name if one, "+N" if many
  assetPillLabel: string;
}

interface SignTxSummary {
  outputs: SignTxOutputSummary[];
  /** Null when no withdrawals; the shared card uses this to render the row. */
  withdrawal: TxDetailsWithdrawal | null;
  totals: TxDetailsTotals;
  isInternal: boolean;
  // TTL — only the absolute slot is computed here. The live "in Xh Ym Zs" string
  // is derived in `ttlDisplay` so the expensive CBOR parse below doesn't re-run
  // every tick of the 1-second timer.
  ttlSlot: number | null;
}

// ── Live 1-second clock for the TTL countdown ──────────────────────────────
// Only ticks while a signTx request is visible — no point burning CPU when the
// overlay is idle. Re-renders `ttlDisplay` every second by mutating `nowMs`.
const nowMs = ref(Date.now());
let ttlTickHandle: ReturnType<typeof setInterval> | null = null;

function startTtlTicker() {
  if (ttlTickHandle) return;
  nowMs.value = Date.now();
  ttlTickHandle = setInterval(() => { nowMs.value = Date.now(); }, 1000);
}

function stopTtlTicker() {
  if (ttlTickHandle) {
    clearInterval(ttlTickHandle);
    ttlTickHandle = null;
  }
}

watch(
  () => isVisible.value && currentRequest.value?.method === 'signTx',
  (active) => { if (active) startTtlTicker(); else stopTtlTicker(); },
  { immediate: true }
);

onBeforeUnmount(stopTtlTicker);

// Two separate sets so we can tell residual change apart from explicit self-outputs.
const paymentAddresses = computed<Set<string>>(() => {
  const set = new Set<string>();
  const k = WalletStore.state.keys;
  if (k?.payment) for (const p of k.payment) set.add(p.address);
  return set;
});

const changeAddresses = computed<Set<string>>(() => {
  const set = new Set<string>();
  const k = WalletStore.state.keys;
  if (k?.change) for (const p of k.change) set.add(p.address);
  return set;
});

function classifyAddress(addr: string): OutputKind {
  if (changeAddresses.value.has(addr)) return 'change';
  if (paymentAddresses.value.has(addr)) return 'payment';
  return 'external';
}

function formatLovelace(lovelace: bigint): string {
  // 6 decimals, trim trailing zeros but keep at least 2
  const ada = Number(lovelace) / 1_000_000;
  const fixed = ada.toFixed(6);
  return fixed.replace(/(\.\d*[1-9])0+$/, '$1').replace(/\.0+$/, '.00');
}

/**
 * Format a positive number of seconds as a compact "Xh Ym Zs" / "Xm Ys" /
 * "Xs" string. The "in" prefix lives on the row label ("Expires in") so the
 * value cell is just the duration. Always includes seconds for h/m/s buckets
 * so the user sees the countdown ticking once per second; days bucket omits
 * seconds because the UI ticks faster than the resolution it would show.
 * Cardano post-Shelley uses 1 slot = 1 second so the same helper works for
 * slot-difference math. Negative or zero returns "expired".
 */
function formatRelativeSeconds(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'expired';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/**
 * Detect strings that look like raw hex hashes — useful for filtering out
 * "names" that are really just unresolved asset_name fields from a metadata
 * cache miss. Hex names should never reach the user.
 */
function looksLikeHex(str: string): boolean {
  if (!str || str.length < 6) return false;
  return /^[0-9a-f]+$/i.test(str);
}

/**
 * Try to decode a hex asset name into a printable UTF-8 string. Handles CIP-67
 * label prefixes (4-byte `[0x00][12-bit label][8-bit checksum][0x00]` framing
 * used by USDM and other reference-token assets) by stripping them first.
 *
 * Returns null if the result isn't a clean printable string.
 */
function decodeAssetNameHex(assetNameHex: string): string | null {
  if (!assetNameHex) return null;
  const candidates: string[] = [];

  // CIP-67 framing: first hex nibble is 0 (top nibble of byte 0) and last
  // hex nibble of the 4-byte prefix is 0 (bottom nibble of byte 3). e.g.
  // USDM ref token: `0014df10` + `5553444d`. Strip the 8-char prefix and
  // try decoding the rest.
  if (
    assetNameHex.length > 8 &&
    assetNameHex[0] === '0' &&
    assetNameHex[7] === '0'
  ) {
    candidates.push(assetNameHex.slice(8));
  }
  // Also try the raw asset name in case CIP-67 detection missed something.
  candidates.push(assetNameHex);

  for (const hex of candidates) {
    try {
      const decoded = Buffer.from(hex, 'hex').toString('utf-8');
      // Printable ASCII only — no control chars, no replacement chars
      if (decoded && /^[\x20-\x7e]+$/.test(decoded) && decoded.trim().length > 0) {
        return decoded;
      }
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

interface KnownAssetInfo {
  name: string;
  decimals: number;
}

/**
 * Build a flat unit → {name, decimals} lookup that walks both fungible tokens
 * (`walletStore.tokens`) and NFT collections (`walletStore.collections`).
 * Filters out hex-shaped "names" (cache misses) so they don't leak to the UI.
 * NFTs default to 0 decimals (they're always whole units).
 */
const assetInfoLookup = computed<Map<string, KnownAssetInfo>>(() => {
  const map = new Map<string, KnownAssetInfo>();

  // Fungible tokens — keyed by unit, with metadata.ticker / metadata.name / metadata.decimals
  const tokens = WalletStore.state.tokens as Record<string, { metadata?: { ticker?: string; name?: string; decimals?: number } }> | undefined;
  if (tokens) {
    for (const [unit, info] of Object.entries(tokens)) {
      const candidates = [info?.metadata?.ticker, info?.metadata?.name].filter(
        (n): n is string => !!n && !looksLikeHex(n)
      );
      if (candidates.length > 0) {
        const decimals = typeof info?.metadata?.decimals === 'number' ? info.metadata.decimals : 0;
        map.set(unit, { name: candidates[0], decimals });
      }
    }
  }

  // NFT collections — keyed by policy_id, with items[].unit + items[].name. NFTs have 0 decimals.
  const collections = WalletStore.state.collections as Record<string, { name?: string; items?: { unit?: string; name?: string }[] }> | undefined;
  if (collections) {
    for (const collection of Object.values(collections)) {
      const items = collection?.items || [];
      for (const item of items) {
        if (item.unit && item.name && !looksLikeHex(item.name)) {
          map.set(item.unit, { name: item.name, decimals: 0 });
        }
      }
    }
  }

  return map;
});

/**
 * Format a raw integer token quantity with decimals applied. Uses BigInt
 * arithmetic to avoid precision loss for large values. Trims trailing zeros
 * but keeps at least one digit after the decimal point for non-whole values.
 *
 * Examples:
 *   formatTokenQuantity("94070590", 6)   → "94.07059"
 *   formatTokenQuantity("1000000000", 6) → "1000"
 *   formatTokenQuantity("1", 0)          → "1"
 *   formatTokenQuantity("12345", 2)      → "123.45"
 */
function formatTokenQuantity(rawQuantity: string, decimals: number): string {
  if (!rawQuantity) return '0';
  if (decimals <= 0) return rawQuantity;
  try {
    const raw = BigInt(rawQuantity);
    const negative = raw < 0n;
    const absRaw = negative ? -raw : raw;
    const divisor = 10n ** BigInt(decimals);
    const intPart = absRaw / divisor;
    const fracPart = absRaw % divisor;
    const intStr = intPart.toString();
    if (fracPart === 0n) return negative ? `-${intStr}` : intStr;
    // Pad fractional part to full decimal width, then trim trailing zeros
    const fracStr = fracPart.toString().padStart(decimals, '0').replace(/0+$/, '');
    const result = `${intStr}.${fracStr}`;
    return negative ? `-${result}` : result;
  } catch {
    return rawQuantity;
  }
}

/**
 * Resolve a Cardano asset unit (policy + assetName hex) to both a human-readable
 * label and its decimals. Resolution order:
 *   1. Wallet token/NFT lookup (with hex-name filtering)
 *   2. CIP-67-aware UTF-8 decode of the asset name (decimals default to 0)
 *   3. Generic "Unknown token" placeholder (decimals default to 0)
 *
 * NEVER returns raw hex.
 */
function resolveAssetInfo(unit: string): KnownAssetInfo {
  const known = assetInfoLookup.value.get(unit);
  if (known) return known;

  if (unit.length > 56) {
    const policyId = unit.slice(0, 56);
    const assetNameHex = unit.slice(56);
    const decoded = decodeAssetNameHex(assetNameHex);
    if (decoded) {
      // Recovery hack for backends that double-hex-encode asset names (e.g. an old
      // bloxbean Asset(...) call without the 0x prefix). Use the decoded value as
      // the real asset name, rebuild the proper unit, and try the wallet lookup.
      if (looksLikeHex(decoded)) {
        const recoveredUnit = policyId + decoded;
        const recovered = assetInfoLookup.value.get(recoveredUnit);
        if (recovered) return recovered;
        // Still missed — try to decode one more level (CIP-67 on the recovered name)
        const innerDecoded = decodeAssetNameHex(decoded);
        if (innerDecoded && !looksLikeHex(innerDecoded)) {
          return { name: innerDecoded, decimals: 0 };
        }
      }
      return { name: decoded, decimals: 0 };
    }
  }

  return { name: 'Unknown token', decimals: 0 };
}

// Raw CBOR hex of the current sign request — used by the parser below.
const txCborForSummary = computed<string | null>(() => {
  if (currentRequest.value?.method !== 'signTx') return null;
  return (currentRequest.value.payload?.tx as string | undefined) || null;
});

const signTxSummary = computed<SignTxSummary | null>(() => {
  const txCbor = txCborForSummary.value;
  if (!txCbor) return null;

  try {
    const tx: Cardano.Tx = deserializeCardanoJsSdkTx(txCbor);
    const body = tx?.body;
    if (!body) return null;

    const rawOutputs = (body.outputs || []) as Cardano.TxOut[];
    const outputs: SignTxOutputSummary[] = rawOutputs.map((o) => {
      const addr = String(o.address);
      const kind = classifyAddress(addr);

      const assets: SignTxAssetInfo[] = [];
      const pushAsset = (unit: string, quantity: unknown) => {
        const info = resolveAssetInfo(unit);
        const rawQty = String(quantity);
        assets.push({
          unit,
          label: info.name,
          quantity: rawQty,
          formattedQuantity: formatTokenQuantity(rawQty, info.decimals),
        });
      };

      const rawAssets = o.value?.assets;
      if (rawAssets) {
        if (rawAssets instanceof Map) {
          rawAssets.forEach((quantity, unit) => pushAsset(String(unit), quantity));
        } else if (typeof rawAssets === 'object') {
          for (const [unit, quantity] of Object.entries(rawAssets as Record<string, unknown>)) {
            pushAsset(unit, quantity);
          }
        }
      }

      // Always +N regardless of count — names are surfaced via the tooltip,
      // never in the compact pill. This keeps row width predictable.
      const assetPillLabel = assets.length > 0 ? `+${assets.length}` : '';

      return {
        address: addr,
        truncatedAddress: filters.truncate(addr),
        ada: formatLovelace(BigInt(o.value?.coins ?? 0n)),
        kind,
        isOwn: kind !== 'external',
        assets,
        assetPillLabel,
      };
    });

    const feeLovelace = BigInt(body.fee ?? 0n);
    const feeAda = formatLovelace(feeLovelace);

    // Stake reward withdrawals attached to the tx — come in as fresh input
    // coin from the stake account, so they offset the "You pay" total.
    const withdrawalsRaw = (body as { withdrawals?: Array<{ quantity?: unknown; stakeAddress?: unknown }> }).withdrawals;
    const withdrawalsLovelace = Array.isArray(withdrawalsRaw)
      ? withdrawalsRaw.reduce<bigint>((acc, w) => acc + BigInt(String(w?.quantity ?? '0')), 0n)
      : 0n;
    const withdrawal: TxDetailsWithdrawal | null = withdrawalsLovelace > 0n
      ? {
          truncatedStakeAddress: filters.truncate(String(withdrawalsRaw?.[0]?.stakeAddress ?? '')),
          ada: formatLovelace(withdrawalsLovelace),
        }
      : null;

    // Sum lovelace going to external addresses (excludes change AND self-payments)
    const totalSendingLovelace = outputs.reduce<bigint>((sum, o) => {
      if (o.isOwn) return sum;
      return sum + BigInt(Math.round(parseFloat(o.ada) * 1_000_000));
    }, 0n);
    const totalSendingAda = formatLovelace(totalSendingLovelace);

    // What the user is actually paying out of pocket: ADA leaving the wallet +
    // network fee, minus any rewards pulled in via withdrawals.
    const youPayLovelace = feeLovelace + totalSendingLovelace - withdrawalsLovelace;
    const youPayAda = formatLovelace(youPayLovelace < 0n ? 0n : youPayLovelace);

    // "Internal transfer" = every output address belongs to this wallet
    const isInternal = outputs.length > 0 && outputs.every(o => o.isOwn);

    // TTL: invalidHereafter is the absolute slot at which this tx becomes
    // invalid. We only capture the absolute slot here — the live "in Xh Ym Zs"
    // string is computed in `ttlDisplay` so the timer can tick once per second
    // without re-running this CBOR parse.
    const invalidHereafter = body.validityInterval?.invalidHereafter;
    const ttlSlot = invalidHereafter !== undefined && invalidHereafter !== null
      ? Number(invalidHereafter)
      : null;

    return {
      outputs,
      withdrawal,
      totals: {
        totalSendingAda,
        feeAda,
        withdrawalAda: withdrawalsLovelace > 0n ? formatLovelace(withdrawalsLovelace) : undefined,
        youPayAda,
        isInternal,
      },
      isInternal,
      ttlSlot,
    };
  } catch (e) {
    console.error('[DAppOverlay] Failed to decode signTx CBOR:', e);
    return null;
  }
});

// Live TTL display — re-runs every 1s tick.
//
// Projection: Cardano post-Shelley uses 1 slot = 1 second, so we extrapolate
// the chain head from the last gero-sync tip update:
//   projectedCurrentSlot = tip.slot + (now - tip.time)
// This way the countdown ticks smoothly between the ~20s block updates that
// arrive via the WebSocket.
const ttlDisplay = computed<{ relative: string | null; expired: boolean }>(() => {
  const ttlSlot = signTxSummary.value?.ttlSlot;
  if (ttlSlot == null) return { relative: null, expired: false };

  const tipSlot = networkStore.tip?.slot;
  const tipTimeMs = networkStore.tip?.time;
  if (tipSlot == null || tipTimeMs == null) return { relative: null, expired: false };

  const elapsedSeconds = Math.max(0, Math.floor((nowMs.value - Number(tipTimeMs)) / 1000));
  const projectedSlot = Number(tipSlot) + elapsedSeconds;
  const secondsRemaining = ttlSlot - projectedSlot;
  return {
    relative: formatRelativeSeconds(secondsRemaining),
    expired: secondsRemaining <= 0,
  };
});

// ── Cardano Shield risk scan (matches popup SignTx.vue behavior) ──

const txRisk = ref<TxScanResponse | null>(null);
const txRiskLoading = ref(false);

/**
 * Map the API score to a badge config. The score field may come back as a numeric
 * enum (0/1/2), a string ('low'/'medium'/'high'), or 'unknown' on scan failure —
 * handle all forms defensively. Always returns SOMETHING when a scan completed,
 * including a neutral "unverified" state, so the user always sees a Cardano Shield
 * indicator in the header.
 */
const txRiskBadge = computed<{ color: string; icon: string; label: string } | null>(() => {
  if (!txRisk.value) return null;
  const score = txRisk.value.score as unknown;
  const scoreStr = String(score ?? '').toLowerCase();
  const isHigh = score === DappScore.high || scoreStr === 'high' || score === 2;
  const isMedium = score === DappScore.medium || scoreStr === 'medium' || score === 1;
  const isLow = score === DappScore.low || scoreStr === 'low' || score === 0;
  if (isHigh) return { color: '#FDA29B', icon: 'mdi-shield-alert', label: 'high' };
  if (isMedium) return { color: '#FFD54F', icon: 'mdi-shield-half-full', label: 'medium' };
  if (isLow) return { color: '#94CFA8', icon: 'mdi-shield-check', label: 'low' };
  // Scan completed but score is 'unknown' or unrecognized → show neutral state
  return { color: '#94969c', icon: 'mdi-shield-outline', label: 'unverified' };
});

// Watch the current request: when it becomes a signTx, kick off a Cardano Shield scan
watch(
  () => currentRequest.value,
  (req) => {
    txRisk.value = null;
    if (!req || req.method !== 'signTx') return;
    const txCbor = req.payload?.tx;
    if (!txCbor) return;

    // Use the first non-own recipient if any (for external txs), otherwise own address
    // (for internal/self transfers — Cardano Shield can still scan the URL/CBOR)
    const summary = signTxSummary.value;
    const toAddress = summary?.outputs.find(o => !o.isOwn)?.address
      || WalletStore.state.loggedWallet?.baseAddress
      || '';
    const fromAddress = WalletStore.state.loggedWallet?.baseAddress || '';
    const url = req.payload?.website || '';

    // Neutral fallback used when the scan times out, errors, or returns an empty body.
    // The badge maps this to the "Unverified" state instead of hiding entirely so the
    // user always sees a Cardano Shield indicator in the header.
    const unknownRisk = {
      score: 'unknown',
      addressRisk: 'unknown',
      domainRisk: 'unknown',
      receivingRisk: false,
    } as unknown as TxScanResponse;

    txRiskLoading.value = true;
    Promise.race([
      cardanoShieldApi.scanTx({ cborHex: txCbor, toAddress, fromAddress, url }),
      new Promise<TxScanResponse>((_, reject) =>
        setTimeout(() => reject(new Error('Cardano Shield scan timeout')), 8000)
      ),
    ])
      .then((res) => {
        txRisk.value = res || unknownRisk;
      })
      .catch((e) => {
        // Soft-fail: badge falls back to "unverified". Keep the warn for ops visibility.
        console.warn('[DAppOverlay] Cardano Shield scan failed:', e);
        txRisk.value = unknownRisk;
      })
      .finally(() => {
        txRiskLoading.value = false;
      });
  },
  { immediate: true }
);

// Keystone state
const showKeystoneDialog = ref(false);
const keystoneType = ref('');
const keystoneCbor = ref('');
const keystoneUseHash = ref(false);

const walletType = computed(() => WalletStore.state.loggedWallet?.type);
const isPrfWallet = computed(() => WalletStore.state.loggedWallet?.encryptionMethod === 'prf');
const loggedWallet = computed(() => WalletStore.state.loggedWallet);
const keys = computed(() => WalletStore.state.keys);
const utxos = computed(() => WalletStore.state.utxos);
const isBT = computed(() => WalletStore.state.loggedWallet?.connectionType === 'bluetooth');

// Reset state when request changes
watch(currentRequest, () => {
  spendingPassword.value = '';
  showPassword.value = false;
  signing.value = false;
  signError.value = '';
  enableConsent.value = false;
  faviconFailed.value = false;
  faviconAttempt.value = 0;
});

function rejectSign() {
  spendingPassword.value = '';
  signError.value = '';
  reject('user_rejected');
}

function getTxCbor(): string {
  return currentRequest.value?.payload?.tx;
}

// ── Normal wallet: password signing ──
async function signNormal() {
  if (!currentRequest.value || !spendingPassword.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const payload = currentRequest.value.payload;
    const witnessResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_TX,
      data: {
        txCbor: payload.tx,
        partialSign: payload.partialSign,
        password: spendingPassword.value,
        accountIndex: 0,
        utxos: utxos.value,
        addresses: keys.value,
        mergeWitnesses: payload.mergeWitnesses || false,
      }
    }) as { data: { witnesses?: string; error?: string } };

    if (witnessResult.data.error) throw new Error(witnessResult.data.error);
    approve(witnessResult.data.witnesses);
    spendingPassword.value = '';
  } catch (e: any) {
    console.error('[DApp] Normal sign error:', e);
    signError.value = e.message || 'Signing failed';
  } finally {
    signing.value = false;
  }
}

// ── PRF wallet: PassKey signing ──
async function signPrf() {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const popupUrl = chrome.runtime.getURL('index.html?mode=privateKey#/passkey-auth');
    window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');

    const pkBytes = await new Promise<Uint8Array>((resolve, rejectPromise) => {
      const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
      const handler = (event: MessageEvent) => {
        if (event.origin !== extensionOrigin) return;
        if (event.data.type === 'PASSKEY_AUTH_RESULT') {
          window.removeEventListener('message', handler);
          const { success, privateKeyBytes: bytes, error } = event.data.payload;
          if (success && bytes) resolve(new Uint8Array(bytes));
          else rejectPromise(new Error(error || 'PassKey authentication failed'));
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => {
        window.removeEventListener('message', handler);
        rejectPromise(new Error('PassKey authentication timed out'));
      }, 60000);
    });

    const payload = currentRequest.value.payload;
    const witnessResult = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_TX,
      data: {
        txCbor: payload.tx,
        partialSign: payload.partialSign,
        password: '',
        accountIndex: 0,
        utxos: utxos.value,
        addresses: keys.value,
        mergeWitnesses: payload.mergeWitnesses || false,
        privateKeyBytes: Array.from(pkBytes),
      }
    }) as { data: { witnesses?: string; error?: string } };

    if (witnessResult.data.error) throw new Error(witnessResult.data.error);
    approve(witnessResult.data.witnesses);
  } catch (e: any) {
    console.error('[DApp] PRF sign error:', e);
    signError.value = e.message || 'PassKey signing failed';
  } finally {
    signing.value = false;
  }
}

// ── Ledger wallet signing ──
async function signLedger() {
  if (!currentRequest.value || !loggedWallet.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const txCbor = getTxCbor();
    const tx: Cardano.Tx = deserializeCardanoJsSdkTx(txCbor);

    const signatures: Cardano.Signatures = await ledgerUtils.txToLedger(
      tx,
      keys.value,
      utxos.value,
      !isBT.value,
      networks.resolveNetwork(loggedWallet.value.chain, loggedWallet.value.network),
      txCbor,
    );

    const witnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures });
    approve(witnessSet.toCbor());
  } catch (e: any) {
    ledgerUtils.ledgerErrorHandling(e);
    console.error('[DApp] Ledger sign error:', e);
    signError.value = e?.message || 'Ledger signing failed';
  } finally {
    signing.value = false;
  }
}

// ── Trezor wallet signing ──
async function signTrezor() {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const txCbor = getTxCbor();
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.TREZOR,
      data: { method: 'signTx', txCbor },
    }) as BackgroundResponse<SignTxResponse>;

    if (!response.data.success) {
      throw new Error(response.data.error || 'Trezor signing failed');
    }

    const signaturesArray = response.data.signatures as unknown as Array<[string, string]>;
    const signatures: Cardano.Signatures = new Map(signaturesArray);
    const witnessSet = Serialization.TransactionWitnessSet.fromCore({ signatures });
    approve(witnessSet.toCbor());
  } catch (e: any) {
    console.error('[DApp] Trezor sign error:', e);
    if (e.message?.includes('Failure_ActionCancelled') || e.message?.includes('cancelled')) {
      signError.value = 'Transaction cancelled on Trezor';
    } else {
      signError.value = e.message || 'Trezor signing failed';
    }
  } finally {
    signing.value = false;
  }
}

// ── Keystone wallet signing ──
function signKeystone() {
  if (!currentRequest.value || !loggedWallet.value) return;
  signError.value = '';

  try {
    const txCbor = getTxCbor();
    const txSerialized = Serialization.Transaction.fromCbor(txCbor as any);
    const signRequestResponse: KeystoneSignRequestResponse = createKeystoneSignRequest(
      txSerialized, loggedWallet.value, utxos.value, keys.value
    );
    keystoneType.value = signRequestResponse.ur.type;
    keystoneCbor.value = signRequestResponse.ur.cbor.toString('hex');
    keystoneUseHash.value = signRequestResponse.useHash;
    showKeystoneDialog.value = true;
  } catch (e: any) {
    console.error('[DApp] Keystone sign error:', e);
    signError.value = e?.message || 'Failed to create Keystone sign request';
  }
}

async function onKeystoneScan(ur: UR) {
  try {
    const signature = parseSignature(ur);
    if (!signature?.witnessSet || typeof signature.witnessSet !== 'string') {
      throw new Error('Invalid Keystone signature');
    }
    showKeystoneDialog.value = false;
    approve(signature.witnessSet);
  } catch (e: any) {
    console.error('[DApp] Keystone scan error:', e);
    signError.value = e?.message || 'Keystone QR scan error';
    showKeystoneDialog.value = false;
  }
}

function onKeystoneError(error: string) {
  signError.value = error || 'Keystone scan error';
  showKeystoneDialog.value = false;
}

// ── Sign Data: Normal wallet (password) ──
async function signDataNormal() {
  if (!currentRequest.value || !spendingPassword.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const { address, payload } = currentRequest.value.payload;
    const res = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_DATA,
      data: {
        address,
        payload,
        password: spendingPassword.value,
        accountIndex: 0,
        isUsb: true,
      },
    }) as { data: { key?: string; signature?: string; error?: string } };

    // The background resolves (does not reject) on failure, returning
    // { error }. Without this guard the error object was handed to the dApp as
    // the "signature", surfacing downstream as an opaque verify 401. Mirror the
    // popup path (DappSignData.vue) which only approves a real signature.
    if (res?.data?.error) throw new Error(res.data.error);
    if (!res?.data?.signature || !res?.data?.key) {
      throw new Error('Wallet returned an empty signature payload');
    }

    approve(res.data);
    spendingPassword.value = '';
  } catch (e: any) {
    console.error('[DApp] Sign data error:', e);
    signError.value = e.message || 'Signing failed';
  } finally {
    signing.value = false;
  }
}

// ── Sign Data: PRF wallet (PassKey) ──
async function signDataPrf() {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const popupUrl = chrome.runtime.getURL('index.html?mode=privateKey#/passkey-auth');
    window.open(popupUrl, 'PassKeyAuth', 'width=400,height=500,popup=1');

    const pkBytes = await new Promise<Uint8Array>((resolve, rejectPromise) => {
      const extensionOrigin = new URL(chrome.runtime.getURL('')).origin;
      const handler = (event: MessageEvent) => {
        if (event.origin !== extensionOrigin) return;
        if (event.data.type === 'PASSKEY_AUTH_RESULT') {
          window.removeEventListener('message', handler);
          const { success, privateKeyBytes: bytes, error } = event.data.payload;
          if (success && bytes) resolve(new Uint8Array(bytes));
          else rejectPromise(new Error(error || 'PassKey authentication failed'));
        }
      };
      window.addEventListener('message', handler);
      setTimeout(() => {
        window.removeEventListener('message', handler);
        rejectPromise(new Error('PassKey authentication timed out'));
      }, 60000);
    });

    const { address, payload } = currentRequest.value.payload;
    const { buildSignatureAndCoseKey } = await import('@/shared/utils/converter');
    const { Bip32PrivateKey } = await import('@cardano-sdk/crypto');

    const rootKey = Bip32PrivateKey.fromBytes(pkBytes);

    // Resolve address to bech32
    let addressBech32: string;
    if (address.startsWith('addr') || address.startsWith('stake')) {
      addressBech32 = address;
    } else {
      addressBech32 = Cardano.Address.fromBytes(Buffer.from(address, 'hex')).toBech32();
    }

    // Find signing key
    const allKeys = [...keys.value.payment, ...keys.value.change, ...keys.value.stake];
    const foundKey = allKeys.find(k => k.address === addressBech32);
    if (!foundKey?.path) throw new Error('Address not found in wallet keys');

    const pathParts = foundKey.path.split('/');
    const role = parseInt(pathParts[4].replace("'", ""), 10);
    const index = parseInt(pathParts[5].replace("'", ""), 10);

    const accountKey = rootKey.derive([2147485500, 2147485463, 2147483648]);
    const signingKey = accountKey.derive([role, index]).toRawKey();

    // Get address bytes for COSE_Key. Address.toBytes() returns a HexBlob
    // (hex STRING) — decode to real bytes, else the emurgo WASM coerces the
    // string per-character and embeds a garbage address (verify 401).
    const addressBytes = address.startsWith('addr') || address.startsWith('stake')
      ? Buffer.from(Cardano.Address.fromBech32(address).toBytes(), 'hex')
      : Buffer.from(address, 'hex');

    const signatureData = buildSignatureAndCoseKey(addressBytes, payload, signingKey);
    approve(signatureData);
  } catch (e: any) {
    console.error('[DApp] PRF sign data error:', e);
    signError.value = e.message || 'PassKey signing failed';
  } finally {
    signing.value = false;
  }
}

// ── Sign Data: Hardware wallet (Ledger/Trezor via background) ──
async function signDataHw() {
  if (!currentRequest.value) return;
  signing.value = true;
  signError.value = '';

  try {
    const { address, payload } = currentRequest.value.payload;
    const res = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.SIGN_DATA,
      data: {
        address,
        payload,
        password: '',
        accountIndex: 0,
        isUsb: true,
      },
    }) as { data: { key?: string; signature?: string; error?: string } };

    if (res?.data?.error) throw new Error(res.data.error);
    if (!res?.data?.signature || !res?.data?.key) {
      throw new Error('Wallet returned an empty signature payload');
    }

    approve(res.data);
  } catch (e: any) {
    console.error('[DApp] HW sign data error:', e);
    signError.value = e.message || 'Signing failed';
  } finally {
    signing.value = false;
  }
}
</script>

<style scoped>
.dapp-overlay {
  display: flex;
  flex-direction: column;
  padding: 16px;
}

.queue-indicator {
  text-align: center;
}

/* ── Enable / Connect ── */

.dapp-identity {
  display: flex;
  align-items: center;
  gap: 14px;
}

.favicon-wrapper {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.1);
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
  overflow: hidden;
}

.favicon-img {
  width: 32px;
  height: 32px;
  object-fit: contain;
}

.dapp-domain-info {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.dapp-url {
  word-break: break-all;
  line-height: 1.3;
}

.url-warning {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  background: rgba(255, 167, 38, 0.08);
  border: 1px solid rgba(255, 167, 38, 0.15);
  border-radius: 8px;
}

.permissions-section {
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
}

.consent-checkbox >>> .v-label {
  font-size: 13px !important;
  color: rgba(255, 255, 255, 0.8) !important;
}

.security-note {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  line-height: 1.4;
}

/* ── Sign ── */

.dapp-sign-tx {
  display: flex;
  flex-direction: column;
}

/* Decoded tx details panel */
.tx-details {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  overflow: hidden;
}

.tx-details-header {
  padding: 8px 12px;
  background: rgba(255, 255, 255, 0.02);
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  letter-spacing: 0.5px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.risk-badge {
  display: inline-flex;
  align-items: center;
  font-size: 10px;
  font-weight: 600;
  padding: 2px 6px;
  border-radius: 10px;
  border: 1px solid;
  background: rgba(255, 255, 255, 0.02);
  text-transform: uppercase;
  letter-spacing: 0.3px;
}

.tx-internal-banner {
  padding: 6px 12px;
  background: rgba(148, 207, 168, 0.06);
  border-bottom: 1px solid rgba(148, 207, 168, 0.15);
  text-align: center;
  color: #94CFA8;
}

.tx-internal-banner .text-caption {
  color: #94CFA8 !important;
  font-weight: 500;
}

.tx-details-section {
  padding: 8px 12px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.tx-details-divider {
  border-color: rgba(255, 255, 255, 0.06) !important;
}

.tx-output-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  min-width: 0;
}

.tx-output-left {
  display: flex;
  align-items: center;
  min-width: 0;
  flex: 1;
}

.tx-output-addr {
  font-family: 'SFMono-Regular', Menlo, Consolas, monospace;
  font-size: 10px !important;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-output-right {
  display: flex;
  align-items: center;
  flex-shrink: 0;
}

.tx-asset-pill {
  font-size: 9px;
  padding: 1px 6px;
  border-radius: 6px;
  background: color-mix(in srgb, var(--chain-primary) 15%, transparent);
  color: var(--chain-primary);
  font-weight: 600;
}

.tx-asset-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 11px;
  line-height: 1.3;
}

.tx-asset-line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 4px;
  min-width: 0;
}

.tx-asset-qty {
  flex-shrink: 0;
  font-variant-numeric: tabular-nums;
  font-weight: 500;
  color: #f5f5f6;
}

.tx-asset-name {
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.tx-summary-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.tx-summary-total {
  margin-top: 2px;
}

.tx-ttl-expired {
  color: #FDA29B !important;
}

/* Centered countdown footer beneath the financial card. Monospaced so digit
   width stays constant as the timer ticks (no horizontal jitter). */
.tx-ttl-footer {
  display: flex;
  justify-content: center;
  align-items: baseline;
  gap: 6px;
  margin-top: 10px;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.55);
  cursor: help;
}

.tx-ttl-footer-value {
  color: rgba(255, 255, 255, 0.85);
  font-weight: 600;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, "Cascadia Mono", "Roboto Mono", monospace;
  font-variant-numeric: tabular-nums;
}

.tx-expired-banner {
  display: flex;
  align-items: flex-start;
  padding: 12px 14px;
  margin: 12px 0;
  border-radius: 10px;
  background: rgba(255, 100, 100, 0.08);
  border: 1px solid rgba(255, 100, 100, 0.32);
}

.tx-expired-text {
  flex: 1;
  min-width: 0;
}

.tx-expired-title {
  color: #FDA29B;
  font-size: 13px;
  font-weight: 700;
  line-height: 1.3;
}

.tx-expired-body {
  color: rgba(255, 255, 255, 0.75);
  font-size: 11px;
  line-height: 1.45;
  margin-top: 2px;
}

.dapp-sign-data {
  display: flex;
  flex-direction: column;
}

.sign-data-message {
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 8px;
  max-height: 40vh;
  overflow-y: auto;
  width: 100%;
  white-space: pre-line;
}

.password-input {
  width: 100%;
  margin-top: 8px;
}

.hw-notice {
  display: flex;
  flex-direction: column;
  align-items: center;
  background: color-mix(in srgb, var(--chain-primary) 8%, transparent);
  border-radius: 8px;
  width: 100%;
}

.action-buttons {
  display: flex;
  gap: 12px;
  width: 100%;
  justify-content: center;
  margin-top: 16px;
}

.action-buttons .v-btn {
  flex: 1;
  max-width: 160px;
}
</style>
