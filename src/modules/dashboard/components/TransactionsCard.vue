<template>
  <v-card outlined class="fill-height liquid-glass" :loading="loadingTxs">
    <v-card-title class="pb-2">
      Transactions
      <v-spacer />
      <!-- Search box -->
      <v-text-field
        v-model="search"
        dense
        flat
        solo
        hide-details
        placeholder="Search"
        prepend-inner-icon="mdi-magnify"
        clearable
        style="max-width: 200px;"
        class="top-level-search"
      ></v-text-field>
    </v-card-title>
    <v-card-text class="pa-0 text-center">
      <v-data-table
        :header-props="{ 'sort-icon': 'mdi-menu-up' }"
        :items="paginatedTransactions"
        :headers="activityHeaders"
        class="transparent transactions-table"
        :sort-by.sync="sortBy"
        :sort-desc.sync="sortDesc"
        :items-per-page="-1"
        hide-default-footer
        dense @click:row="handleOnTransactionsRowClick"
        :item-class="getRowClass"
      >
        <template v-slot:[`item.tx_timestamp`]="{ item }">
          <v-list-item two-line class="px-0 py-1">
            <v-list-item-content>
              <v-list-item-title class="activity-title">
                <span class="activity-text">{{ getStatus(item) }}</span>
                <v-chip v-if="isWithdrawal(item)" x-small outlined class="px-1" color="blue" style="margin-left: 4px!important;">Withdrawal</v-chip>
                <v-chip v-if="isStakeRegistration(item)" x-small outlined class="px-1" color="red" style="margin-left: 4px!important;">Stake Registration</v-chip>
                <v-chip outlined class="px-1" x-small color="#FEC84B" style="margin-left: 1px; margin-bottom: 1px" v-if="item.pending">Pending</v-chip>
              </v-list-item-title>
              <v-list-item-subtitle class="activity-date">
                <v-tooltip top>
                  <template v-slot:activator="{ on, attrs }">
                    <span
                      v-bind="attrs"
                      v-on="on"
                    >
                      {{ time.format(new Date(item.tx_timestamp * 1000)) }}
                    </span>
                  </template>
                  <span>
                    {{ new Date(item.tx_timestamp * 1000).toLocaleString() }}<br>
                    Epoch: {{ item.epoch_no }}
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
            :token-size="16"
          ></StackedTokens>
        </template>
        <template v-slot:[`item.amount`]="{ item }">
          <div v-if="loggedWallet" style="display: flex; flex-direction: column; align-items: center;">
            <div :style="{ color: getColor(item), fontSize: '14px', paddingBottom: '4px' }">
              {{ filters.toCurrency(item.ada, true, 0, networks.resolveCurrencySymbol(loggedWallet.chain, loggedWallet.network), "", false) }}
            </div>
            <div style="font-size: 12px; color: #C4C4C4;">
              {{ filters.toCurrency(item.ada * price?.lastPrice, true, 0, '$', '', false, 6) }}
            </div>
          </div>
        </template>
        <template v-slot:body.append>
          <tr v-if="transactions.length > itemsPerPage" class="no-hover">
            <td :colspan="activityHeaders.length" class="text-center pa-0 ma-0">
              <v-pagination
                v-model="currentPage"
                :length="Math.ceil(transactions.length / itemsPerPage)"
                :total-visible="5"
                circle
                class="compact-pagination ma-0"
              ></v-pagination>
            </td>
          </tr>
        </template>
      </v-data-table>
    </v-card-text>
<!--      <v-card-actions class="justify-end" v-if="lastTenTransactions.length > 0">-->
<!--        <v-btn style="text-transform: capitalize; background: linear-gradient(45deg, #00c7f3, #00ffd1); color: black">-->
<!--          Show All Transactions-->
<!--        </v-btn>-->
<!--      </v-card-actions>-->
    <TransactionDetailsDialog v-if="transactionInfo && state==='/' && !selectedTransaction" :transactionInfo="transactionInfo" @close="handleTransactionModalClose"></TransactionDetailsDialog>
  </v-card>
</template>
<script setup lang="ts">
import { computed, ref, toRefs, getCurrentInstance, watch } from 'vue';
import StackedTokens from '@/modules/dashboard/components/StackedTokens.vue';
import filters from '@/shared/utils/filters';
import TransactionDetailsDialog from '@/modules/dashboard/dialogs/TransactionDetailsDialog.vue';
import networks from '@/utils/networks';
import time from '@/plugins/time';
import { walletStore } from '@/stores/walletStore';
import { loadingState } from '@/stores/loading';
import { Cardano } from '@cardano-sdk/core';
import { networkStore } from '@/stores/networkStore';

