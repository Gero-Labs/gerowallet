<template>
    <div>
        <div>
            <v-container fluid class="multisig-container">
                <v-card outlined>
                    <v-row>
                        <v-col cols="8">
                            <v-card-title class="multisig-title">{{ $t('multisig.title') }}</v-card-title>
                            <v-card-subtitle class="multisig-description">{{ $t('multisig.description')
                                }}</v-card-subtitle>
                        </v-col>
                        <v-col :cols="selectedMultisigWallet ? 2 : 4" class="text-right">
                            <v-btn color="#CCC" outlined class="ma-4 text-caption text-capitalize"
                                @click="showCreateMultisigDialog = true">
                                <v-icon small left>
                                    mdi-plus-circle
                                </v-icon>
                                {{ $t('multisig.createMultisigWallet') }}
                            </v-btn>
                        </v-col>
                        <v-col cols="2" v-show="selectedMultisigWallet">
                            <v-btn color="#CCC" outlined class="ma-4 text-caption text-capitalize"
                                @click="showNewMultisigTransaction = true">
                                <v-icon small left>
                                    mdi-plus-circle
                                </v-icon>
                                {{ $t('multisig.newMultisigTransaction') }}
                            </v-btn>
                        </v-col>
                    </v-row>
                    <v-row class="pa-4">
                        <v-col cols="12">
                            <v-row class="pt-3">
                                <v-col cols="4">
                                    {{ $t('multisig.selectMultisigToManage') }}
                                    <v-select 
                                        class="mt-2" 
                                        dense 
                                        :label="!showMultisigWallets ? $t('multisig.noWalletsToManage') : (selectedMultisigWallet ? '' : $t('multisig.selectMultisigToManage'))"
                                        :disabled="!showMultisigWallets" 
                                        v-model="selectedMultisigWallet"
                                        prepend-inner-icon="mdi-account-multiple-outline" 
                                        :items="multisigWallets"
                                        item-text="name" 
                                        item-value="addressBech32" 
                                        outlined 
                                        hide-details
                                        @change="onSelectedWallet">
                                    </v-select>
                                </v-col>
                            </v-row>
                            <v-row>
                                <v-col cols="2.4" v-for="info in walletInfo" :key="info.title">
                                    <v-card :disabled="!showMultisigWallets" dense rounded="lg" outlined>
                                        <v-row class="align-center pa-4 ">
                                            <v-col cols="3" class="pa-0 text-right">
                                                <v-avatar dense tile size="40" class="custom-icon">
                                                    <img :src="info.icon" />
                                                </v-avatar>
                                            </v-col>
                                            <v-col cols="9" class="pa-0">
                                                <v-card-subtitle v-if="info.inlineValue" class="wallet-details pb-0">{{ info.title }}: <span class="wallet-value">{{ info.value }}</span></v-card-subtitle>
                                                <v-card-subtitle v-else class="pb-0">{{ info.title }}</v-card-subtitle>
                                                <v-card-title class="pt-0">{{ filters.toCurrency(info.value, false, 2, '₳', "", true, 2) }}</v-card-title>        
                                            </v-col>
                                        </v-row>
                                    </v-card> 
                                </v-col>
                            </v-row>
                        </v-col>
                    </v-row>
                </v-card>
                <v-row class="mt-4">
                    <v-col cols="9">
                        <v-text-field v-model="search" append-icon="mdi-magnify" label="Search" single-line hide-details
                            outlined dense></v-text-field>
                    </v-col>
                    <v-col cols="3" class="text-center align-center justify-center">
                        <v-btn small outlined color="#CCC" @click="selectDates" class="mt-1 text-caption text-capitalize">
                            <v-icon small left>mdi-calendar</v-icon>
                            Select Dates
                        </v-btn>
                        &nbsp;
                        <v-btn small outlined color="#CCC" @click="applyFilters" class="mt-1 text-caption text-capitalize">
                            <v-icon small left>mdi-filter</v-icon>
                            Apply Filters
                        </v-btn>
                    </v-col>
                </v-row>

                <v-row class="mt-4">
                    <v-col cols="12">
                        <v-data-table 
                            :headers="headers" 
                            :items="pendingTransactions" 
                            :items-per-page="5"
                            class="multisig-table" 
                            :loading="loading" 
                            loading-text="Loading transactions..."
                            no-data="No pending multisig transactions"
                            :search="search"
                            hide-default-footer>
                        </v-data-table>
                    </v-col>
                </v-row>
            </v-container>
        </div>
        <CreateMultisigWalletDialog :isOpen="showCreateMultisigDialog" @close="showCreateMultisigDialog = false">
        </CreateMultisigWalletDialog>
        <FundWallet :isOpen="showFundWallet" @close="showFundWallet = false"
            :recipientAddressProp="selectedAddress" :isMultisig="true"></FundWallet>
        <MultisigTransactionDialog :isOpen="showNewMultisigTransaction" @close="catchCloseDialog" />
    </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

import CreateMultisigWalletDialog from '@/modules/multisig/dialogs/CreateMultisigWallet.vue';
import FundWallet from '@/modules/dashboard/dialogs/SendDialog.vue';
import MultisigTransactionDialog from '@/modules/multisig/dialogs/MultisigTransaction.vue';
import { MessageTypes } from '@/models/MessageTypes';
import { walletConfigStore } from "@/store/modules/walletConfig";
import { Wallet } from "@/models/wallet";
import { appWallet, useStore } from "@/store";
import { multisigStore } from '@/store/modules/multisig';

