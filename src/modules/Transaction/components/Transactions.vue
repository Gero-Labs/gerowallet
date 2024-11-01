<template>
    <v-card class="fill-height transaction-layout">
      <!-- Transaction List Section (40% Width) -->
      <div class="left-section">
        <TransactionList
          :transactions="transactions"
          @selectTransaction="showTransactionDetails"
          :loadingTxs="loadingTxs"
          :loggedWallet="true"
        />
      </div>
  
      <!-- Transaction Details Section (60% Width) -->
      <div class="right-section">
        <TransactionDetails :transaction="selectedTransaction" v-if="selectedTransaction" />
      </div>
    </v-card>
  </template>
  
  <script>
  import TransactionList from './TransactionList.vue';
  import TransactionDetails from './TransactionDetails.vue';
  import { mapState } from 'pinia';
  import { useStore } from '@/store';
  
  export default {
    name: 'Transaction',
    data: () => ({
      selectedTransaction: null, // Use null to check if there's no selection
    }),
    components: {
      TransactionList,
      TransactionDetails,
    },
    computed: {
      ...mapState(useStore, ['calculatedTransactions', 'loadingTxs', 'loggedWallet']),
      transactions() {
        console.log(this.calculatedTransactions);
        return this.calculatedTransactions || []; // Ensure it returns an array
      },
    },
    watch: {
      transactions(newTransactions) {
        if (newTransactions.length && !this.selectedTransaction) {
          this.selectedTransaction = newTransactions[0]; // Select the first transaction if none is selected
        }
      },
    },
    created() {
      if (this.transactions.length) {
        this.selectedTransaction = this.transactions[0];
      }
    },
    methods: {
      showTransactionDetails(transaction) {
        this.selectedTransaction = transaction;
        console.log('Selected transaction:', transaction); // Log the selected transaction
      },
    },
  };
  </script>
  
  <style scoped>
  .transaction-layout {
    display: flex;
    flex-direction: row;
    height: 100%;
    gap: 0.5rem;
  }
  
  .left-section {
    flex: 0 0 40%;
    box-sizing: border-box;
  }
  
  .right-section {
    flex: 0 0 60%;
    box-sizing: border-box;
  }
  
  @media (max-width: 800px) {
    .transaction-layout {
      flex-direction: column;
    }
  
    .left-section,
    .right-section {
      flex: 0 0 100%;
      padding: 0;
    }
  }
  </style>
  