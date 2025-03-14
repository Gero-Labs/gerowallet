<template>
  <v-container fluid class="multisig-container">
    <v-row>
      <v-col cols="10">
        <h1 class="multisig-title">Multisig Transactions</h1>
        <p class="multisig-description">A multisig transaction on Cardano is a transaction that requires multiple signatures from different parties to authorize spending from a shared address.</p>
      </v-col>
      <v-col cols="2">
        <v-btn variant="outlined" class="text-caption text-capitalize" prepend-icon="mdi-account">
          <v-icon small color="#00DFF3">
              mdi-qrcode
            </v-icon>
          Create Multisig Wallet
        </v-btn>
      </v-col>
      
    </v-row>

    <v-row>
      <v-col cols="12">
        <v-card class="multisig-card">
          <v-card-title>Pending Transactions</v-card-title>
          <v-card-text>
            <v-data-table
              :headers="headers"
              :items="pendingTransactions"
              :items-per-page="5"
              class="multisig-table"
              :loading="loading"
              loading-text="Loading transactions..."
              no-data-text="No pending multisig transactions"
            >
              <!-- <template v-slot:item.status="{ item }">
                <v-chip :color="getStatusColor(item.status)" small class="status-chip">
                  {{ item.status }}
                </v-chip>
              </template>
              <template v-slot:item.actions="{ item }">
                <v-btn small color="primary" text @click="viewTransaction(item)"> View </v-btn>
                <v-btn
                  small
                  color="success"
                  text
                  @click="signTransaction(item)"
                  :disabled="item.status !== 'Awaiting Signature'"
                >
                  Sign
                </v-btn>
              </template> -->
            </v-data-table>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>

    <v-row class="mt-6">
      <v-col cols="12" md="6">
        <v-card class="multisig-card">
          <v-card-title>Create New Multisig Transaction</v-card-title>
          <v-card-text>
            <v-btn color="primary" block @click="createNewTransaction" class="create-btn">
              <v-icon left>mdi-plus</v-icon>
              Create Transaction
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
      <v-col cols="12" md="6">
        <v-card class="multisig-card">
          <v-card-title>Multisig Wallets</v-card-title>
          <v-card-text>
            <div v-if="wallets.length > 0">
              <div v-for="(wallet, index) in wallets" :key="index" class="wallet-item">
                <div class="wallet-name">{{ wallet.name }}</div>
                <div class="wallet-details">{{ wallet.signaturesRequired }} of {{ wallet.totalSigners }} required</div>
              </div>
            </div>
            <div v-else class="no-wallets">No multisig wallets configured</div>
            <v-btn color="primary" text block @click="createNewWallet" class="mt-4">
              <v-icon left>mdi-wallet-plus</v-icon>
              Create Multisig Wallet
            </v-btn>
          </v-card-text>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script lang="ts">
import { Component, Vue } from 'vue-property-decorator';
import { MessageTypes } from '@/models/MessageTypes';

@Component
export default class MultisigTransactions extends Vue {
  loading = false;
  headers = [
    { text: 'Transaction ID', value: 'id' },
    { text: 'Date', value: 'date' },
    { text: 'Amount', value: 'amount' },
    { text: 'Wallet', value: 'wallet' },
    { text: 'Status', value: 'status' },
    { text: 'Actions', value: 'actions', sortable: false },
  ];

  pendingTransactions = [
    // Sample data - would be loaded from API/store in real implementation
  ];

  wallets = [
    // Sample data - would be loaded from API/store in real implementation
  ];

  mounted() {
    this.loadData();
  }

  async loadData() {
    this.loading = true;
    try {
      // In a real implementation, this would fetch data from an API or store
      // For now, we'll use sample data
      this.pendingTransactions = [
        {
          id: 'tx-001',
          date: '2023-05-15',
          amount: '1,500 ADA',
          wallet: 'Family Savings',
          status: 'Awaiting Signature',
        },
        {
          id: 'tx-002',
          date: '2023-05-14',
          amount: '500 ADA',
          wallet: 'Business Account',
          status: 'Partially Signed (2/3)',
        },
      ];

      this.wallets = [
        {
          name: 'Family Savings',
          signaturesRequired: 2,
          totalSigners: 3,
        },
        {
          name: 'Business Account',
          signaturesRequired: 3,
          totalSigners: 5,
        },
      ];
    } catch (error) {
      console.error('Failed to load multisig data:', error);
    } finally {
      this.loading = false;
    }
  }

  getStatusColor(status: string): string {
    if (status.includes('Awaiting')) return 'warning';
    if (status.includes('Partially')) return 'info';
    if (status.includes('Completed')) return 'success';
    if (status.includes('Rejected')) return 'error';
    return 'grey';
  }

  viewTransaction(transaction: any) {
    // Implementation for viewing transaction details
    console.log('View transaction:', transaction);
  }

  signTransaction(transaction: any) {
    // Implementation for signing a transaction
    console.log('Sign transaction:', transaction);
  }

  createNewTransaction() {
    // Implementation for creating a new transaction
    console.log('Create new multisig transaction');
  }

  createNewWallet() {
    // Implementation for creating a new multisig wallet
    console.log('Create new multisig wallet');
  }
}
</script>

<style scoped>
.multisig-container {
  padding: 24px;
}

.multisig-title {
  font-size: 28px;
  font-weight: 700;
  color: #f5f5f5;
  margin-bottom: 8px;
}

.multisig-description {
  color: #94969c;
  font-size: 16px;
  margin-bottom: 24px;
}

.multisig-card {
  background-color: #0c0e12;
  border-radius: 12px;
  border: 1px solid #1f242f;
}

.status-chip {
  font-size: 12px;
  font-weight: 500;
}

.wallet-item {
  padding: 12px 0;
  border-bottom: 1px solid #1f242f;
}

.wallet-item:last-child {
  border-bottom: none;
}

.wallet-name {
  font-weight: 600;
  font-size: 16px;
  color: #f5f5f5;
}

.wallet-details {
  font-size: 14px;
  color: #94969c;
  margin-top: 4px;
}

.no-wallets {
  color: #94969c;
  text-align: center;
  padding: 24px 0;
}

.create-btn {
  margin-top: 8px;
}
</style>
