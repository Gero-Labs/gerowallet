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
              <v-avatar size="20" class="mr-1">
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
                color="var(--g-accent)"
                class="ml-1"
                style="margin-top: -1px; font-size: 11px;"
              >mdi-check-decagram</v-icon>
              <span class="token-balance">{{ formatBalance(token) }}</span>
            </template>
            <!-- Non-native token (clickable to swap) -->
            <template v-else>
              <v-menu offset-y max-height="240" min-width="240">
                <template v-slot:activator="{ on, attrs }">
                  <div class="token-selector-trigger" v-bind="attrs" v-on="on">
                    <v-avatar size="20" class="mr-1">
                      <img
                        :src="token.img"
                        :alt="token.ticker"
                        @error="handleImageError($event, token)"
                      />
                    </v-avatar>
                    <span class="token-ticker">{{ token.ticker }}</span>
                    <v-icon x-small class="ml-1" style="opacity: 0.4; font-size: 11px;">mdi-chevron-down</v-icon>
                  </div>
                </template>
                <v-list dense dark class="token-picker-list">
                  <v-list-item
                    v-for="(available, aidx) in getAvailableTokens(index)"
                    :key="available.unit || `avail-${aidx}`"
                    @click="swapToken(index, available)"
                  >
                    <v-avatar size="20" class="mr-2">
                      <img :src="available.img" :alt="available.ticker" />
                    </v-avatar>
                    <v-list-item-content>
                      <v-list-item-title style="font-size: 12px;">{{ available.ticker }}</v-list-item-title>
                    </v-list-item-content>
                    <v-list-item-action style="margin: 0; min-width: auto;">
                      <span style="font-size: 11px; color: var(--g-text-3);">
                        {{ formatTokenBalance(available) }}
                      </span>
                    </v-list-item-action>
                  </v-list-item>
                </v-list>
              </v-menu>
              <span class="token-balance">{{ formatBalance(token) }}</span>
            </template>
          </div>
          <div class="token-row__right">
            <v-text-field
              :value="formatQuantityDisplay(token.quantity)"
              @input="onQuantityInput(index, $event)"
              @keydown="blockNonNumeric"
              @paste="onPasteNumeric"
              type="text"
              outlined
              dense
              hide-details
              class="amount-input"
              placeholder="0"
              inputmode="decimal"
            />
            <v-btn
              text
              x-small
              color="var(--g-accent)"
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
            <v-icon x-small color="var(--g-text-3)">mdi-close</v-icon>
          </v-btn>
        </div>

        <!-- Validation: insufficient funds -->
        <!-- Validation: minimum ADA required. Checked BEFORE the generic shortage so the
             actionable message wins — it names the exact figure and is click-to-fill.
             It used to be the v-else-if, so any shortage (including one parsed out of a
             Nexus 400) swallowed it and the user saw a bare "Insufficient balance" while
             the wallet already knew the number. -->
        <div
          v-if="index === 0 && value && value.minAda > 0 && value.minAda > Number(token.quantity)"
          class="token-error token-error--clickable"
          @click="setMinimum(token)"
        >
          {{ $t('assets.minRequired', { amount: value.minAda + ' ' + token.ticker }) }}
        </div>

        <!-- Shortage: quote the figure when we parsed one out of the build error, rather
             than a bare "Insufficient balance" that leaves the user guessing. -->
        <div
          v-else-if="index === 0 && value && value.adaShortage > 0"
          class="token-error"
        >
          {{ value.adaShortage > 0
            ? $t('send.insufficientBalanceBy', { amount: value.adaShortage })
            : $t('send.insufficientBalance') }}
        </div>

        <!-- Info: ADA locked for native tokens in wallet -->
        <div
          v-if="index === 0 && lockedAdaForTokens > 0 && Number(token.quantity) > 0"
          class="token-info"
        >
          <v-icon x-small color="warning" style="margin-top: -1px;" class="mr-1">mdi-lock-outline</v-icon>
          {{ lockedAdaForTokens.toFixed(2) }} {{ token.ticker }} {{ $t('wallet.lockedForTokens') }}
        </div>

        <!-- Info: ADA auto-set to min UTxO for tokens -->
        <div v-if="index === 0 && isAutoMinAda" class="token-info">
          <v-icon x-small color="warning" class="mr-1" style="margin-top: -1px;">mdi-information-outline</v-icon>
          {{ $t('wallet.adaRequiredForTokens') }}
        </div>
      </div>
    </div>

    <!-- Add token / NFT row -->
    <div class="add-asset-row">
      <div style="gap: 8px; display: flex;">
        <!-- Add token picker -->
        <v-menu offset-y max-height="320" min-width="280" v-if="missingTokens.length > 0">
          <template v-slot:activator="{ on, attrs }">
            <v-btn text x-small color="var(--g-accent)" v-bind="attrs" v-on="on" class="add-asset-btn">
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
                <span style="font-size: 11px; color: var(--g-text-3);">
                  {{ formatTokenBalance(token) }}
                </span>
              </v-list-item-action>
            </v-list-item>
          </v-list>
        </v-menu>
        <!-- Add NFT button -->
        <v-btn
          v-if="collectiblesCount > 0"
          text x-small color="var(--g-accent)"
          class="add-asset-btn"
          @click="$emit('openCollectiblesDialog')"
        >
          <v-icon x-small class="mr-1">mdi-plus</v-icon>
          {{ $t('assets.addCollectibleLabel') }}
        </v-btn>
      </div>
      <!-- Send entire wallet -->
      <div v-if="missingTokens.length > 0 || collectiblesCount > 0" class="send-all-row">
        <v-btn
          text x-small
          color="var(--g-accent)"
          class="send-all-btn"
          @click="sendEntireWallet()"
        >
          <v-icon x-small class="mr-1">mdi-send-variant-outline</v-icon>
          {{ $t('wallet.sendEntireWallet') }}
        </v-btn>
      </div>
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

  </div>
