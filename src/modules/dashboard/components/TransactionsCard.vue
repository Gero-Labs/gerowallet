<template>
  <v-card outlined class="fill-height" :loading="loadingTxs">
    <v-card-title>Transactions</v-card-title>
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
              <v-list-item-title style="font-size: 12px; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; white-space: normal;">
                {{ item.status }}
                <v-chip outlined class="px-1" x-small color="#FEC84B" style="margin-left: 1px; margin-bottom: 1px" v-if="item.pending">Pending</v-chip>
              </v-list-item-title>
              <v-list-item-subtitle
                style="font-size: 10px; display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: horizontal; overflow: hidden; text-overflow: ellipsis; white-space: normal;"
              >
                <v-tooltip top >
                  <template v-slot:activator="{ on, attrs }">
                    <span
                      v-bind="attrs"
                      v-on="on"
                    >
                      {{ time.format(new Date(item.time * 1000)) }}
                    </span>
                  </template>
                  <span>
                    {{ new Date(item.time * 1000).toLocaleString() }}
                  </span>
                </v-tooltip>
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
          <v-list-item class="px-0" v-if="loggedWallet">
            <v-list-item-content>
              <v-list-item-title :style="{ color: getColor(item) }">{{ item.ada | toCurrency(true, 0, networks.resolveCurrencySymbol(loggedWallet.chain, loggedWallet.network), "", false) }}</v-list-item-title>
              <v-list-item-subtitle>{{ item.ada * price.lastPrice | toCurrency(true, 0, '$', '', false, 6) }}</v-list-item-subtitle>
            </v-list-item-content>
          </v-list-item>
          <span :style="{ color: getColor(item) }" v-if="loggedWallet"></span>
        </template>
      </v-data-table>
    </v-card-text>
<!--      <v-card-actions class="justify-end" v-if="lastTenTransactions.length > 0">-->
<!--        <v-btn style="text-transform: capitalize; background: linear-gradient(45deg, #00c7f3, #00ffd1); color: black">-->
<!--          Show All Transactions-->
<!--        </v-btn>-->
<!--      </v-card-actions>-->
    <TransactionDetailsDialog v-if="transactionInfo && state==='/'" :transactionInfo="transactionInfo" @close="handleTransactionModalClose"></TransactionDetailsDialog>
  </v-card>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import StackedTokens from '@/modules/dashboard/components/StackedTokens.vue';
import filters from '@/shared/utils/filters';
import { mapState } from 'pinia';
import { useStore } from '@/stores';
import TransactionDetailsDialog from '@/modules/dashboard/dialogs/TransactionDetailsDialog.vue';
import networks from '@/utils/networks';
import time from '@/plugins/time';

export default defineComponent({
  name: 'TransactionsCard',
  components: { TransactionDetailsDialog, StackedTokens },
  filters,
  computed: {
    networks() {
      return networks
    },
    ...mapState(useStore, ['calculatedTransactions','loadingTxs', 'pools', 'loggedWallet', 'price']),
    lastTenTransactions() {
      if (this.calculatedTransactions) {
        return this.calculatedTransactions//.slice(this.calculatedTransactions.length-10,this.calculatedTransactions.length)
      }
      return []
    },
  },
  created() {
    this.state = this.$route.path;
  },
  methods: {
    handleOnTransactionsRowClick(row) {
      this.transactionInfo = row;
      this.$emit('row-click', row);
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
    }
  },
  data: () => ({
    state :null,
    transactionInfo: null,
    activityHeaders: [
      { text: 'Activity', align: 'start overflow-x', sortable: true, value: 'time' },
      { text: '', align: 'start no-padding', sortable: false, value: 'assets', width: 132 },
      { text: 'Amount', align: 'start text-nowrap', sortable: false, value: 'amount' },
    ],
    sortBy: 'time',
    sortDesc: true,
    time,
  })
});
</script>
<style>
.text-nowrap {
  text-wrap: nowrap;
}
.no-padding {
  padding: 0!important;
}
</style>
