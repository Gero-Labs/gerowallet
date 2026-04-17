<template>
  <div class="assets-to-send">
    <!-- Token rows -->
    <div class="token-list">
      <div
        v-for="(token, index) in tokenModel"
        :key="index"
        class="token-row-wrapper"
      >
        <div class="token-row">
          <div class="token-row__left">
            <!-- Native token (locked, no picker) -->
            <template v-if="index === 0">
              <v-avatar size="24" class="mr-2">
                <img
                  :src="token.img"
                  :alt="token.ticker"
                  @error="handleImageError($event, token)"
                />
              </v-avatar>
              <span class="token-ticker">{{ token.ticker }}</span>
              <v-icon
                v-if="token.verified"
                x-small
                color="primary"
                class="ml-1"
                style="margin-top: -1px;"
              >mdi-check-decagram</v-icon>
            </template>
            <!-- Non-native token (clickable to swap) -->
            <template v-else>
              <v-menu offset-y attach max-height="240">
                <template v-slot:activator="{ on, attrs }">
                  <div class="token-selector-trigger" v-bind="attrs" v-on="on">
                    <v-avatar size="24" class="mr-2">
                      <img
                        :src="token.img"
                        :alt="token.ticker"
                        @error="handleImageError($event, token)"
                      />
                    </v-avatar>
                    <span class="token-ticker">{{ token.ticker }}</span>
                    <v-icon x-small class="ml-1" style="opacity: 0.4;">mdi-chevron-down</v-icon>
                  </div>
                </template>
                <v-list dense dark class="token-picker-list">
                  <v-list-item
                    v-for="(available, aidx) in getAvailableTokens(index)"
                    :key="available.unit || `avail-${aidx}`"
                    @click="swapToken(index, available)"
                  >
                    <v-avatar size="24" class="mr-2">
                      <img :src="available.img" :alt="available.ticker" />
                    </v-avatar>
                    <v-list-item-content>
                      <v-list-item-title style="font-size: 13px;">{{ available.ticker }}</v-list-item-title>
                    </v-list-item-content>
                    <v-list-item-action style="margin: 0; min-width: auto;">
                      <span style="font-size: 11px; color: rgba(255,255,255,0.4);">
                        {{ formatTokenBalance(available) }}
                      </span>
                    </v-list-item-action>
                  </v-list-item>
                </v-list>
              </v-menu>
            </template>
          </div>
          <div class="token-row__right">
            <v-text-field
              :value="token.quantity"
              @input="onQuantityInput(index, $event)"
              type="number"
              outlined
              dense
              hide-details
              class="amount-input"
              placeholder="0"
              min="0"
              step="any"
            />
            <v-btn
              text
              x-small
              color="#00DFF3"
              class="max-btn"
              @click="setMax(index)"
            >MAX</v-btn>
          </div>
          <!-- Remove button (not for first/native token) -->
          <v-btn
            v-if="index > 0"
            icon
            x-small
            class="remove-btn"
            @click="removeTokenSelector(index)"
          >
            <v-icon x-small color="rgba(255,255,255,0.3)">mdi-close</v-icon>
          </v-btn>
        </div>

        <!-- Balance + price meta row -->
        <div class="token-meta">
          <span>{{ $t('send.availableBalance') }}: {{ formatBalance(token) }}</span>
          <span v-if="getTokenPriceInUsd(token) > 0" class="token-meta__price">
            {{ '\u2248' }} ${{ formatTokenValue(token) }}
          </span>
        </div>

        <!-- Validation: insufficient funds -->
        <div
          v-if="index === 0 && value && value.adaShortage > 0"
          class="token-error"
        >
          {{ $t('send.insufficientBalance') }}
        </div>

        <!-- Validation: minimum ADA required -->
        <div
          v-else-if="index === 0 && value && value.minAda > 0 && value.minAda > Number(token.quantity)"
          class="token-error token-error--clickable"
          @click="setMinimum(token)"
        >
          {{ $t('assets.minRequired', { amount: value.minAda + ' ' + token.ticker }) }}
        </div>
      </div>
    </div>

    <!-- Add token / NFT row -->
    <div class="add-asset-row">
      <!-- Add token picker -->
      <v-menu offset-y attach max-height="320" min-width="280" v-if="missingTokens.length > 0">
        <template v-slot:activator="{ on, attrs }">
          <v-btn text x-small color="#00DFF3" v-bind="attrs" v-on="on" class="add-asset-btn">
            <v-icon x-small class="mr-1">mdi-plus</v-icon>
            {{ $t('assets.addToken') }}
          </v-btn>
        </template>
        <v-list dense dark class="token-picker-list">
          <v-list-item
            v-for="(token, idx) in missingTokens"
            :key="token.unit || `missing-${idx}`"
            @click="addSpecificToken(token)"
          >
            <v-avatar size="24" class="mr-2">
              <img :src="token.img" :alt="token.ticker" />
            </v-avatar>
            <v-list-item-content>
              <v-list-item-title style="font-size: 13px;">{{ token.ticker }}</v-list-item-title>
              <v-list-item-subtitle style="font-size: 11px;">
                {{ token.name || '' }}
              </v-list-item-subtitle>
            </v-list-item-content>
            <v-list-item-action style="margin: 0; min-width: auto;">
              <span style="font-size: 11px; color: rgba(255,255,255,0.4);">
                {{ formatTokenBalance(token) }}
              </span>
            </v-list-item-action>
          </v-list-item>
        </v-list>
      </v-menu>
      <!-- Add NFT button -->
      <v-btn
        v-if="collectiblesCount > 0"
        text x-small color="#00DFF3"
        class="add-asset-btn"
        @click="$emit('openCollectiblesDialog')"
      >
        <v-icon x-small class="mr-1">mdi-plus</v-icon>
        {{ $t('assets.addCollectibleLabel') }}
      </v-btn>
    </div>

    <!-- Selected NFT chips -->
    <div v-if="selectedCollectibles.length > 0" class="nft-chips">
      <v-chip
        v-for="(nft, idx) in selectedCollectibles"
        :key="nft.fingerprint || idx"
        small
        close
        class="nft-chip"
        @click:close="removeCollectible(idx)"
      >
        <v-avatar left size="20" v-if="nft.img">
          <v-img :src="nft.img" />
        </v-avatar>
        {{ nft.name }}
        <span v-if="nft.toSendQuantity > 1" class="nft-chip__qty ml-1">x{{ nft.toSendQuantity }}</span>
      </v-chip>
    </div>

    <!-- Total line -->
    <div
      v-if="totalAmounts.totalAdaAll > 0 || totalAmounts.totalUsd > 0"
      class="total-line"
    >
      <span class="total-label">{{ $t('common.total') }}</span>
      <div class="total-values">
        <span class="total-ada">{{ totalAmounts.formattedAda }}</span>
        <span class="total-fiat">{{ totalAmounts.formattedUsd }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { toRefs, computed, watch, onMounted, ref } from 'vue';
import networks from '@/utils/networks';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { priceStore } from '@/stores/priceStore';
import { dexHunterStore } from '@/stores/dexHunterStore';
import filters from '@/shared/utils/filters';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';

interface Props {
  value: any;
  tokens: any[];
  /** Fingerprints of NFTs fully allocated to other recipient cards — hidden from picker */
  excludedCollectibleFingerprints?: Set<string>;
  /** When true, uses compact height for inline use inside a recipient card */
  compact?: boolean;
}

const props = defineProps<Props>();
const emit = defineEmits(['input', 'setMax', 'openCollectiblesDialog']);

const { loggedWallet, collections: resolvedCollections } = toRefs(walletStore);
const { price } = toRefs(networkStore);

const selectedCollectibles = ref<any[]>([]);
const search = ref<string>('');
const selectedTokens = ref<any[]>([]);

const { convertFiat } = useCurrencyConverter();

// Get token price from tokens list (same logic as TokensTab)
function getTokenPriceInUsd(token: any): number {
  if (!token) return 0;

  // Find full token info from props.tokens
  const fullToken = props.tokens.find(
    t => t.ticker === token.ticker || t.unit === token.unit || t.metadata?.ticker === token.ticker
  );

  const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);

  // For native tokens (ADA)
  if (token.ticker === nativeTicker || fullToken?.policy_id === '') {
    return priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0;
  }

  // For other tokens: get price from DexHunter (in ADA), convert to USD
  const unit = token.unit || fullToken?.unit;
  if (unit && dexHunterStore.dexHunterTokens[unit]) {
    const priceInAda = dexHunterStore.dexHunterTokens[unit].price || 0;
    const adaPriceUsd = priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0;
    return priceInAda * adaPriceUsd;
  }

  // Fallback to last_price if available
  return token.last_price || fullToken?.last_price || 0;
}

