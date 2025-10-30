<template>
  <v-card flat v-if="amount" class="tx-card transparent" :class="{ risk: risk }">
    <div class="tx-header">
      <slot />
    </div>
    <v-card flat :class="withBg ? 'tx-details bg' : 'tx-details'">
      <div class="provider">{{ amount?.provider }}</div>
      <div class="total">{{ toCurrency(amount?.total, true, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</div>
      <div class="assets mr-1" v-if="amount?.assets?.length">Assets:</div>
      <div v-if="amount?.assets?.length">
        <div v-for="(asset, index) in shownAssets" :key="asset.currency" class="asset-entry">
          <div class="pr-1"></div>
          <div>
            <v-chip pill small class="px-1" outlined :key="`asset_${index}`" :color="risk ? 'error' : 'primary'" style="margin: 2px!important;">
              <v-avatar v-if="asset.img" left>
                <v-img :src="asset.img" :alt="`${asset.currency} Logo`" contain>
                  <template v-slot:placeholder>
                    <v-row
                      class="fill-height ma-0"
                      align="center"
                      justify="center"
                    >
                      <v-progress-circular
                        size="14"
                        width="2"
                        indeterminate
                        color="grey lighten-5"
                      ></v-progress-circular>
                    </v-row>
                  </template>
                </v-img>
              </v-avatar>
              {{ toCurrency(asset.amount, false, 0, '', ` ${getAssetName(asset.currency)}`, false, decimals(asset?.id)) }}
            </v-chip>
          </div>
        </div>
        <a v-if="hiddenAssets" class="asset-entry" @click="toggleAllAssets()">
          {{ hiddenAssets }} more types of collectibles
        </a>
      </div>
    </v-card>
    <div class="tx-footer" v-if="amount.txFee">
      <template>
        Tx Fee<span class="ml-1"> {{ toCurrency(0 - amount?.txFee, true, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</span>
      </template>
    </div>
  </v-card>
</template>
<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, watch, onMounted, toRefs } from 'vue';
import filters from '@/shared/utils/filters';
import networks from '@/utils/networks';
import { walletStore } from '@/stores/walletStore';
import { Cardano } from '@cardano-sdk/core';


const { t } = useTranslation();

const props = defineProps({
  risk: {
    type: Boolean,
  },
  transaction: {
    type: Object,
  },
  withBg: {
    type: Boolean,
    default: true
  }
});

const { loggedWallet, tokens } = toRefs(walletStore);

const amount = ref<any>(undefined);
const showAllAssets = ref(true);
const hiddenAssets = ref(0);
const shownAssets = ref<any[]>([]);

const { toCurrency } = filters;

const decimals = (unit: string) => {
  let decimals = 0;
  if (unit && tokens.value && tokens.value[unit] && tokens.value[unit].metadata) {
    decimals = tokens.value[unit].metadata.decimals;
  }
  return decimals;
};

const getAssetName = (assetId: any) => {
  const assetName = Cardano.AssetId.getAssetName(assetId);
  return Cardano.AssetName.toUTF8(assetName, true);
}

const toggleAllAssets = () => {
  showAllAssets.value = !showAllAssets.value;
};

const updateAssets = (newVal: any) => {
  amount.value = newVal;
  if (amount.value?.assets?.length < 5) {
    shownAssets.value = amount.value?.assets;
    hiddenAssets.value = 0;
  } else {
    shownAssets.value = amount.value?.assets.slice(0, 5);
    hiddenAssets.value = amount.value?.assets.length - 5;
  }
};

watch(() => props.transaction, (newVal) => {
  updateAssets(newVal);
}, { deep: true });

onMounted(() => {
  showAllAssets.value = false;
  updateAssets(props.transaction);
});
</script>
<style scoped lang="scss">

.tx-header {
  height: 24px;
  display: flex;
  align-items: center;

  font-size: 14px;
  font-weight: 400;
  line-height: 21px;
  color: var(--v-primary-base);

  & > img {
    margin-left: 4px;
  }
}

.tx-details {
  background-color: #0F0F0F !important;
  border: 1px solid #272930 !important;
  border-radius: 10px;
  padding: 8px;
  display: grid;
  grid-template-columns: 1fr 6fr;
  grid-auto-rows: minmax(32px, auto);

  .bg {
    background: linear-gradient(93.33deg, #000000 6.91%, #006a57 185.93%);
  }

  .total,
  .assets,
  .provider {
    display: flex;
  }

  .assets,
  .provider {
    color: white;
    grid-column: 1;

    font-size: 14px;
    font-weight: 400;
    line-height: 14px;
    text-align: left;
    justify-content: flex-start;
  }

  .total,
  .provider {
    align-items: center;
  }

  .assets {
    align-items: flex-start;
  }

  .total {
    grid-column: 2/6;

    color: var(--v-primary-base);

    font-size: 20px;
    font-weight: 400;
    line-height: 20px;
    text-align: right;
    justify-content: flex-end;

    & > span {
      font-size: 14px;
      font-weight: 400;
      line-height: 14px;
    }
  }
}

.asset-entry {
  display: flex;
  align-items: center;
  justify-content: space-between;

  color: var(--v-primary-base);

  font-size: 14px;
  font-weight: 400;
  line-height: 13px;

  & > div {
    color: inherit;

    &:first-child {
      text-align: left;
    }

    &:last-child {
      text-align: right;
    }
  }

  & > .asset-name {
    font-size: 14px;
    font-weight: 400;
    line-height: 21px;
  }

  & > .asset-amount {
    font-size: 14px;
    font-weight: 400;
    line-height: 21px;
  }
}

a.asset-entry {
  cursor: pointer;
  text-decoration: underline;
  color: var(--v-anchor-base);

  &:hover {
    filter: brightness(150%) !important;
  }
}

.tx-footer {
  height: 24px;
  display: block;
  padding: 4px 10px;

  color: white;
  font-size: 12px;
  font-weight: 400;
  line-height: 18px;
  text-align: right;

  & > span {
    color: var(--v-error-base);
  }
}

.tx-card.risk {
  .tx-header {
    color: var(--v-error);
  }

  .tx-details {

    .total {
      color: var(--v-error-base);
    }
  }

  .asset-entry {
    color: var(--v-error-base);
  }
}
</style>
