<template>
  <v-card flat outlined>
    <v-card-title class="d-flex align-center"> Treasury Overview </v-card-title>
    <v-card-text>
      <div class="text-center">
        <div class="text-h4 font-weight-bold primary--text">US$ 9,501.54</div>
        <div class="text-caption text-uppercase">Total Treasury</div>
      </div>

      <v-divider class="my-4"></v-divider>

      <!-- Asset Information -->
      <v-row>
        <v-col cols="12" md="6">
          <v-card flat outlined class="pa-4">
            <div class="d-flex align-center mb-3">
              <v-avatar size="32" class="mr-3">
                <v-img :src="geroLogo" />
              </v-avatar>
              <h3 class="text-h6 mb-0">GERO Asset</h3>
            </div>
            
            <v-row>
              <v-col cols="6">
                <div class="text-caption grey--text">Amount</div>
                <div class="text-subtitle-1 font-weight-medium">5,000,000</div>
              </v-col>
              <v-col cols="6">
                <div class="text-caption grey--text">Price (USD)</div>
                <div class="text-subtitle-1 font-weight-medium">$0.0019</div>
              </v-col>
            </v-row>
            
            <v-divider class="my-3"></v-divider>
            
            <div class="text-caption grey--text">Value (USD)</div>
            <div class="text-h5 font-weight-bold primary--text">$9,500</div>
          </v-card>
        </v-col>

        <v-col cols="12" md="6">
          <v-card flat outlined class="pa-4">
            <h3 class="text-h6 mb-3">Treasury Rules</h3>
            <v-list dense>
              <v-list-item>
                <v-list-item-icon>
                  <v-icon color="info">mdi-information</v-icon>
                </v-list-item-icon>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">Minimum Proposal Amount</v-list-item-title>
                  <v-list-item-subtitle class="text-caption">100 ADA required to create a proposal</v-list-item-subtitle>
                </v-list-item-content>
              </v-list-item>
              <v-list-item>
                <v-list-item-icon>
                  <v-icon color="info">mdi-information</v-icon>
                </v-list-item-icon>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">Maximum Single Withdrawal</v-list-item-title>
                  <v-list-item-subtitle class="text-caption">10,000 ADA per proposal</v-list-item-subtitle>
                </v-list-item-content>
              </v-list-item>
              <v-list-item>
                <v-list-item-icon>
                  <v-icon color="info">mdi-information</v-icon>
                </v-list-item-icon>
                <v-list-item-content>
                  <v-list-item-title class="text-subtitle-2">Emergency Fund</v-list-item-title>
                  <v-list-item-subtitle class="text-caption">20% of treasury reserved for emergencies</v-list-item-subtitle>
                </v-list-item-content>
              </v-list-item>
            </v-list>
          </v-card>
        </v-col>
      </v-row>

      <!-- Recent Transactions -->
      <v-row class="mt-4">
        <v-col cols="12">
          <h3 class="text-h6 mb-3">Recent Transactions</h3>
          <v-list dense>
            <v-list-item v-for="tx in recentTransactions" :key="tx.id">
              <v-list-item-icon>
                <v-icon :color="tx.type === 'in' ? 'success' : 'error'">
                  {{ tx.type === 'in' ? 'mdi-arrow-down' : 'mdi-arrow-up' }}
                </v-icon>
              </v-list-item-icon>
              <v-list-item-content>
                <v-list-item-title class="text-subtitle-2">{{ tx.description }}</v-list-item-title>
                <v-list-item-subtitle class="text-caption">{{ formatDate(tx.date) }}</v-list-item-subtitle>
              </v-list-item-content>
              <v-list-item-action>
                <span class="text-subtitle-2" :class="tx.type === 'in' ? 'success--text' : 'error--text'">
                  {{ tx.type === 'in' ? '+' : '-' }}{{ formatADA(tx.amount) }}
                </span>
              </v-list-item-action>
            </v-list-item>
          </v-list>
        </v-col>
      </v-row>
    </v-card-text>
  </v-card>
</template>

<script setup lang="ts">
import { ref } from 'vue';
import geroLogo from '@/assets/svg/gero-logo.svg'

interface Transaction {
  id: string;
  type: 'in' | 'out';
  amount: number;
  description: string;
  date: number;
}

const recentTransactions = ref<Transaction[]>([
  {
    id: '1',
    type: 'in',
    amount: 50000,
    description: 'Community contribution',
    date: Date.now() - 86400000, // 1 day ago
  },
  {
    id: '2',
    type: 'out',
    amount: 25000,
    description: 'Development funding',
    date: Date.now() - 172800000, // 2 days ago
  },
  {
    id: '3',
    type: 'in',
    amount: 75000,
    description: 'DAO membership fee',
    date: Date.now() - 259200000, // 3 days ago
  },
]);

const formatADA = (amount: number): string => {
  return (
    (amount / 1000000).toLocaleString('en-US', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }) + ' ₳'
  );
};

const formatDate = (timestamp: number): string => {
  const date = new Date(timestamp);
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};
</script>

<style scoped></style>