const missingTokens = computed(() => {
  const existingTokens = selectedTokens.value.map(token => token?.ticker);
  return props.tokens.filter(token => !existingTokens.includes(token.ticker));
});

const tokenModel = computed({
  get() {
    return props.value?.selectedTokens || [];
  },
  set(newTokens) {
    emit('input', {
      ...props.value,
      selectedTokens: newTokens,
      selectedCollectibles: selectedCollectibles.value,
    });
  },
});

const collectiblesCount = computed(() => {
  let count = 0;
  const cols: any[] = Object.values(resolvedCollections.value);
  cols.forEach(collection => {
    count += collection.items.length;
  });
  return count;
});

const collections = computed(() => {
  let cols: any[] = Object.values(resolvedCollections.value);
  if (search.value) {
    cols = cols
      .map(collection => {
        return {
          ...collection,
          items: collection.items.filter((item: any) => item.name.toLowerCase().includes(search.value.toLowerCase())),
        };
      })
      .filter(collection => collection.items.length > 0);
  }
  // Filter out NFTs already committed to other recipient cards
  const excluded = props.excludedCollectibleFingerprints ?? new Set<string>();
  if (excluded.size > 0) {
    cols = cols.map(collection => ({
      ...collection,
      items: collection.items.filter((item: any) =>
        !excluded.has(item.fingerprint)
      ),
    })).filter(collection => collection.items.length > 0);
  }
  if (cols) {
    return cols.map(collection => {
      collection.items.map((item: any) => {
        if (item['toSendQuantity'] === undefined) {
          item['toSendQuantity'] = 1;
        }
        return item;
      });
      return collection;
    });
  }
  return cols;
});

