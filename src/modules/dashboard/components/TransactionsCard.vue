<template>
  <v-card outlined class="fill-height" :loading="loadingTxs">
    <v-card-title>
      Transactions
      <v-spacer />
      <v-text-field
        v-model="search"
        clearable
        outlined
        dense
        label="Search"
        prepend-inner-icon="mdi-magnify"
        hide-details
      >
      </v-text-field>
    </v-card-title>
    <v-card-text class="pa-0 text-center">
      <v-data-table
        :header-props="{ 'sort-icon': 'mdi-menu-up' }"
        :items="transactions"
        :headers="activityHeaders"
        class="transparent transactions-table"
        :sort-by.sync="sortBy"
        :sort-desc.sync="sortDesc"
        dense @click:row="handleOnTransactionsRowClick"
      >
        <template v-slot:[`item.tx_timestamp`]="{ item }">
          <v-list-item two-line class="px-0">
            <v-list-item-content>
              <v-list-item-title style="font-size: 12px; display: -webkit-box; -webkit-box-orient: vertical; overflow: hidden; text-overflow: ellipsis; white-space: normal;">
                {{ getStatus(item) }}
                <v-chip v-if="isWithdrawal(item)" x-small outlined class="px-1" color="blue">Withdrawal</v-chip>
                <v-chip outlined class="px-1" x-small color="#FEC84B" style="margin-left: 1px; margin-bottom: 1px" v-if="item.pending">Pending</v-chip>
              </v-list-item-title>
              <v-list-item-subtitle
                style="font-size: 10px; display: -webkit-box; -webkit-box-orient: horizontal; overflow: hidden; text-overflow: ellipsis; white-space: normal;"
              >
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
                    {{ new Date(item.tx_timestamp * 1000).toLocaleString() }}
                  </span>
                </v-tooltip>
              </v-list-item-subtitle>
              <v-list-item-subtitle style="font-size: 10px">
                Epoch: {{ item.epoch_no }}
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
              <v-list-item-title :style="{ color: getColor(item) }">{{ filters.toCurrency(item.ada, true, 0, networks.resolveCurrencySymbol(loggedWallet.chain, loggedWallet.network), "", false) }}</v-list-item-title>
              <v-list-item-subtitle>{{  filters.toCurrency(item.ada * price?.lastPrice, true, 0, '$', '', false, 6) }}</v-list-item-subtitle>
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
<script setup lang="ts">
import { computed, ref, toRefs, getCurrentInstance } from 'vue';
import StackedTokens from '@/modules/dashboard/components/StackedTokens.vue';
import filters from '@/shared/utils/filters';
import TransactionDetailsDialog from '@/modules/dashboard/dialogs/TransactionDetailsDialog.vue';
import networks from '@/utils/networks';
import time from '@/plugins/time';
import { walletStore } from '@/stores/walletStore';
import { loadingState } from '@/stores/loading';
import { Cardano } from '@cardano-sdk/core';
import { networkStore } from '@/stores/networkStore';

const emit = defineEmits(['row-click'])

const { transactions: txs, loggedWallet } = toRefs(walletStore)
const { price } = toRefs(networkStore)
const { assets, pools } = toRefs(networkStore)
const { loadingTxs } = toRefs(loadingState)

const activityHeaders = ref([
  // { text: 'time', align: 'start', sortable: true, value: 'tx_timestamp' },
  { text: 'Activity', align: 'start overflow-x', sortable: true, value: 'tx_timestamp' },
  { text: '', align: 'start no-padding', sortable: false, value: 'assets', width: 132 },
  { text: 'Amount', align: 'start text-nowrap', sortable: false, value: 'amount' },
])
const transactionInfo = ref<any>(null)
const sortBy = ref<string>('tx_timestamp');
const sortDesc = ref<boolean>(true);
const search = ref<string>('');

const vmProxy = getCurrentInstance()!.proxy as any
const state = computed(() => vmProxy.$route.path)

const transactions = computed(() => {
  return txs.value.filter((tx: any) => {
    if (search.value) {
      return tx.id.toLowerCase().includes(search.value.toLowerCase()) ||
        tx.assets.some((asset: any) => {
          return assets.value[asset.unit]?.metadata?.name?.toLowerCase().includes(search.value.toLowerCase()) ||
            assets.value[asset.unit]?.metadata?.ticker.toLowerCase().includes(search.value.toLowerCase())
        })
    }
    return tx
  })
})

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
        case Cardano.CertificateType.StakeRegistration:
          statuses.push('Stake Registration')
          break;
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
</script>
<style>
.text-nowrap {
  text-wrap: nowrap;
}
.no-padding {
  padding: 0!important;
}
</style>
