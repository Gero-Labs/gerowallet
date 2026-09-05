<template>
  <div class="mn-tx-utxos">
    <div v-if="loading" class="mn-tx-utxos__state">
      <v-progress-circular indeterminate size="16" width="2" color="var(--g-text-2)" />
      <span>{{ $t('common.loadingEllipsis') }}</span>
    </div>

    <ErrorState
      v-else-if="error"
      :message="error"
      retryable
      @retry="load(true)"
    />

    <template v-else-if="data">
      <div v-if="counterpartyOwner" class="mn-tx-utxos__counterparty">
        <span class="mn-tx-utxos__counterparty-label">{{ $t('transactions.from') }}</span>
        <span class="mn-tx-utxos__counterparty-value">{{ shortAddress(counterpartyOwner) }}</span>
      </div>

      <div class="mn-tx-utxos__group">
        <div class="mn-tx-utxos__group-title">{{ $t('midnight.utxoInputs') }} ({{ data.spentOutputs.length }})</div>
        <div v-if="data.spentOutputs.length === 0" class="mn-tx-utxos__empty">{{ $t('transactions.noUtxos') }}</div>
        <div
          v-for="(u, idx) in data.spentOutputs"
          :key="`in-${idx}`"
          class="mn-tx-utxos__entry"
          :class="{ 'mn-tx-utxos__entry--mine': isMine(u.owner) }"
        >
          <div class="mn-tx-utxos__entry-main">
            <span class="mn-tx-utxos__entry-owner">{{ shortAddress(u.owner) }}</span>
            <span v-if="isMine(u.owner)" class="mn-tx-utxos__badge">{{ $t('midnight.thisWallet') }}</span>
          </div>
          <div class="mn-tx-utxos__entry-ref">{{ shortRef(u.intentHash) }}:{{ u.outputIndex }}</div>
          <div class="mn-tx-utxos__entry-amount">
            <span>{{ formatAmount(u) }}</span>
            <v-tooltip v-if="isUnscaled(u.tokenType)" top content-class="custom-tooltip">
              <template v-slot:activator="{ on, attrs }">
                <v-icon x-small color="var(--g-warning)" v-bind="attrs" v-on="on">mdi-help-circle-outline</v-icon>
              </template>
              {{ $t('midnight.rawBalanceNotice') }}
            </v-tooltip>
          </div>
        </div>
      </div>

      <div class="mn-tx-utxos__group">
        <div class="mn-tx-utxos__group-title">{{ $t('midnight.utxoOutputs') }} ({{ data.createdOutputs.length }})</div>
        <div v-if="data.createdOutputs.length === 0" class="mn-tx-utxos__empty">{{ $t('transactions.noUtxos') }}</div>
        <div
          v-for="(u, idx) in data.createdOutputs"
          :key="`out-${idx}`"
          class="mn-tx-utxos__entry"
          :class="{ 'mn-tx-utxos__entry--mine': isMine(u.owner) }"
        >
          <div class="mn-tx-utxos__entry-main">
            <span class="mn-tx-utxos__entry-owner">{{ shortAddress(u.owner) }}</span>
            <span v-if="isMine(u.owner)" class="mn-tx-utxos__badge">{{ $t('midnight.thisWallet') }}</span>
          </div>
          <div class="mn-tx-utxos__entry-ref">{{ shortRef(u.intentHash) }}:{{ u.outputIndex }}</div>
          <div class="mn-tx-utxos__entry-amount">
            <span>{{ formatAmount(u) }}</span>
            <v-tooltip v-if="isUnscaled(u.tokenType)" top content-class="custom-tooltip">
              <template v-slot:activator="{ on, attrs }">
                <v-icon x-small color="var(--g-warning)" v-bind="attrs" v-on="on">mdi-help-circle-outline</v-icon>
              </template>
              {{ $t('midnight.rawBalanceNotice') }}
            </v-tooltip>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