// Get token price in ADA (for direct conversion, not through USD)
function getTokenPriceInAda(token: any): number {
  if (!token) return 0;

  // Find full token info from props.tokens
  const fullToken = props.tokens.find(
    t => t.ticker === token.ticker || t.unit === token.unit || t.metadata?.ticker === token.ticker
  );

  const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);

  // For native tokens (ADA), price is 1 ADA per ADA
  if (token.ticker === nativeTicker || fullToken?.policy_id === '') {
    return 1;
  }

  // For other tokens: get price from DexHunter (already in ADA)
  const unit = token.unit || fullToken?.unit;
  if (unit && dexHunterStore.dexHunterTokens[unit]) {
    return dexHunterStore.dexHunterTokens[unit].price || 0;
  }

  // Fallback: if we have USD price, convert to ADA
  const tokenPriceUsd = getTokenPriceInUsd(token);
  const adaPriceUsd = priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0;
  if (tokenPriceUsd > 0 && adaPriceUsd > 0) {
    return tokenPriceUsd / adaPriceUsd;
  }

  return 0;
}

// Calculate total amounts being sent
const totalAmounts = computed(() => {
  const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);
  let totalAda = 0; // Native ADA amount
  let totalAdaEquivalent = 0; // ADA equivalent from other tokens
  let totalUsd = 0;

  // Process all selected tokens
  tokenModel.value.forEach((token: any) => {
    if (!token) return;

    // Parse quantity (may be string with formatting like commas)
    const quantityStr = String(token.quantity || '0')
      .replace(/,/g, '')
      .replace(/\s/g, '');
    const tokenAmount = parseFloat(quantityStr);
    if (!tokenAmount || tokenAmount <= 0 || isNaN(tokenAmount)) return;

    // Find full token info to check policy_id
    const fullToken = props.tokens.find(
      t => t.ticker === token.ticker || t.unit === token.unit || t.metadata?.ticker === token.ticker
    );

    // Calculate ADA amount for native token (quantity already in ADA, not lovelace)
    // Check by ticker match or policy_id === '' (empty policy_id means native token)
    const isNativeToken =
      token.ticker === nativeTicker ||
      fullToken?.policy_id === '' ||
      token.policy_id === '' ||
      !token.unit ||
      token.unit === '';

    if (isNativeToken) {
      totalAda += tokenAmount;
    } else {
      // For non-native tokens: get price in ADA and calculate equivalent
      const tokenPriceInAda = getTokenPriceInAda(token);
      totalAdaEquivalent += tokenAmount * tokenPriceInAda;
    }

    // Get token price in USD for USD/EUR totals
    const tokenPriceUsd = getTokenPriceInUsd(token);
    totalUsd += tokenAmount * tokenPriceUsd;
  });

  // Convert to EUR
  const totalEur = convertFiat(totalUsd, true);

  // Total ADA = native ADA amount + equivalent ADA from other tokens
  const totalAdaAll = totalAda + totalAdaEquivalent;

  return {
    totalAda,
    totalAdaEquivalent,
    totalAdaAll,
    totalUsd,
    totalEur,
    formattedAda: totalAdaAll > 0 ? filters.toCurrency(totalAdaAll * 1e6, false, 6, '\u20B3', '', false, 6) : '\u20B30',
    formattedUsd:
      totalUsd > 0
        ? `\u2248 $${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '\u2248 $0.00',
    formattedEur:
      totalEur > 0
        ? `\u20AC${totalEur.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '\u20AC0.00',
  };
});

