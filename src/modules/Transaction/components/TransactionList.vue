<template>
  <v-card outlined class="fill-height" :loading="loadingTxs">
    <v-card-title>Transactions</v-card-title>
    <v-card-text class="pa-0 text-center">
      <v-data-table
        :header-props="{ 'sort-icon': 'mdi-arrow-down-thin' }"
        :items="lastTransactions"
        :headers="activityHeaders"
        class="transparent transactions-table"
        :sort-by.sync="sortBy"
        :sort-desc.sync="sortDesc"
        dense
        @click:row="handleOnTransactionsRowClick"
      >
        <template v-slot:[`item.time`]="{ item }">
          <v-list-item two-line class="px-0">
            <v-list-item-content>
              <v-list-item-title>
                {{ item.status.split(' ')[0] }}
              </v-list-item-title>
              <v-list-item-subtitle>{{ new Date(item.time * 1000).toLocaleDateString() }}</v-list-item-subtitle>
            </v-list-item-content>
          </v-list-item>
        </template>
        <template v-slot:[`item.assets`]="{ item }">
          <StackedTokens
            :tokens="item.assets"
            :style="item.status === 'Pending' ? { opacity: '0.5' } : {}"
          ></StackedTokens>
        </template>
        <template v-slot:[`item.amount`]="{ item }">
          <span v-if="item.status === 'Received Funds'">
            <span :style="{ color: getColor(item) }">{{ formatCurrency(item.receivedAmount, item.status) }}</span>
          </span>
          <span v-else-if="item.status === 'Sent Funds'">
            <span :style="{ color: getColor(item) }">{{ formatCurrency(item.sentAmount, item.status) }}</span>
          </span>
        </template>
      </v-data-table>
    </v-card-text>
  </v-card>
</template>

<script lang="ts">
import { defineComponent, PropType } from 'vue';
import StackedTokens from '@/modules/dashboard/components/StackedTokens.vue';
import { mapState } from 'pinia';
import { useStore } from '@/store';
import networks from '@/shared/utils/networks';

export default defineComponent({
  name: 'TransactionsCardFromParent',
  components: { StackedTokens },
  props: {
    transactions: {
      type: Array as PropType<Array<any>>, // Adjust the type based on your transaction object structure
      required: true,
    },
    loadingTxs: {
      type: Boolean,
      default: false,
    },
    loggedWallet: {
      type: Object, // Adjust according to the structure of loggedWallet
      required: true,
    },
  },
  computed: {
    networks() {
      return networks;
    },
    ...mapState(useStore, ['pools']), // Add other state mappings as necessary

    lastTransactions() {
      return this.transactions;
    },
  },
  methods: {
    formatCurrency(amount, status) {
      const adaAmount = (amount / 1000000).toFixed(2);
      if (status === 'Received Funds') {
        return `+ ₳ ${adaAmount}`;
      } else if (status === 'Sent Funds') {
        return `- ₳ ${adaAmount}`;
      } else {
        return `₳ ${adaAmount}`;
      }
    },
    handleOnTransactionsRowClick(row) {
      console.log(row);
      this.transactionInfo = row; // Set the clicked transaction info
      this.$emit('selectTransaction', row); // Emit the selected transaction
    },
    handleTransactionModalClose() {
      this.transactionInfo = null;
    },
    getColor(item) {
      if (item.status === 'Pending') {
        return '#FEC84B';
      } else if (item.status.includes('Received') || item.ada > 0) {
        return '#47cd89';
      } else if (item.status.includes('Sent') || item.ada < 0) {
        return '#F97066';
      }
      return '';
    },
  },
  data: () => ({
    transactionInfo: null,
    activityHeaders: [
      { text: 'Transactions', align: 'start overflow-x', sortable: true, value: 'time' },
      { text: '', align: 'start no-padding', sortable: false, value: 'assets', width: 132 },
      { text: 'Amount', align: 'start text-nowrap', sortable: false, value: 'amount' },
      { text: 'Risk', align: 'start text-nowrap', sortable: false, value: 'risk' },
    ],
    sortBy: 'time',
    sortDesc: true,
  }),
});
</script>

<style>
.text-nowrap {
  text-wrap: nowrap;
}
.no-padding {
  padding: 0 !important;
}
</style>