// Per-transaction UTxO inspector for the Midnight history list. Fetches
// `getTransactionUtxos()` once per (network, hash) and caches the result at
// module scope, so collapsing/re-expanding a row (which destroys/recreates
// this component via v-if) never refetches. Also derives a receive's
// counterparty from `spentOutputs` — gero-sync's per-address subscription
// can't see who sent a payment, but this endpoint's spent-inputs list can.
import { computed, onMounted, ref, watch } from 'vue';
import { getMidnightApi } from '@/api/midnight-api';
import type { MidnightTransactionUtxosDto } from '@/api/midnight-api';
import type { MidnightTransactionType, MidnightUnshieldedUtxo } from '@/chains/midnight/midnightTypes';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { midnightTokenMeta } from '@/chains/midnight/midnightTokenRegistry';
import { isNativeNight } from '@/chains/midnight/midnightTokenBalances';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { useTranslation } from '@/shared/composables/useTranslation';
import ErrorState from '@/shared/components/feedback/ErrorState.vue';
import { fetchTxUtxos, getCachedTxUtxos } from './midnightTxUtxosCache';

const { t } = useTranslation();

const props = defineProps<{
  txHash: string;
  /** Only used to derive a receive's counterparty from spentOutputs (Step 4). */
  txType?: MidnightTransactionType;
  txToken?: string;
  txCounterparty?: string;
}>();

// Cache lives in ./midnightTxUtxosCache — see that file for why it cannot
// live in `<script setup>` (this block re-runs per instance).

const loading = ref(false);
const error = ref<string | null>(null);
const data = ref<MidnightTransactionUtxosDto | null>(null);

const isMainnet = computed(() => walletStore.loggedWallet?.network === Network.MAINNET);

function cacheKey(): string {
  return `${walletStore.loggedWallet?.network ?? ''}:${props.txHash}`;
}

async function load(force = false): Promise<void> {
  const key = cacheKey();
  if (!force) {
    const cached = getCachedTxUtxos(key);
    if (cached) {
      data.value = cached;
      error.value = null;
      return;
    }
  }
  const network = walletStore.loggedWallet?.network;
  if (!network) {
    data.value = null;
    error.value = t('midnight.utxoLoadFailed');
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    const result = await fetchTxUtxos(
      key,
      () => getMidnightApi(network).getTransactionUtxos(props.txHash),
      force,
    );
    // This instance is REUSED across selections: MidnightTransactionDetails
    // mounts it once with `:tx-hash` and no `:key`, so picking tx A then B
    // before A settles would let A's response overwrite B's pane. Only the
    // response for the key we are still showing may touch state — and only
    // that response may clear `loading`, or a superseded request would hide
    // the spinner while the current one is still in flight.
    if (cacheKey() !== key) return;
    data.value = result;
  } catch {
    // Auth-expiry / network failures are common here (see Nexus route
    // notes) — show the failure, never swallow it into a blank panel.
    if (cacheKey() !== key) return;
    data.value = null;
    error.value = t('midnight.utxoLoadFailed');
  } finally {
    if (cacheKey() === key) loading.value = false;
  }
}

onMounted(() => load());
watch(() => props.txHash, () => load());

function isMine(owner: string): boolean {
  const own = midnightStore.addresses?.unshielded;
  return !!own && owner === own;
}

