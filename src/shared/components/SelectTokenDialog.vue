<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :min-height="300"
    :height="600"
    :width="480"
    :title="t('common.selectToken')"
    subtitle=""
    :persistent="false"
  >
    <v-card-title class="pa-0 px-2">
      <v-text-field
        v-model="search"
        :placeholder="$t('assets.searchByNameTickerPolicy')"
        outlined
        prepend-inner-icon="mdi-magnify"
        @input="onSearchInput"
        :loading="searchLoading"
      ></v-text-field>
    </v-card-title>

    <v-card-text class="pb-0 px-2">
      <v-virtual-scroll :bench="0" :items="filteredTokens" height="300" item-height="64">
        <template v-slot:default="{ item }">
          <v-list-item :key="item.name" @click="onChange(item)">
            <v-list-item-action>
              <v-badge overlap avatar color="transparent" :offset-y="45" v-if="item['verified']">
                <template v-slot:badge>
                  <v-avatar color="transparent" tile>
                    <v-icon small color="primary"> mdi-check-decagram </v-icon>
                  </v-avatar>
                </template>
                <v-avatar size="40">
                  <img :src="getTokenImage(item)" :alt="`${item['ticker']} Logo`" @error="e => handleImageError(e, item)" />
                </v-avatar>
              </v-badge>
              <v-avatar size="40" v-else>
                <img :src="getTokenImage(item)" :alt="`${item['ticker']} Logo`" @error="e => handleImageError(e, item)" />
              </v-avatar>
            </v-list-item-action>
            <v-list-item-content>
              <v-list-item-title>
                {{ item['name'] }}
              </v-list-item-title>
              <v-list-item-subtitle>
                {{ item['ticker'] }}
              </v-list-item-subtitle>
            </v-list-item-content>
            <v-list-item-content class="text-right">
              <v-list-item-title v-if="item['balance']">
                {{ formatTokenBalance(item) }}
              </v-list-item-title>
              <v-list-item-subtitle v-if="item['price'] && item['price'] > 0">
                {{ formatTokenPrice(item['price']) }}
              </v-list-item-subtitle>
              <v-list-item-subtitle v-else-if="item['price'] === 0"> N/A </v-list-item-subtitle>
            </v-list-item-content>
          </v-list-item>
        </template>
      </v-virtual-scroll>

      <!--      <v-list nav dense class="pa-0 transparent">-->
      <!--        <v-list-item-group v-model="selectedToken" mandatory>-->
      <!--          <v-list-item-->
      <!--            v-for="(item, index) in filteredTokens"-->
      <!--            :key="index"-->
      <!--            :value="item"-->
      <!--            @click="onChange"-->
      <!--          >-->
      <!--            -->
      <!--          </v-list-item>-->
      <!--        </v-list-item-group>-->
      <!--      </v-list>-->
    </v-card-text>
  </BaseDialog>
</template>
<script setup lang="ts">
import { ref, computed, onUnmounted, toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import filters from '@/shared/utils/filters';
import debounce from 'lodash/debounce';
import { priceStore } from '@/stores/priceStore';
import { tokenMetadataStore } from '@/stores/tokenMetadataStore';
import { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useMarketData } from '@/modules/market/composables/useMarketData';

const { t } = useTranslation();

// Token rows reach this dialog from several sources (wallet balances, market
// search results, DexHunter metadata) and carry different field sets, so this
// is the union of what the template and the helpers below actually read.
interface SelectableToken {
  unit?: string;
  ticker?: string;
  name?: string;
  policy_id?: string;
  balance?: number | string;
  decimals?: number;
  last_price?: number;
  quantity?: string;
  metadata?: { decimals?: number };
}

interface Props {
  value?: SelectableToken | null;
  isOpen?: boolean;
  availableTokens?: SelectableToken[];
  searchMechanism?: Function;
}

const props = withDefaults(defineProps<Props>(), {
  isOpen: false,
  availableTokens: () => [],
});

const emit = defineEmits(['close', 'input']);

const { loggedWallet } = toRefs(walletStore);
const { convertFiat, getCurrencySymbol } = useCurrencyConverter();

// Token images come from main-page market data (keyed by unit), not DexHunter.
const { getTokenImage } = useMarketData();
const chainLogo = computed(
  () => networks.resolveCurrencyImage(loggedWallet.value?.chain, loggedWallet.value?.network) || '',
);

const search = ref('');
const additional = ref<SelectableToken[]>([]);
const searchLoading = ref(false);

// Get token price in USD (same logic as AssetsToSendStep)
function getTokenPriceInUsd(token: SelectableToken | null): number {
  if (!token) return 0;

  const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);

  // For native tokens (ADA)
  if (token.ticker === nativeTicker || token.policy_id === '') {
    return priceStore.adaUsd?.lastPrice || 0;
  }

  // For other tokens: get price from DexHunter (in ADA), convert to USD
  const unit = token.unit;
  if (unit && tokenMetadataStore.tokens[unit]) {
    const priceInAda = tokenMetadataStore.tokens[unit].price || 0;
    const adaPriceUsd = priceStore.adaUsd?.lastPrice || 0;
    return priceInAda * adaPriceUsd;
  }

  // Fallback to last_price if available
  return token.last_price || 0;
}

const selectedToken = computed({
  get() {
    return props.value;
  },
  set(newToken) {
    if (newToken && props.availableTokens.length > 0) {
      emit('input', newToken);
    }
  },
});

const filteredTokens = computed(() => {
  const lowerCaseSearch = search.value.toLowerCase();
  const tokens = [...props.availableTokens, ...additional.value].filter(
    token =>
      token['name']?.toLowerCase().includes(lowerCaseSearch) ||
      token['ticker']?.toLowerCase().includes(lowerCaseSearch) ||
      token['policy_id']?.toLowerCase().includes(lowerCaseSearch)
  );

  // Add price to each token
  return tokens.map(token => ({
    ...token,
    price: getTokenPriceInUsd(token),
  }));
});

const performSearch = async () => {
  searchLoading.value = true;
  if (props.searchMechanism) {
    try {
      additional.value = await props.searchMechanism(search.value.toLowerCase());
    } catch (e) {
      console.log(e);
    }
  }
  searchLoading.value = false;
};

const debouncedSearch = debounce(performSearch, 300);

const onSearchInput = () => {
  debouncedSearch();
};

const onChange = (item: SelectableToken) => {
  selectedToken.value = { ...item, quantity: formatTokenBalance(item) };
  emit('close');
};

onUnmounted(() => {
  debouncedSearch.cancel();
});

const handleImageError = (event: Event, _item: SelectableToken) => {
  const target = event.target as HTMLImageElement;
  target.onerror = null;
  // Market-data logo failed to load → fall back to the chain logo.
  target.src = chainLogo.value;
};

// Format token balance: convert from smallest unit to display balance
const formatTokenBalance = (token: SelectableToken | null): string => {
  if (!token || !token.balance) return '0';

  const decimals = token.decimals || token.metadata?.decimals || 6;
  // Convert from smallest unit (Lovelace) to main unit (ADA)
  const balanceInMainUnit = filters.convertFromSmallestUnit(token.balance, decimals);

  // Format balance without currency conversion - show actual token amount
  return balanceInMainUnit.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 6,
  });
};

// Format token price with consistent locale
const formatTokenPrice = (price: number): string => {
  if (!price || price === 0) return 'N/A';

  const fiatPrice = convertFiat(price);
  // Always use en-US locale for consistent formatting
  return (
    '~' +
    getCurrencySymbol() +
    fiatPrice.toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    })
  );
};
</script>

<style scoped>
/* Add any scoped styles here */
</style>
