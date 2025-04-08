<template>
  <div>
    <div>
  <v-container fluid class="multisig-container">
    <v-row>
      <v-col cols="8">
        <h1 class="multisig-title">Multisig Transactions</h1>
        <p class="multisig-description">A multisig transaction on Cardano is a transaction that requires multiple signatures from different parties to authorize spending from a shared address.</p>
      </v-col>
      <v-col cols="2">
        <v-btn variant="outlined" class="text-caption text-capitalize" prepend-icon="mdi-account" @click="showCreateMultisigDialog = true">
          <v-icon small color="#00DFF3" left>
            mdi-wallet-plus
            </v-icon>
          Create Multisig Wallet
        </v-btn>
      </v-col>
      <v-col cols="2">
        <v-btn variant="outlined" class="text-caption text-capitalize" prepend-icon="mdi-account" @click="showNewMultisigTransaction = true">
          <v-icon small color="#00DFF3" left>
            mdi-wallet-plus
            </v-icon>
          New Transaction
        </v-btn>
      </v-col>
      
    </v-row>

    <v-row>
      <v-col cols="12">
        <v-row class="pt-3">
          <v-col cols="4">
            <v-select
              label="Select Multisig to manage"
              v-model="selectedMultisigWallet"
              :items="this.multisigWallets"
              item-text="name"
              item-value="addressBech32"
              outlined
              hide-details
              @change="onSelectedWallet"
            >
              <template v-slot:prepend>
                <img
                  src="@/assets/svg/account-multiple-outline-custom.svg"
                  alt="Icon"
                  width="24"
                  height="24"
                />
              </template>
            </v-select>
            <!-- <span class="text-left d-block"
              >The minimum number of signers required to execute a transaction</span
            > -->
          </v-col>
          <v-col cols="3">
            <v-btn color="primary" text block @click="showMultisigWalletDetails" class="mt-4">
              <img src="@/assets/svg/file.svg" alt="File Icon" class="svg-icon" /> <!-- SVG treated as an icon -->
              Wallet Details
            </v-btn>
          </v-col>
          <v-col cols="3">
            <v-btn color="primary" text block @click="fundMultisigWallet" class="mt-4">
              <img src="@/assets/svg/credit-card-download.svg" alt="File Icon" class="svg-icon" /> <!-- SVG treated as an icon -->
              Fund Wallet
            </v-btn>
          </v-col>
      </v-row>
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
</div>
  <CreateMultisigWalletDialog :isOpen="showCreateMultisigDialog" @close="showCreateMultisigDialog = false"></CreateMultisigWalletDialog>
  <FundWallet :isOpen="showFundWallet" @close="showFundWallet = false" :recipientAddressProp="this.selectedAddress" :isMultisig="true"></FundWallet>
  <MultisigTransactionDialog :isOpen="showNewMultisigTransaction" @close="showNewMultisigTransaction = false"></MultisigTransactionDialog>
</div>
</template>

<script lang="ts">
import { Component, Vue } from 'vue-property-decorator';
import CreateMultisigWalletDialog from '@/modules/multisig/dialogs/CreateMultisigWalletDialog.vue';
import FundWallet from '@/modules/dashboard/dialogs/SendDialog.vue';
import MultisigTransactionDialog from '@/modules/dashboard/dialogs/MultisigTransactionDialog.vue'; 
import { MessageTypes } from '@/models/MessageTypes';
import { walletConfigStore } from "@/store/modules/walletConfig";
import { Wallet } from "@/models/wallet";
import { appWallet, useStore } from "@/store";
import { multisigStore } from '@/store/modules/multisig';

import { mapState } from "pinia";
import db from '@/db';
import Dexie from 'dexie';
import networks from "@/shared/utils/networks";
import {NativeScript} from '@emurgo/cardano-serialization-lib-browser';



@Component({
  components:{
    FundWallet,
    CreateMultisigWalletDialog,
    MultisigTransactionDialog
  }
})
export default class MultisigTransactions extends Vue {
  loading = false;
  showCreateMultisigDialog = false;
  showNewMultisigTransaction = false;
  showFundWallet = false;
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
  multisigWallets = [];
  selectedMultisigWallet = {};
  selectedAddress="";
  myStore = useStore();
  multisigStore = multisigStore();
  loggedWallet = this.myStore.loggedWallet;
  
  mounted() {
    this.loadData();
    this.myStore.loggedWallet
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
     const dbWallet = new Dexie('wallet-'+this.loggedWallet.id);
     await dbWallet.open();
     let multisigs = await dbWallet.table('multisig').toArray();
     //sort by latest first
     multisigs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
     console.log("multisig:::::", multisigs[0]);
     const multisigsOriginal = multisigs;
     multisigs = multisigs.map((row, index) => ({
      addressBech32: row.id, //multisig address
      index,
      name: row.name,
      signaturesRequired: row.requiredSigners || 1,
      totalSigners: NativeScript.from_hex(row.multisigScriptCBOR).get_required_signers().len(),
      scriptCBOR: row.multisigScriptCBOR
     }));
     this.multisigWallets = multisigs;
     this.selectedMultisigWallet = multisigs[0];
     this.myStore.setSelectedMultisig(multisigs[0]);
     this.multisigStore.setSelectedMultisig(multisigsOriginal[0]);
     this.selectedAddress = multisigs[0].addressBech32;
     console.log("all wallets now:::", multisigs);
     /* await multisigStore().getallwallets()[0].loadTransactions()
      or await multisigStore().loadTransactions("multisigAddressBench32Id") //this would load them straight from the backend or preferabl

     */

      // await db
      // this.multisigWallets = 
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

  onSelectedWallet(selectedValue) {
    this.selectedAddress = selectedValue;
    console.log("selected item changed to::", typeof selectedValue);
    console.log("Selected multisig wallet object:::"+typeof this.selectedMultisigWallet+"::"+this.selectedMultisigWallet);
    const selected = this.multisigWallets.filter(imultisig => imultisig.addressBech32 === selectedValue);
    this.myStore.setSelectedMultisig(selected);
    console.log("Selected Address:::", this.selectedAddress);

  }
  fundMultisigWallet() {
    //openfundingdialog
    console.log("show the funding dialog form.");
    this.showFundWallet = true;
  }
  showMultisigWalletDetails() {
    console.log("render the multisig create dialog but with the selected multisig rendered, only name should be editable.");
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

.svg-icon {
  width: 24px; /* Set the width of the icon */
  height: 24px; /* Set the height of the icon */
  margin-right: 8px; /* Space between the icon and text */
  vertical-align: middle; /* Align the icon vertically with the text */
  display: inline-block; /* Ensure the icon behaves like an inline element */
}
</style>