function shortAddress(addr: string): string {
  if (!addr || addr.length <= 16) return addr ?? '';
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`;
}

function shortRef(hash: string): string {
  if (!hash || hash.length <= 16) return hash ?? '';
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

const NIGHT_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.NIGHT);

/** Base-unit divisor for a token color, or null when its decimals aren't known. */
function tokenDivisor(tokenType: string): bigint | null {
  if (isNativeNight(tokenType)) return NIGHT_DIVISOR;
  const meta = midnightTokenMeta(tokenType);
  return meta ? 10n ** BigInt(meta.decimals) : null;
}

/** Never guess an exponent for an unlisted color — show raw base units instead. */
function isUnscaled(tokenType: string): boolean {
  return tokenDivisor(tokenType) === null;
}

function tokenSymbol(tokenType: string): string {
  if (isNativeNight(tokenType)) return isMainnet.value ? 'NIGHT' : 'tNIGHT';
  // Head+tail truncation, not a prefix — see midnightTokenRegistry.ts.
  return midnightTokenMeta(tokenType)?.symbol ?? `${tokenType.slice(0, 8)}…${tokenType.slice(-6)}`;
}

function formatBigDecimal(value: bigint, divisor: bigint, fractionDigits: number): string {
  if (value < 0n) value = 0n;
  const whole = value / divisor;
  const remainder = value % divisor;
  const remainderStr = remainder.toString().padStart(divisor.toString().length - 1, '0');
  const fraction = remainderStr.slice(0, fractionDigits).padEnd(fractionDigits, '0');
  return `${whole.toLocaleString('en-US')}.${fraction}`;
}

function formatAmount(u: MidnightUnshieldedUtxo): string {
  const divisor = tokenDivisor(u.tokenType);
  if (divisor === null) {
    return `${u.value.toString()} ${tokenSymbol(u.tokenType)}`;
  }
  return `${formatBigDecimal(u.value, divisor, 2)} ${tokenSymbol(u.tokenType)}`;
}

function tokenColorMatches(u: MidnightUnshieldedUtxo, token: string): boolean {
  if (token === 'NIGHT') return isNativeNight(u.tokenType);
  return u.tokenType === token;
}

/**
 * Receive counterparty, derived from spentOutputs owners that are NOT this
 * wallet — the one contributing the largest value of this row's token color.
 * Only computed when the row itself has nothing today (gero-sync's
 * per-address subscription can't see a receive's sender). Never a guess: if
 * no non-own spender of the matching color exists, this stays null and
 * nothing renders (see the empty-blank rule in the task description).
 */
const counterpartyOwner = computed<string | null>(() => {
  if (!data.value || props.txType !== 'receive' || props.txCounterparty || !props.txToken) return null;
  const own = midnightStore.addresses?.unshielded;
  const contributions = new Map<string, bigint>();
  for (const u of data.value.spentOutputs) {
    if (own && u.owner === own) continue;
    if (!tokenColorMatches(u, props.txToken)) continue;
    contributions.set(u.owner, (contributions.get(u.owner) ?? 0n) + u.value);
  }
  let best: string | null = null;
  let bestValue = -1n;
  for (const [owner, value] of contributions) {
    if (value > bestValue) {
      bestValue = value;
      best = owner;
    }
  }
  return best;
});
</script>

<style scoped>
.mn-tx-utxos {
  padding: var(--g-s-2) var(--g-s-1) var(--g-s-1);
  border-top: 1px solid var(--g-hairline-1);
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.mn-tx-utxos__state {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  padding: var(--g-s-3) 0;
  font-size: 12px;
  color: var(--g-text-2);
}

.mn-tx-utxos__counterparty {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  font-size: 12px;
}

.mn-tx-utxos__counterparty-label {
  color: var(--g-text-3);
}

.mn-tx-utxos__counterparty-value {
  font-family: var(--g-font-mono);
  color: var(--g-text-1);
}

.mn-tx-utxos__group-title {
  font-size: 11px;
  font-weight: 600;
  color: var(--g-text-3);
  margin-bottom: var(--g-s-2);
}

.mn-tx-utxos__empty {
  font-size: 12px;
  color: var(--g-text-3);
  padding: var(--g-s-1) 0;
}

.mn-tx-utxos__entry {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-2) 0;
  border-bottom: 1px solid var(--g-hairline-1);
  font-size: 12px;
}

.mn-tx-utxos__entry:last-child {
  border-bottom: none;
}

.mn-tx-utxos__entry--mine {
  background: var(--g-success-fill);
  border-radius: var(--g-r-control);
  padding-left: var(--g-s-2);
  padding-right: var(--g-s-2);
}

.mn-tx-utxos__entry-main {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
  min-width: 0;
  flex: 1;
}

.mn-tx-utxos__entry-owner {
  font-family: var(--g-font-mono);
  color: var(--g-text-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.mn-tx-utxos__badge {
  flex-shrink: 0;
  font-size: 10px;
  padding: 1px var(--g-s-2);
  border-radius: var(--g-r-pill);
  background: var(--g-success-fill);
  border: 1px solid var(--g-success-line);
  color: var(--g-success);
}

.mn-tx-utxos__entry-ref {
  font-family: var(--g-font-mono);
  color: var(--g-text-3);
  font-size: 11px;
  flex-shrink: 0;
}

.mn-tx-utxos__entry-amount {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  font-family: var(--g-font-mono);
  font-weight: 600;
  color: var(--g-text-1);
  flex-shrink: 0;
  min-width: 100px;
  justify-content: flex-end;
  text-align: right;
}
</style>
