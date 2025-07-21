<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" :min-height="300" :height="600" :width="480" title="Select a Token" subtitle="">
    <v-card-title class="pa-0 px-2">
      <v-text-field
        v-model="search"
        placeholder="Search by name, ticker or policy"
        outlined
        prepend-inner-icon="mdi-magnify"
        @input="onSearchInput"
        :loading="searchLoading"
      ></v-text-field>
    </v-card-title>

    <v-card-title class="pa-0 px-2 pb-2" v-if="favoriteTokens.length">
      <v-chip
        v-for="(unit, index) in favoriteTokens"
        :key="index"
        class="pl-1 pr-2 mx-1 mb-1"
      >
        <v-avatar class="mr-1">
          <v-img :src="resolveToken(unit)['img']" />
        </v-avatar>
        {{ resolveToken(unit)['ticker'] }}
      </v-chip>
    </v-card-title>

    <v-card-text class="pb-0 px-2">
      <v-virtual-scroll
        :bench="0"
        :items="filteredTokens"
        height="300"
        item-height="64"
      >
        <template v-slot:default="{ item }">
          <v-list-item :key="item.name" @click="onChange(item)">
            <v-list-item-action>
              <v-badge
                overlap
                avatar
                color="transparent"
                :offset-y="45"
                v-if="item['verified']"
              >
                <template v-slot:badge>
                  <v-avatar color="transparent" tile >
                    <v-icon small color="primary">
                      mdi-check-decagram
                    </v-icon>
                  </v-avatar>
                </template>
                <v-avatar size="40">
                  <img
                    :src="item['img']"
                    :alt="`${item['ticker']} Logo`"
                    @error="e => { e.target.onerror = null; e.target.src = item.fallback_img }"
                  />
                </v-avatar>
              </v-badge>
              <v-avatar size="40" v-else>
                <img
                  :src="item['img']"
                  :alt="`${item['ticker']} Logo`"
                  @error="e => { e.target.onerror = null; e.target.src = item.fallback_img }"
                />
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
            <v-list-item-content class="text-right" v-if="item['balance']">
              <v-list-item-title>
                {{ filters.toCurrency(item['balance'], false, 0, '', ' ' + item['ticker'], true, item['decimals']) }}
              </v-list-item-title>
            </v-list-item-content>
            <v-list-item-action>
              <v-btn
                icon
                @click.stop="toggleFavoriteToken(item)"
                v-if="item['unit']"
              >
                <v-icon>{{ favoriteTokens.includes(item['unit']) ? 'mdi-star' : 'mdi-star-outline' }}</v-icon>
              </v-btn>
            </v-list-item-action>
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
import { walletStore } from '@/stores/walletStore';
import { networkStore } from '@/stores/networkStore';

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

const emit = defineEmits<{
  close: [];
  input: [token: any];
}>();

const { price } = toRefs(networkStore);
const { pinnedTokens } = toRefs(walletStore);

const search = ref('');
const additional = ref<any[]>([]);
const searchLoading = ref(false);

const favoriteTokens = computed(() => {
  return pinnedTokens.value.filter(unit =>
    props.availableTokens.some(token => token['unit'] === unit)
  );
});

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
  return [...props.availableTokens, ...additional.value].filter(
    token =>
      token['name']?.toLowerCase().includes(lowerCaseSearch) ||
      token['ticker']?.toLowerCase().includes(lowerCaseSearch) ||
      token['policy_id']?.toLowerCase().includes(lowerCaseSearch)
  );
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

const resolveToken = (unit: string) => {
  return props.availableTokens.find(token => token['unit'] === unit);
};

const toggleFavoriteToken = (token: any) => {
  // TODO: Implement without Pinia - functionality temporarily disabled
  console.log('Toggle favorite token:', token);
};

onUnmounted(() => {
  debouncedSearch.cancel();
});
</script>

<style scoped>
/* Add any scoped styles here */
</style>