import { mapState } from "pinia";
import db from '@/db';
import Dexie from 'dexie';
import networks from "@/shared/utils/networks";
import { NativeScript } from '@emurgo/cardano-serialization-lib-browser';
import filters from "@/shared/utils/filters";       
import { svgAssets } from "@/utils/assets";   

export default defineComponent({
    name: 'MultisigTransactions',
    components: {
        FundWallet,
        CreateMultisigWalletDialog,
        MultisigTransactionDialog
    },
    data() {
        return {
            loading: false,
            showCreateMultisigDialog: false,
            showNewMultisigTransaction: false,
            showFundWallet: false,
            headers: [
                { text: 'Transaction ID', value: 'id' },
                { text: 'Date', value: 'date' },
                { text: 'Amount', value: 'amount' },
                { text: 'Wallet', value: 'wallet' },
                { text: 'Status', value: 'status' },
                { text: 'Actions', value: 'actions', sortable: false },
            ],
            pendingTransactions: [],
            wallets: [],
            multisigWallets: [],
            selectedMultisigWallet: 0,
            selectedAddress: "",
            myStore: useStore(),
            multisigStore: multisigStore(),
            currentWallet: 0,
            search: '',
            startDate: '',
            endDate: '',
            filters,
        };
    },
    computed: {
        ...mapState(useStore, ['loggedWallet']),
        showMultisigWallets() {
            return this.multisigWallets.length > 0;
        },
        walletInfo() {
            const currentWallet = this.multisigWallets.find(wallet => wallet.id === this.currentWallet);
            return [
                {
                    icon: svgAssets.multisigDollar,
                    title: "Balance",
                    value: currentWallet?.balance || 0,
                    inlineValue: false
                },
                {
                    icon: svgAssets.multisigTotal,
                    title: "Total",
                    value: currentWallet?.total || 0,
                    inlineValue: true
                },
                {
                    icon: svgAssets.multisigPaid,
                    title: "Paid",
                    value: currentWallet?.paid || 0,
                    inlineValue: true
                },
                {
                    icon: svgAssets.multisigPending,
                    title: "Pending",
                    value: currentWallet?.pending || 0,
                    inlineValue: true
                },
                {
                    icon: svgAssets.multisigExpired,
                    title: "Expired",
                    value: currentWallet?.expired || 0,
                    inlineValue: true
                }
            ]
        }
    },
    mounted() {
        this.initialLoad();
    },
    methods: {
        async initialLoad() {
            console.log("loading data");
            this.loading = true;
            try {
                const dbWallet = new Dexie('wallet-' + this.loggedWallet.id);
                await dbWallet.open();
                let multisigs = await dbWallet.table('multisig').toArray();
                if (multisigs.length > 0) {
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
                    console.log("multisig wallets:::", this.multisigWallets);
                    this.selectedMultisigWallet = multisigs[0];
                    this.multisigStore.setSelectedMultisig(multisigsOriginal[0]);
                    this.selectedAddress = multisigs[0].addressBech32;
                    console.log("all wallets now:::", multisigs);
                }
            } catch (error) {
                console.log('Failed to load multisig data:', error);
            } finally {
                this.loading = false;
            }
        },

        getStatusColor(status) {
            if (status.includes('Awaiting')) return 'warning';
            if (status.includes('Partially')) return 'info';
            if (status.includes('Completed')) return 'success';
            if (status.includes('Rejected')) return 'error';
            return 'grey';
        },

        viewTransaction(transaction) {
            console.log('View transaction:', transaction);
        },

        signTransaction(transaction) {
            console.log('Sign transaction:', transaction);
        },

        createNewTransaction() {
            console.log('Create new multisig transaction');
        },

        createNewWallet() {
            console.log('Create new multisig wallet');
        },

        onSelectedWallet(selectedValue) {
            this.selectedAddress = selectedValue;
            console.log("selected item changed to::", typeof selectedValue);
            console.log("Selected multisig wallet object:::" + typeof this.selectedMultisigWallet + "::" + this.selectedMultisigWallet);
            const selected = this.multisigWallets.filter(imultisig => imultisig.addressBech32 === selectedValue);
            this.selectedMultisigWallet = selected as any;
            console.log("Selected Address:::", this.selectedAddress);
        },

        fundMultisigWallet() {
            console.log("show the funding dialog form.");
            this.showFundWallet = true;
        },

        showMultisigWalletDetails() {
            console.log("render the multisig create dialog but with the selected multisig rendered, only name should be editable.");
        },

        selectDates() {
            console.log("show the date picker dialog");
        },

        applyFilters() {
            console.log("apply the filters");
        },

        catchCloseDialog() {
            console.log('catchCloseDialog called');
            this.showNewMultisigTransaction = false;
            // Any other cleanup or state management you need
        }
    },
    filters,
});
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

.wallet-name, .wallet-value {
    font-weight: 600;
    font-size: 16px;
    color: #f5f5f5;
}

.wallet-details {
    font-size: 14px;
    color: #94969c;
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
    width: 24px;
    /* Set the width of the icon */
    height: 24px;
    /* Set the height of the icon */
    margin-right: 8px;
    /* Space between the icon and text */
    vertical-align: middle;
    /* Align the icon vertically with the text */
    display: inline-block;
    /* Ensure the icon behaves like an inline element */
}
</style>