<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    :min-height="300"
    :height="600"
    :width="480"
    :title="$t('common.selectToken')"
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
                  <img :src="item['img']" :alt="`${item['ticker']} Logo`" @error="e => handleImageError(e, item)" />
                </v-avatar>
              </v-badge>
              <v-avatar size="40" v-else>
                <img :src="item['img']" :alt="`${item['ticker']} Logo`" @error="e => handleImageError(e, item)" />
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
                {{ convertFiat(item['balance']) }}
              </v-list-item-title>
              <v-list-item-subtitle v-if="item['price'] && item['price'] > 0">
                {{ '~' + getCurrencySymbol() + convertFiat(item['price']).toFixed(4) }}
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
import { networkStore } from '@/stores/networkStore';
import { priceStore } from '@/stores/priceStore';
import { dexHunterStore } from '@/stores/dexHunterStore';
import { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';

interface Props {
  value?: any;
  isOpen?: boolean;
  availableTokens?: any[];
  searchMechanism?: Function;
}

const props = withDefaults(defineProps<Props>(), {
  isOpen: false,
  availableTokens: () => [],
});

const emit = defineEmits(['close', 'input']);

const { price } = toRefs(networkStore);
const { loggedWallet } = toRefs(walletStore);
const { convertFiat, getCurrencySymbol } = useCurrencyConverter();

const search = ref('');
const additional = ref<any[]>([]);
const searchLoading = ref(false);

// Get token price in USD (same logic as AssetsToSendStep)
function getTokenPriceInUsd(token: any): number {
  if (!token) return 0;

  const nativeTicker = networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network);

  // For native tokens (ADA)
  if (token.ticker === nativeTicker || token.policy_id === '') {
    return priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0;
  }

  // For other tokens: get price from DexHunter (in ADA), convert to USD
  const unit = token.unit;
  if (unit && dexHunterStore.dexHunterTokens[unit]) {
    const priceInAda = dexHunterStore.dexHunterTokens[unit].price || 0;
    const adaPriceUsd = priceStore.adaUsd?.lastPrice || Number(price.value?.lastPrice) || 0;
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

const onChange = (item: any) => {
  selectedToken.value = item;
  emit('close');
};

onUnmounted(() => {
  debouncedSearch.cancel();
});

const handleImageError = (event: Event, item: any) => {
  const target = event.target as HTMLImageElement;
  target.onerror = null;
  target.src = item.fallback_img;
};
</script>

<style scoped>
/* Add any scoped styles here */
</style>