const props = defineProps({
  selectedTransaction: {
    type: Object,
    default: null
  }
});

const emit = defineEmits(['row-click'])

const { transactions: txs, loggedWallet } = toRefs(walletStore)
const { price } = toRefs(networkStore)
const { assets, pools } = toRefs(networkStore)
const { loadingTxs } = toRefs(loadingState)

const activityHeaders = ref([
  // { text: 'time', align: 'start', sortable: true, value: 'tx_timestamp' },
  { text: 'Activity', align: 'start overflow-x', sortable: true, value: 'tx_timestamp' },
  { text: 'Amount', align: 'center text-nowrap', sortable: false, value: 'amount' },
  { text: '', align: 'center no-padding', sortable: false, value: 'assets', width: 110 },
])
const transactionInfo = ref<any>(null)
const sortBy = ref<string>('tx_timestamp');
const sortDesc = ref<boolean>(true);
const search = ref<string>('');
const currentPage = ref<number>(1);

const vmProxy = getCurrentInstance()!.proxy as any
const state = computed(() => vmProxy.$route.path)

const transactions = computed(() => {
  const filtered = txs.value.filter((tx: any) => {
    if (search.value) {
      return tx.id.toLowerCase().includes(search.value.toLowerCase()) ||
        tx.assets.some((asset: any) => {
          const assetInfo = assets.value[asset.unit] as any;
          return assetInfo?.metadata?.name?.toLowerCase().includes(search.value.toLowerCase()) ||
            assetInfo?.metadata?.ticker?.toLowerCase().includes(search.value.toLowerCase())
        })
    }
    return tx
  })

  // Sort by timestamp descending (most recent first)
  return filtered.sort((a, b) => b.tx_timestamp - a.tx_timestamp)
})

const itemsPerPage = computed(() => {
  // Show 10 transactions per page on /transactions route, 5 on dashboard
  return state.value === '/transactions' ? 10 : 5;
});

const paginatedTransactions = computed(() => {
  const start = (currentPage.value - 1) * itemsPerPage.value;
  const end = start + itemsPerPage.value;
  return transactions.value.slice(start, end);
});

// Watch for search term changes to reset pagination
watch(() => search.value, () => {
  currentPage.value = 1;
});

const handleOnTransactionsRowClick = (row) => {
  transactionInfo.value = row;
  console.log('transactionInfo', row);
  emit('row-click', row);
}

const handleTransactionModalClose = () => {
  transactionInfo.value = null;
}

const getStatus = (item) => {
  const statuses = []
  if (item.body?.certificates?.length > 0) {
    item.body.certificates.forEach((certificate: Cardano.Certificate) => {
      switch (certificate.__typename) {
        case Cardano.CertificateType.StakeRegistrationDelegation:
        case Cardano.CertificateType.StakeDelegation:
          const pool = pools.value[certificate.poolId];
          if (pool) {
            statuses.push('Delegating to '+pool.ticker)
          }
          break;
        case Cardano.CertificateType.StakeDeregistration:
          statuses.push('Stake Deregistration');
          break;
        case Cardano.CertificateType.RegisterDelegateRepresentative:
          statuses.push('DRep Registration')
          break;
        case Cardano.CertificateType.VoteDelegation:
          statuses.push('Vote Delegation')
          break;
        case Cardano.CertificateType.UnregisterDelegateRepresentative:
          statuses.push('DRep Deregistration')
          break;
      }
    })
  }
  if (item.receivedAmount - item.sentAmount > 0) {
    if (!item.body?.certificates) {
      statuses.push('Received Funds')
    }
  } else {
    if (!item.body?.certificates) {
      statuses.push('Sent Funds')
    }
  }
  return statuses.join(', ')
}

const isWithdrawal = (item) => {
  return item.body?.withdrawals?.length > 0 && loggedWallet.value?.stakeAddress && item.body.withdrawals.some(withdrawal => withdrawal.stakeAddress === loggedWallet.value.stakeAddress)
}

const isStakeRegistration = (item) => {
  return item.body?.certificates?.length > 0 && item.body.certificates.some(certificate => certificate.__typename === Cardano.CertificateType.StakeRegistrationDelegation || certificate.__typename === Cardano.CertificateType.StakeRegistration)
}

const getColor = (item) => {
  if (item.status === 'Pending') {
    return '#FEC84B';
  } else if (getStatus(item).includes('Received') || item.ada > 0) {
    return '#47cd89';
  } else if (getStatus(item).includes('Sent') || item.ada < 0) {
    return '#F97066';
  }
  return '';
}