function getAvailableTokens(currentIndex: number) {
  const currentSelected = tokenModel.value[currentIndex];
  // Collect tickers that have been selected in other selectors
  const selectedTickers = tokenModel.value
    .filter((token: any, index: number) => index !== currentIndex && token)
    .map((token: any) => token.ticker);

  return props.tokens.filter((token: any) => {
    // Always include the token already selected in the current selector.
    if (currentSelected && token.ticker === currentSelected.ticker) {
      return true;
    }
    // Otherwise, include tokens not selected elsewhere.
    return !selectedTickers.includes(token.ticker);
  });
}

function formatBalance(token: any): string {
  if (!token) return '0';
  if (token.decimals) {
    return filters.toCurrency(token.balance, false, 2, '', '', true, token.decimals);
  }
  return String(token.balance || 0);
}

function formatTokenValue(token: any): string {
  const quantityStr = String(token.quantity || '0').replace(/,/g, '').replace(/\s/g, '');
  const qty = parseFloat(quantityStr);
  if (!qty || qty <= 0 || isNaN(qty)) return '0.00';
  const priceUsd = getTokenPriceInUsd(token);
  const value = qty * priceUsd;
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function onQuantityInput(index: number, val: string) {
  const updatedTokens = [...tokenModel.value];
  updatedTokens[index] = { ...updatedTokens[index], quantity: val };
  tokenModel.value = updatedTokens;
}

function setMinimum(token: any) {
  if (!props.value?.minAda) return;
  const updatedTokens = [...tokenModel.value];
  const idx = updatedTokens.findIndex((t: any) => t.ticker === token.ticker);
  if (idx >= 0) {
    updatedTokens[idx] = { ...updatedTokens[idx], quantity: String(props.value.minAda) };
    tokenModel.value = updatedTokens;
  }
}

function decreaseQuantityToSend(item: any) {
  if (item.toSendQuantity > 1) {
    item.toSendQuantity--;
  }
}

function increaseQuantityToSend(item: any) {
  if (item.toSendQuantity < item.quantity) {
    item.toSendQuantity++;
  }
}

function removeTokenSelector(index: number) {
  const updatedTokens = [...tokenModel.value];
  updatedTokens.splice(index, 1);
  tokenModel.value = updatedTokens;
}

function addSpecificToken(token: any) {
  tokenModel.value = [...tokenModel.value, { ...token, quantity: '0' }];
}

function swapToken(index: number, newToken: any) {
  const updatedTokens = [...tokenModel.value];
  updatedTokens[index] = { ...newToken, quantity: updatedTokens[index]?.quantity || '0' };
  tokenModel.value = updatedTokens;
}

function formatTokenBalance(token: any): string {
  if (!token?.balance) return '0';
  return filters.toCurrency(token.balance, false, 2, '', '', true, token.decimals);
}

// Legacy addToken — kept for backward compatibility with non-compact consumers
function _addToken() {
  const existingTickers = tokenModel.value.map((token: any) => token?.ticker);
  const missing = props.tokens.filter((token: any) => !existingTickers.includes(token.ticker));
  if (missing.length > 0) {
    tokenModel.value = [...tokenModel.value, missing[0]];
  }
}

function setMax(index: number) {
  emit('setMax', index);
}

function removeCollectible(index: number) {
  const updated = [...selectedCollectibles.value];
  updated.splice(index, 1);
  selectedCollectibles.value = updated;
}

/** Called by the parent when the collectibles dialog emits updated selections */
function updateCollectibles(newCollectibles: any[]) {
  selectedCollectibles.value = newCollectibles;
}

function handleImageError(event: Event, token: any) {
  const target = event.target as HTMLImageElement;
  target.onerror = null;
  if (token.fallback_img) {
    target.src = token.fallback_img;
  }
}

watch(
  selectedCollectibles,
  (newVal) => {
    newVal.forEach((collectible: any) => {
      if (collectible.toSendQuantity > collectible.quantity) {
        collectible.toSendQuantity = collectible.quantity;
      } else if (collectible.toSendQuantity < 1) {
        collectible.toSendQuantity = 1;
      }
    });
    emit('input', {
      ...props.value,
      selectedCollectibles: newVal,
    });
  },
  {
    deep: true,
  }
);

onMounted(() => {
  const currencyTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);
  const foundAsset = props.tokens.find((token: any) => token.ticker === currencyTicker);
  if (foundAsset) {
    foundAsset.verified = true;
    selectedTokens.value = [foundAsset];
  }
});