</template>

<script setup lang="ts">
/* eslint-disable @typescript-eslint/no-explicit-any */
import { toRefs, computed, watch, onMounted, ref, nextTick } from 'vue';
import networks from '@/utils/networks';
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';
import { priceStore } from '@/stores/priceStore';
import { tokenMetadataStore } from '@/stores/tokenMetadataStore';
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
const emit = defineEmits(['input', 'setMax', 'openCollectiblesDialog', 'sendEntireWallet']);

const { loggedWallet, collections: resolvedCollections } = toRefs(walletStore);
const { price } = toRefs(networkStore);

const selectedCollectibles = ref<any[]>([]);
const search = ref<string>('');
const selectedTokens = ref<any[]>([]);
const isAutoMinAda = ref<boolean>(false);

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
  if (unit && tokenMetadataStore.tokens[unit]) {
    const priceInAda = tokenMetadataStore.tokens[unit].price || 0;
    const adaPriceUsd = priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0;
    return priceInAda * adaPriceUsd;
  }

  // Fallback to last_price if available
  return token.last_price || fullToken?.last_price || 0;
}

const missingTokens = computed(() => {
  // Must read from tokenModel (which mirrors props.value.selectedTokens), not
  // the local selectedTokens ref — the latter is only seeded on mount and
  // never updated, so it wrongly reports tokens already added as "missing"
  // and sendEntireWallet ends up pushing duplicates that over-commit balance.
  const existingUnits = new Set<string>();
  const existingTickers = new Set<string>();
  for (const tk of tokenModel.value) {
    if (tk?.unit) existingUnits.add(tk.unit);
    if (tk?.ticker) existingTickers.add(tk.ticker);
  }
  return props.tokens.filter(
    (token: any) => !(token.unit && existingUnits.has(token.unit)) && !existingTickers.has(token.ticker)
  );
});

