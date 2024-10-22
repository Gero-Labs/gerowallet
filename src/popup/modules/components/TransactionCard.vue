<template>
  <v-card flat v-if="amount" class="tx-card transparent" :class="{ risk: risk }">
    <div class="tx-header">
      <slot />
    </div>
    <v-card flat :class="withBg ? 'tx-details bg' : 'tx-details'">
      <div class="provider">{{ amount?.provider }}</div>
      <div class="total">{{ amount?.total | toCurrency(true, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</div>
      <div class="assets mr-1" v-if="amount?.assets?.length">Assets:</div>
      <div v-if="amount?.assets?.length">
        <div v-for="asset in shownAssets" :key="asset.currency" class="asset-entry">
          <div>{{ asset.currency }}</div>
          <div>{{ asset.amount | toCurrency(false, 0, '', '', false, decimals(asset?.id)) }}</div>
        </div>
        <a v-if="hiddenAssets" class="asset-entry" @click="toggleAllAssets()">
          {{ hiddenAssets }} more types of collectibles
        </a>
      </div>
    </v-card>

    <div class="tx-footer" v-if="amount.txFee">
      <template>
        Tx Fee<span class="ml-1"> {{ 0 - amount?.txFee | toCurrency(true, 0, networks.resolveCurrencySymbol(loggedWallet?.chain, loggedWallet?.network)) }}</span>
      </template>
    </div>
  </v-card>
</template>
<script>
import filters from '@/shared/utils/filters';
import { mapState } from 'pinia';
import { useStore } from '@/store';
import networks from '@/shared/utils/networks';

export default {
  name: 'TransactionCard',
  props: {
    risk: {
      type: Boolean,
    },
    transaction: {
      type: Object,
    },
    withBg: {
      type: Boolean,
      default: () => true
    }
  },
  computed: {
    ...mapState(useStore, ['loggedWallet', 'assets']),
  },
  watch: {
    transaction: {
      handler(newVal) {
        this.amount = newVal
        if (this.amount?.assets?.length < 5) {
          this.shownAssets = this.amount?.assets;
          this.hiddenAssets = 0;
        } else {
          this.shownAssets = this.amount?.assets.slice(0, 5);
          this.hiddenAssets = this.amount?.assets.length - 5;
        }
      },
      deep: true,
    },
  },
  data() {
    return {
      networks,
      amount: undefined,
      showAllAssets: true,
      hiddenAssets: 0,
      shownAssets: [],
    };
  },
  filters,
  methods: {
    decimals(unit) {
      let decimals = 0
      if (unit && this.assets && this.assets[unit] && this.assets[unit].metadata) {
        decimals = this.assets[unit].metadata.decimals
      }
      return decimals
    },
    toggleAllAssets() {
      this.showAllAssets = !this.showAllAssets;
    },
  },
  mounted() {
    this.showAllAssets = false;
    this.amount = this.transaction
    if (this.amount?.assets?.length < 5) {
      this.shownAssets = this.amount?.assets;
      this.hiddenAssets = 0;
    } else {
      this.shownAssets = this.amount?.assets.slice(0, 5);
      this.hiddenAssets = this.amount?.assets.length - 5;
    }
  },
};
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
    color: var(--v-error-base);
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