// Expose for parent access
defineExpose({ collections, selectedCollectibles, updateCollectibles, decreaseQuantityToSend, increaseQuantityToSend, getAvailableTokens });
</script>

<style scoped>
.assets-to-send {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.token-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

/* ─── Token row ─── */
.token-row-wrapper {
  margin-bottom: 6px;
}

.token-row {
  display: flex;
  align-items: center;
  background: #161B26;
  border-radius: 10px;
  padding: 8px 12px;
  gap: 8px;
}

.token-row__left {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  min-width: 0;
}

.token-ticker {
  font-size: 13px;
  font-weight: 600;
  color: white;
  white-space: nowrap;
}

.token-row__right {
  display: flex;
  align-items: center;
  flex: 1;
  justify-content: flex-end;
  gap: 4px;
  min-width: 0;
}

.amount-input {
  max-width: 140px;
  flex-shrink: 1;
}

.amount-input :deep(.v-input__slot) {
  background-color: transparent !important;
  border: none !important;
  min-height: 28px !important;
  padding: 0 4px !important;
}

.amount-input :deep(input) {
  text-align: right;
  font-size: 16px;
  font-weight: 500;
  color: white;
  padding: 0;
}

/* Hide number input spinners */
.amount-input :deep(input::-webkit-outer-spin-button),
.amount-input :deep(input::-webkit-inner-spin-button) {
  -webkit-appearance: none;
  margin: 0;
}

.amount-input :deep(input[type='number']) {
  -moz-appearance: textfield;
}

.amount-input :deep(fieldset) {
  border: none !important;
}

.max-btn {
  text-transform: none !important;
  letter-spacing: 0 !important;
  font-size: 11px !important;
  font-weight: 700 !important;
  min-width: 0 !important;
  padding: 0 4px !important;
  height: 22px !important;
}

.remove-btn {
  flex-shrink: 0;
  margin-left: -4px;
}

/* ─── Token meta (balance + price) ─── */
.token-meta {
  display: flex;
  justify-content: space-between;
  padding: 2px 12px 0;
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}

.token-meta__price {
  color: rgba(255, 255, 255, 0.35);
}

/* ─── Validation errors ─── */
.token-error {
  font-size: 11px;
  color: #F97066;
  padding: 2px 12px 0;
}

.token-error--clickable {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
}

.token-error--clickable:hover {
  color: #fb8a80;
}

/* ─── Add asset row ─── */
.add-asset-row {
  display: flex;
  justify-content: flex-start;
  gap: 8px;
  padding: 4px 0 2px;
}

.add-asset-btn {
  text-transform: none !important;
  letter-spacing: 0 !important;
  font-size: 12px !important;
  padding: 0 6px !important;
  height: 26px !important;
}

/* ─── Token picker dropdown ─── */
.token-selector-trigger {
  display: flex;
  align-items: center;
  cursor: pointer;
  padding: 2px 4px;
  border-radius: 6px;
  transition: background-color 0.15s ease;
}

.token-selector-trigger:hover {
  background-color: rgba(255, 255, 255, 0.06);
}

.token-picker-list {
  background: #0c0e12 !important;
  border: 1px solid rgba(255, 255, 255, 0.12) !important;
  border-radius: 10px !important;
  min-width: 240px;
}

/* ─── NFT chips ─── */
.nft-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  padding: 4px 0;
}

.nft-chip {
  background-color: rgba(255, 255, 255, 0.06) !important;
  border: 1px solid rgba(255, 255, 255, 0.1);
  font-size: 11px;
  color: #CECFD2;
}

.nft-chip__qty {
  color: #00DFF3;
  font-size: 10px;
  font-weight: 600;
}

/* ─── Total line ─── */
.total-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 4px 2px;
  border-top: 1px solid rgba(255, 255, 255, 0.06);
  margin-top: 4px;
}

.total-label {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}

.total-values {
  text-align: right;
}

.total-ada {
  font-size: 13px;
  font-weight: 600;
  color: #00DFF3;
  display: block;
  line-height: 1.2;
}

.total-fiat {
  font-size: 11px;
  color: rgba(255, 255, 255, 0.4);
}
</style>