const getRowClass = (item) => {
  if (props.selectedTransaction && props.selectedTransaction.id === item.id) {
    return 'selected-transaction';
  }
  return '';
}
</script>
<style>
.text-nowrap {
  text-wrap: nowrap;
}
.no-padding {
  padding: 0!important;
}
.selected-transaction {
  background-color: rgba(33, 150, 243, 0.1) !important;
  border-left: 3px solid #2196F3 !important;
}
.selected-transaction:hover {
  background-color: rgba(33, 150, 243, 0.15) !important;
}

.transactions-table tbody tr {
  cursor: pointer;
}

.transactions-table tbody tr:hover:not(.selected-transaction) {
  background-color: rgba(255, 255, 255, 0.05) !important;
}

.transactions-table tbody tr {
  height: 50px !important;
  max-height: 50px !important;
  min-height: 50px !important;
}

.transactions-table tbody tr td {
  height: 50px !important;
  padding-top: 0px !important;
  padding-bottom: 0px !important;
  vertical-align: middle !important;
  text-align: center !important;
}

.transactions-table tbody tr td .v-list-item {
  min-height: auto !important;
  padding: 0 !important;
}

.transactions-table tbody tr td .v-list-item__content {
  padding: 4px 12px !important;
  text-align: center !important;
}

/* Left-align the Activity column content */
.transactions-table tbody tr td:first-child .v-list-item__content {
  text-align: left !important;
}

.transactions-table .v-avatar {
  height: 26px !important;
  width: 26px !important;
  min-width: 26px !important;
}

.transactions-table .v-avatar img {
  height: 26px !important;
  width: 26px !important;
}


.activity-title {
  font-size: 12px !important;
  line-height: 1.2 !important;
  min-height: 14px !important;
  overflow: hidden !important;
  display: flex !important;
  align-items: center !important;
  white-space: nowrap !important;
}

.activity-text {
  overflow: hidden !important;
  text-overflow: ellipsis !important;
  white-space: nowrap !important;
  display: inline-block !important;
}

.activity-date {
  font-size: 10px !important;
  line-height: 1.1 !important;
  min-height: 11px !important;
  max-height: 11px !important;
  overflow: hidden !important;
  white-space: nowrap !important;
  text-overflow: ellipsis !important;
}

/* Compact pagination styling */
.transactions-table .compact-pagination .v-pagination__item {
  width: auto !important;
  height: 24px !important;
  min-width: 24px !important;
  max-height: 24px !important;
  font-size: 12px !important;
  margin: 0 4px !important;
}

.transactions-table .compact-pagination .v-pagination__item .v-btn {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  min-height: 24px !important;
  height: 24px !important;
  width: auto !important;
  min-width: 24px !important;
  max-height: 24px !important;
  padding: 0 4px !important;
  font-size: 12px !important;
  white-space: nowrap !important;
}

.transactions-table .compact-pagination .v-pagination__navigation {
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  max-width: 24px !important;
  max-height: 24px !important;
  margin: 0 8px !important;
}

.transactions-table .compact-pagination .v-pagination__navigation .v-btn {
  display: flex !important;
  align-items: center !important;
  justify-content: center !important;
  min-height: 24px !important;
  height: 24px !important;
  width: 24px !important;
  min-width: 24px !important;
  max-width: 24px !important;
  max-height: 24px !important;
  padding: 0 !important;
}

.transactions-table .compact-pagination .v-pagination__navigation .v-icon {
  font-size: 16px !important;
}

/* Additional fallback with deep selectors */
.compact-pagination >>> .v-pagination__item {
  width: auto !important;
  height: 24px !important;
  min-width: 24px !important;
  font-size: 12px !important;
  margin: 0 4px !important;
}

.compact-pagination >>> .v-pagination__item .v-btn {
  width: auto !important;
  height: 24px !important;
  min-width: 24px !important;
  min-height: 24px !important;
  padding: 0 4px !important;
  font-size: 12px !important;
  white-space: nowrap !important;
}

.compact-pagination >>> .v-pagination__navigation {
  width: 24px !important;
  height: 24px !important;
  margin: 0 8px !important;
}

.compact-pagination >>> .v-pagination__navigation .v-btn {
  width: 24px !important;
  height: 24px !important;
  min-width: 24px !important;
  min-height: 24px !important;
  padding: 0 !important;
}

/* Remove hover effect and margins from pagination row */
.no-hover:hover {
  background-color: transparent !important;
}

.no-hover td {
  padding: 0 !important;
  margin: 0 !important;
  vertical-align: middle !important;
}

.compact-pagination.ma-0 {
  margin: 0 !important;
}


</style>
