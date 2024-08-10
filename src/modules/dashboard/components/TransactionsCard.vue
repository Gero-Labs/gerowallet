<template>
  <div>
    <v-card outlined class="fill-height" :loading="loadingTxs">
      <v-card-title>Transactions (Last 10)</v-card-title>
      <v-card-text class="pa-0 text-center">
        <v-data-table
          :header-props="{ 'sort-icon': 'mdi-menu-up' }"
          :items="lastTenTransactions"
          :headers="activityHeaders"
          class="transparent transactions-table"
          :sort-by.sync="sortBy"
          :sort-desc.sync="sortDesc"
          dense @click:row="handleOnTransactionsRowClick"
        >
          <template v-slot:[`item.time`]="{ item }">
            <v-list-item two-line class="px-0">
              <v-list-item-content>
                <v-list-item-title style="font-size: 12px">{{ item.status }}</v-list-item-title>
                <v-list-item-subtitle style="font-size: 10px"
                >{{ new Date(item.time * 1000).toLocaleDateString() }}
                </v-list-item-subtitle>
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
            <span :style="{ color: getColor(item) }" v-if="loggedWallet">{{ item.ada | toCurrency(true, 0, networks.resolveCurrencySymbol(loggedWallet.chain, loggedWallet.network), "", false) }}</span>
          </template>
        </v-data-table>
      </v-card-text>
<!--      <v-card-actions class="justify-end" v-if="lastTenTransactions.length > 0">-->
<!--        <v-btn style="text-transform: capitalize; background: linear-gradient(45deg, #00c7f3, #00ffd1); color: black">-->
<!--          Show All Transactions-->
<!--        </v-btn>-->
<!--      </v-card-actions>-->
    </v-card>
    <TransactionDetailsDialog v-if="transactionInfo" :transactionInfo="transactionInfo" @close="handleTransactionModalClose"></TransactionDetailsDialog>
  </div>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import StackedTokens from '@/modules/dashboard/components/StackedTokens.vue';
import filters from '@/shared/utils/filters';
import { mapState } from 'pinia';
import { useStore } from '@/store';
import TransactionDetailsDialog from '@/modules/dashboard/dialogs/TransactionDetailsDialog.vue';
import networks from '@/shared/utils/networks';

export default defineComponent({
  name: 'TransactionsCard',
  components: { TransactionDetailsDialog, StackedTokens },
  filters,
  computed: {
    networks() {
      return networks
    },
    ...mapState(useStore, ['calculatedTransactions','loadingTxs', 'pools', 'loggedWallet']),
    lastTenTransactions() {
      if (this.calculatedTransactions) {
        return this.calculatedTransactions//.slice(this.calculatedTransactions.length-10,this.calculatedTransactions.length)
      }
      return []
    },
  },
  methods: {
    handleOnTransactionsRowClick(row) {
      this.transactionInfo = row;
    },
    handleTransactionModalClose() {
      this.transactionInfo = null;
    },
    getIcon(item) {
      if (item.status === 'Pending') {
        return require('@/assets/svg/arrows-right.svg');
      } else if (item.status === 'Received') {
        return require('@/assets/svg/arrows-up.svg');
      } else if (item.status === 'Sent') {
        return require('@/assets/svg/arrows-down.svg');
      }
      return '';
    },
    getColor(item) {
      if (item.status === 'Pending') {
        return '#FEC84B';
      } else if (item.status.includes('Received')) {
        return '#47cd89';
      } else if (item.status.includes('Sent') || item.ada < 0) {
        return '#F97066';
      }
      return '';
    }
  },
  data: () => ({
    transactionInfo: null,
    activityHeaders: [
      { text: 'Activity', align: 'start', sortable: true, value: 'time' },
      { text: '', align: 'start', sortable: false, value: 'assets', width: 132 },
      { text: 'Amount', align: 'start', sortable: false, value: 'amount' },
    ],
    sortBy: 'time',
    sortDesc: true,
  })
});
</script>
<style scoped>

</style>
