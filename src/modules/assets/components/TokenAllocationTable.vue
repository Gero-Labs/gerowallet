<template>
  <v-card outlined class="no-gutters fill-height liquid-glass" :loading="loadingTxs">
    <v-card-title>
      Token Allocation
      <v-spacer />
      <v-menu
        v-if="loggedWallet?.chain === Blockchain.CARDANO && loggedWallet?.network === Network.MAINNET"
        v-model="filtersMenu"
        :close-on-content-click="false"
        offset-y
      >
        <template v-slot:activator="{ on, attrs }">
          <v-badge
            :value="filtersAmount"
            :content="filtersAmount"
            bordered
            color="primary"
            dot
            overlap
          >
            <v-btn
              icon
              plain
              v-bind="attrs"
              v-on="on"
            >
              <v-icon>
                mdi-filter
              </v-icon>
            </v-btn>
          </v-badge>
        </template>
        <v-card outlined style="background-color: #1e1e1e!important;">
          <v-card-text class="pa-0">
            <v-list dense class="transparent">
              <v-list-item>
                <v-list-item-action>
                  <v-switch v-model="hideUnverified" inset dense class="mr-5 mt-0" hide-details v-if="loggedWallet?.chain === Blockchain.CARDANO && loggedWallet?.network === Network.MAINNET"/>
                </v-list-item-action>
                <v-list-item-title>
                  Hide Unverified Tokens
                </v-list-item-title>
              </v-list-item>
              <v-list-item>
                <v-list-item-action>
                  <v-switch v-model="hideScam" inset dense class="mr-5 mt-0" hide-details v-if="loggedWallet?.chain === Blockchain.CARDANO && loggedWallet?.network === Network.MAINNET"/>
                </v-list-item-action>
                <v-list-item-title>
                  Hide Scam Tokens
                </v-list-item-title>
              </v-list-item>
              <v-list-item>
                <v-list-item-action>
                  <v-switch v-model="hideUnrated" inset dense class="mr-5 mt-0" hide-details v-if="loggedWallet?.chain === Blockchain.CARDANO && loggedWallet?.network === Network.MAINNET"/>
                </v-list-item-action>
                <v-list-item-title>
                  Hide Unrated Tokens
                </v-list-item-title>
              </v-list-item>
            </v-list>
            <v-divider></v-divider>
          </v-card-text>
          <v-card-actions class="justify-center">
            <v-btn block small color="error" :disabled="filtersAmount === 0" @click="clearFilters">
              <v-icon small class="pr-1">
                mdi-filter-remove
              </v-icon>
              Clear Filters
            </v-btn>
          </v-card-actions>
        </v-card>
      </v-menu>
      <v-tabs class="ml-1" @change="handleSwitchTab" height="30" style="flex: 0 1 auto;width: unset;border-radius: 10px" background-color="transparent">
        <v-tab>
          Assets
         <span style="color: white">&nbsp;{{ `(${tokensCount})` }}</span>
        </v-tab>
        <v-tab :disabled="collectiblesLength === 0">
          Collectibles
          <span style="color: white">&nbsp;{{`(${collectiblesLength})`}}</span>
        </v-tab>
      </v-tabs>
    </v-card-title>
    <v-card-text class="pa-0">
      <v-tabs-items v-model="currentTab" class="transparent">
        <v-tab-item>
          <TokensTab
            :sort-options="sortOptions"
            @update:sort-options="sortOptions = $event"
            :hide-scam="hideScam"
            :hide-unverified="hideUnverified"
            :hide-unrated="hideUnrated"
          />
        </v-tab-item>
        <v-tab-item>
          <CollectiblesTab
            :hide-scam="hideScam"
          />
        </v-tab-item>
      </v-tabs-items>
    </v-card-text>
  </v-card>
</template>
<script setup lang="ts">
import { ref, computed, toRefs, onMounted, watch } from 'vue';
import CollectiblesTab from '@/modules/assets/components/CollectiblesTab.vue';
import TokensTab from '@/modules/assets/components/TokensTab.vue';
import { Blockchain, Network } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { loadingState } from '@/stores/loading';
import { setWalletConfiguration } from '@/db/wallet-db';
import WalletStore from '@/stores/walletStore';

const { loggedWallet, config, collections, tokens } = toRefs(walletStore);
const { loadingTxs } = toRefs(loadingState);

const hideScam = ref<boolean>(false);
const hideUnrated = ref<boolean>(false);
const hideUnverified = ref<boolean>(false);
const sortOptions = ref<any>({
  by: 'allocation',
  desc: true
})
const filtersMenu = ref<boolean>(false);
const currentTab = ref<number>(0);

const assetsSort = computed({
  get() {
    return config.value.tokenAllocationSort || {
      by: 'allocation',
      desc: true
    }
  },
  set(val) {
    setWalletConfiguration(loggedWallet.value.id, 'tokenAllocationSort', val)
  },
})

watch(hideScam, (newVal, _oldVal) => {
  WalletStore.setHideScamTokens(newVal);
})

watch(hideUnverified, (newVal, _oldVal) => {
  WalletStore.setHideUnverifiedTokens(newVal);
})

watch(hideUnrated, (newVal, _oldVal) => {
  WalletStore.setHideUnratedTokens(newVal);
})

watch(sortOptions, (newVal, _oldVal) => {
  assetsSort.value = newVal
}, {
  deep: true
})

// Watch for config changes after initial mount
watch(() => config.value, (newConfig) => {
  if (newConfig) {
    hideScam.value = newConfig.hideScamTokens || false;
    hideUnrated.value = newConfig.hideUnratedTokens || false;
    hideUnverified.value = newConfig.hideUnverifiedTokens || false;
  }
}, { immediate: true })

const handleSwitchTab = (tab) => {
  currentTab.value = tab;
}

const clearFilters = () => {
  hideUnverified.value = false;
  hideScam.value = false;
  hideUnrated.value = false;
}



const filtersAmount = computed(() => {
  let amt = 0
  if (hideScam.value) {
    amt++
  }
  if (hideUnrated.value) {
    amt++
  }
  if (hideUnverified.value) {
    amt++
  }
  return amt
})

const tokensCount = computed(() => {
  return Object.keys(tokens.value).length || 0;
});

const collectiblesLength = computed(() => {
  let amount = 0;
  if (collectibles.value.length > 0) {
    collectibles.value.forEach((collection: any) => {
      if (collection.items) {
        amount += collection.items.length
      }
    })
  }
  return amount
})


const collectibles = computed(() => {
  let res = Object.values(collections.value).filter((collection: any) => collection.items.every(item => !item.metadata))
  if (res && hideScam.value) {
    res = res.filter((collection: any) => !collection.isScam)
  }
  return res
})


onMounted(() => {
  sortOptions.value = assetsSort.value;
  hideScam.value = config.value?.hideScamTokens || false;
  hideUnrated.value = config.value?.hideUnratedTokens || false;
  hideUnverified.value = config.value?.hideUnverifiedTokens || false;
})
</script>
<style>
.badge .v-badge__wrapper {
  margin: 0
}
</style>
