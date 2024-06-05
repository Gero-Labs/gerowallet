<template>
  <div v-if="transaction" class="tx-card" :class="{ risk: risk }">
    <div class="tx-header">
      <slot />
      <img
        alt="Hint"
        height="12"
        width="12"
        :src="require('@/assets/svg/hint.svg')"
        v-tooltip.bottom="tooltipContent"
      />
    </div>

    <div class="tx-details">
      <div class="provider">{{ transaction?.provider }}</div>
      <div class="total">{{ transaction?.total }} ₳</div>
      <div class="assets">Assets:</div>
      <div v-if="transaction?.assets?.length">
        <div v-for="asset in shownAssets" :key="asset.currency" class="asset-entry">
          <div>{{ asset.currency }}</div>
          <div>{{ asset.amount }}</div>
        </div>
        <a v-if="hiddenAssets" class="asset-entry" @click="toggleAllAssets()">
          {{ hiddenAssets }} more types of collectibles
        </a>
      </div>
    </div>

    <div class="tx-footer">
      <template v-if="transaction.txFee">
        Tx Fee&nbsp;&nbsp;<span> – {{ transaction.txFee }} ₳</span>
      </template>
    </div>
  </div>
</template>

<!------------------------------------------------------------------------------ Script -->

<script>
export default {
  data() {
    return {
      showAllAssets: true,
      hiddenAssets: 0,
      shownAssets: [],
    };
  },
  props: {
    risk: {
      type: Boolean,
    },
    transaction: {
      type: Object,
    },
    tooltip: {
      type: Function,
      default: () => '',
    },
  },
  methods: {
    toggleAllAssets() {
      this.showAllAssets = !this.showAllAssets;
    },
  },
  watch: {
    showAllAssets(value) {
      if (this.transaction?.assets?.length < 5 || value) {
        this.shownAssets = this.transaction?.assets;
        this.hiddenAssets = 0;
      } else {
        this.shownAssets = this.transaction?.assets.slice(0, 5);
        this.hiddenAssets = this.transaction?.assets.length - 5;
      }
    },
  },
  computed: {
    tooltipContent() {
      return {
        html: true,
        content: this.tooltip(),
      };
    },
  },
  async mounted() {
    this.showAllAssets = false;
  },
};
</script>

<!------------------------------------------------------------------------------ Styles -->

<style scoped>
.tx-card {
  margin: 0 24px;
}

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
  background: linear-gradient(93.33deg, #000000 6.91%, #006a57 185.93%);

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

  font-size: 13px;
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
    background: linear-gradient(93.33deg, rgba(0, 0, 0, 0.9) 6.91%, #4c0000 185.93%);

    .total {
      color: var(--v-error-base);
    }
  }

  .asset-entry {
    color: var(--v-error-base);
  }
}
</style>