const tokenModel = computed({
  get() {
    return props.value?.selectedTokens || [];
  },
  set(newTokens) {
    // Preserve whatever the parent already tracks for collectibles — our
    // local `selectedCollectibles` ref mirrors the select-dialog state and
    // is stale after send-entire-wallet (which populates the parent's
    // recipient directly via a UTxO scan). Emitting it here would wipe the
    // parent's authoritative list and strand assets in change.
    emit('input', {
      ...props.value,
      selectedTokens: newTokens,
      selectedCollectibles: props.value?.selectedCollectibles ?? selectedCollectibles.value,
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
  if (unit && tokenMetadataStore.tokens[unit]) {
    return tokenMetadataStore.tokens[unit].price || 0;
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
/** ADA locked as min UTxO for native tokens remaining in wallet change output */
const lockedAdaForTokens = computed(() => props.value?.lockedForTokens || 0);

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
    formattedAda: totalAdaAll > 0 ? filters.toCurrency(totalAdaAll * 1e6, false, 6, '₳', '', false, 6) : '₳0',
    formattedUsd:
      totalUsd > 0
        ? `≈ $${totalUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '≈ $0.00',
    formattedEur:
      totalEur > 0
        ? `€${totalEur.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
        : '€0.00',
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
  // Find the matching token in props.tokens which has the adjusted balance
  // (total minus what other recipients have committed)
  const available = props.tokens.find((t: any) => t.unit === token.unit || t.ticker === token.ticker);
  const balance = available?.balance ?? token.balance;
  if (!balance) return '0';
  if (token.decimals) {
    return filters.toCurrency(balance, false, 2, '', '', true, token.decimals);
  }
  return String(balance);
}

function formatQuantityDisplay(quantity: string | number): string {
  if (!quantity && quantity !== 0) return '';
  const raw = String(quantity).replace(/,/g, '');
  const num = parseFloat(raw);
  if (isNaN(num)) return String(quantity);
  const parts = raw.split('.');
  parts[0] = Number(parts[0]).toLocaleString('en-US');
  return parts.join('.');
}

/** Block non-numeric keys at keydown (before they reach the input) */
function blockNonNumeric(e: KeyboardEvent) {
  // Allow: navigation, delete, backspace, tab, escape, enter, arrows, home, end
  if (['Backspace', 'Delete', 'Tab', 'Escape', 'Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
  // Allow Ctrl/Cmd + A/C/V/X
  if ((e.ctrlKey || e.metaKey) && ['a', 'c', 'v', 'x'].includes(e.key.toLowerCase())) return;
  // Allow decimal point (only one)
  if (e.key === '.') {
    const target = e.target as HTMLInputElement;
    if (target.value.includes('.')) e.preventDefault();
    return;
  }
  // Block anything that's not a digit
  if (!/^[0-9]$/.test(e.key)) {
    e.preventDefault();
  }
}

/** Strip non-numeric chars from pasted content */
function onPasteNumeric(e: ClipboardEvent) {
  e.preventDefault();
  const text = e.clipboardData?.getData('text') || '';
  const cleaned = text.replace(/[^0-9.]/g, '').replace(/(\..*?)\./g, '$1');
  const target = e.target as HTMLInputElement;
  const start = target.selectionStart ?? 0;
  const end = target.selectionEnd ?? 0;
  const current = target.value;
  const newVal = current.slice(0, start) + cleaned + current.slice(end);
  target.value = newVal;
  target.dispatchEvent(new Event('input'));
}

function onQuantityInput(index: number, val: string) {
  const cleaned = val.replace(/[^0-9.]/g, '').replace(/(\..*?)\./g, '$1');
  const updatedTokens = [...tokenModel.value];
  updatedTokens[index] = { ...updatedTokens[index], quantity: cleaned };
  tokenModel.value = updatedTokens;
  // Clear auto-min flag when user manually edits ADA amount
  if (index === 0) isAutoMinAda.value = false;
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

/** Auto-set ADA to min UTxO if ADA quantity is 0 and a non-ADA token/NFT is present */
function autoSetMinAda() {
  const adaToken = tokenModel.value[0];
  if (adaToken && Number(adaToken.quantity) === 0 && props.value?.minAda > 0) {
    const updatedTokens = [...tokenModel.value];
    updatedTokens[0] = { ...updatedTokens[0], quantity: String(props.value.minAda) };
    tokenModel.value = updatedTokens;
    isAutoMinAda.value = true;
  }
}

/** Add all tokens at full balance + all NFTs, then trigger MAX ADA */
function sendEntireWallet() {
  // Max out EVERY token in the recipient (including ones already present at
  // qty 0 from manual "add") and append every token missing so far. Using
  // plain math for the smallest-unit → decimal conversion — filters.toCurrency
  // rounds to max 2 decimals when decimalPlaces isn't 4 or 6, which would
  // overstate tokens like AGIX (8 decimals) and make Nexus reject the tx.
  const nativeTickerLocal = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);
  const toDecimal = (balance: unknown, decimals: unknown) => {
    const dec = Number(decimals) || 0;
    return dec > 0 ? Number(balance) / Math.pow(10, dec) : Number(balance);
  };
  const allTokens = tokenModel.value.map((tk: any) => {
    if (tk?.ticker === nativeTickerLocal) return tk; // ADA handled separately by max-ada
    const full = props.tokens.find((t: any) => t.unit === tk.unit) || tk;
    return { ...tk, quantity: String(toDecimal(full.balance ?? tk.balance, tk.decimals)) };
  });
  for (const token of missingTokens.value) {
    allTokens.push({ ...token, quantity: String(toDecimal(token.balance, token.decimals)) });
  }
  tokenModel.value = allTokens;

  // Build the set of units already represented in tokens so we never emit the
  // same asset through both the token list AND the collectible list — Nexus
  // would otherwise see the combined quantity and reject it as exceeding the
  // wallet balance ("Insufficient token balance for asset ...").
  const tokenUnits = new Set<string>();
  for (const tk of allTokens) {
    if (tk?.unit) tokenUnits.add(tk.unit);
  }

  // Add all collectibles, excluding anything already represented as a token.
  // Always derive `unit` from policy_id + asset_name when missing so the
  // output emitter doesn't silently drop the asset (which would leave it in
  // the change output and defeat "send entire wallet").
  const allCollectibles: any[] = [];
  for (const collection of Object.values(resolvedCollections.value)) {
    const items = (collection as any)?.items;
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      const unit = item.unit || ((item.policy_id || '') + (item.asset_name || ''));
      if (!unit) continue;
      if (tokenUnits.has(unit)) continue;
      // Send the FULL on-chain quantity for each NFT/collectible — otherwise
      // a previously-set partial toSendQuantity would leave the remainder in
      // change and defeat "send entire wallet".
      const maxQty = Number(item.quantity) || 1;
      item.toSendQuantity = maxQty;
      allCollectibles.push({ ...item, unit, toSendQuantity: maxQty });
    }
  }
  selectedCollectibles.value = allCollectibles;
  // Always emit the final snapshot (tokens + collectibles together) so the
  // parent's recipient state matches what sendEntireWallet intended — any
  // earlier emit from tokenModel's setter used a stale collectibles value.
  emit('input', {
    ...props.value,
    selectedTokens: allTokens,
    selectedCollectibles: allCollectibles,
  });

  // Trigger MAX ADA — since all tokens/NFTs are now included, no change output needed
  emit('sendEntireWallet');
}

async function addSpecificToken(token: any) {
  tokenModel.value = [...tokenModel.value, { ...token, quantity: '0' }];
  autoSetMinAda();
  await nextTick();
  // Focus the last amount input
  const inputs = document.querySelectorAll('.amount-input input');
  const lastInput = inputs[inputs.length - 1] as HTMLInputElement;
  lastInput?.focus();
  lastInput?.select();
}

function swapToken(index: number, newToken: any) {
  const updatedTokens = [...tokenModel.value];
  updatedTokens[index] = { ...newToken, quantity: updatedTokens[index]?.quantity || '0' };
  tokenModel.value = updatedTokens;
  autoSetMinAda();
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
    if (newVal.length > 0) autoSetMinAda();
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
defineExpose({ collections, selectedCollectibles, updateCollectibles, decreaseQuantityToSend, increaseQuantityToSend, getAvailableTokens, totalAmounts, lockedAdaForTokens, isAutoMinAda });
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
  margin-bottom: 4px;
}

.token-row {
  display: flex;
  align-items: center;
  background: var(--g-raised);
  border-radius: var(--g-r-control);
  padding: 6px 10px;
  gap: 6px;
}

.token-row__left {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  min-width: 0;
}

.token-ticker {
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-1);
  white-space: nowrap;
}

.token-balance {
  font-size: 11px;
  color: var(--g-text-3);
  margin-left: 6px;
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
  font-size: 14px;
  font-weight: 500;
  color: var(--g-text-1);
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

/* ─── Info: locked ADA ─── */
.token-info {
  font-size: 11px;
  color: var(--g-warning);
  padding: 2px 10px 0;
  display: flex;
  align-items: center;
}

/* ─── Validation errors ─── */
.token-error {
  font-size: 11px;
  color: var(--g-error);
  padding: 2px 12px 0;
}

.token-error--clickable {
  cursor: pointer;
  text-decoration: underline;
  text-decoration-style: dotted;
}

.token-error--clickable:hover {
  color: var(--g-error);
}

/* ─── Add asset row ─── */
/* ─── Send entire wallet ─── */
.send-all-row {
  display: flex;
  justify-content: flex-end;
  padding: 2px 0;
}

.send-all-btn {
  text-transform: none !important;
  letter-spacing: 0 !important;
  font-size: 11px !important;
  padding: 0 6px !important;
  height: 22px !important;
}

.add-asset-row {
  display: flex;
  justify-content: space-between;
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
  border-radius: var(--g-r-control);
  transition: background-color 0.15s ease;
}

.token-selector-trigger:hover {
  background-color: var(--g-hairline-1);
}

.token-picker-list {
  background: var(--g-surface) !important;
  border: 1px solid var(--g-hairline-2) !important;
  border-radius: var(--g-r-control) !important;
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
  background-color: var(--g-hairline-1) !important;
  border: 1px solid var(--g-hairline-2);
  font-size: 11px;
  color: var(--g-text-2);
}

.nft-chip__qty {
  color: var(--g-accent);
  font-size: 11px;
  font-weight: 600;
}

/* ─── Total line ─── */
.total-line {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 4px 2px;
  border-top: 1px solid var(--g-hairline-1);
  margin-top: 4px;
}

.total-label {
  font-size: 11px;
  color: var(--g-text-3);
}

.total-values {
  text-align: right;
}

.total-ada {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-accent);
  display: block;
  line-height: 1.2;
}

.total-fiat {
  font-size: 11px;
  color: var(--g-text-3);
}
</style>
