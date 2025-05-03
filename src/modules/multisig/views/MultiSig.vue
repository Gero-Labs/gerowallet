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
                        <v-col :cols="multisigStore.getMultiSigWallet ? 2 : 4" class="text-right">
                            <v-btn color="#CCC" outlined class="ma-4 text-caption text-capitalize"
                                @click="showCreateMultisigDialog = true">
                                <v-icon small left>
                                    mdi-plus-circle
                                </v-icon>
                                {{ $t('multisig.createMultisigWallet') }}
                            </v-btn>
                        </v-col>
                        <v-col cols="2" v-show="multisigStore.getMultiSigWallet">
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
                                        :label="!showMultisigWallets ? $t('multisig.noWalletsToManage') : (multisigStore.getMultiSigWallet ? '' : $t('multisig.selectMultisigToManage'))"
                                        :disabled="!showMultisigWallets" 
                                        v-model="multisigStore.getMultiSigWallet"
                                        prepend-inner-icon="mdi-account-multiple-outline" 
                                        :items="multisigStore.getMultiSigWallets"
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
                                                <v-card-subtitle v-if="info.inlineValue.display" class="wallet-details pb-0">{{ info.title }}: <span class="wallet-value">{{ info.inlineValue.value }}</span></v-card-subtitle>
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
                            :items="multisigWalletTransactions" 
                            :items-per-page="10"
                            class="multisig-table" 
                            :loading="loading" 
                            loading-text="Loading transactions..."
                            no-data="No pending multisig transactions"
                            :search="search"
                            hide-default-footer>
                            <template v-slot:[`item.id`]="{ item }">
                                <CopyButton :value="item.tx_hash" />
                            </template>
                            <template v-slot:[`item.date`]="{ item }">
                                {{ new Date(item.time * 1000).toLocaleDateString() }}
                            </template>
                            <template v-slot:[`item.amount`]="{ item }">
                                {{ item.amount }}
                            </template>
                            <template v-slot:[`item.wallet`]="{ item }">
                                {{ item.wallet }}
                            </template>
                            <template v-slot:[`item.status`]="{ item }">
                                {{ item.status }}
                            </template>
                        </v-data-table>
                    </v-col>
                </v-row>
            </v-container>
        </div>
        <CreateMultisigWalletDialog :isOpen="showCreateMultisigDialog" @close="catchCloseDialog">
        </CreateMultisigWalletDialog>
        <FundWallet :isOpen="showFundWallet" @close="catchCloseDialog"
            :recipientAddressProp="selectedAddress" :isMultisig="true"></FundWallet>
        <MultisigTransactionDialog :isOpen="showNewMultisigTransaction" @close="catchCloseDialog" />
    </div>
</template>

<script lang="ts">
import { defineComponent } from 'vue';

import CreateMultisigWalletDialog from '@/modules/multisig/dialogs/CreateMultisigWallet.vue';
import FundWallet from '@/modules/dashboard/dialogs/SendDialog.vue';
import MultisigTransactionDialog from '@/modules/multisig/dialogs/MultisigTransaction.vue';
import { useStore } from "@/store";
import { multisigStore } from '@/store/modules/multisig';

import { mapState } from "pinia";
import Dexie from 'dexie';
import { NativeScript } from '@emurgo/cardano-serialization-lib-browser';
import filters from "@/shared/utils/filters";       
import { svgAssets } from "@/utils/assets";   
import CopyButton from "@/shared/components/CopyButton.vue";

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
            multisigWalletTransactions: [],
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
        ...mapState(multisigStore, ['multiSigWallets', 'multiSigWallet']),
        showMultisigWallets() {
            return this.multisigStore.getMultiSigWallets.length > 0;
        },
        walletInfo() {
            const calculatedTransactions = this.multisigStore.calculatedTransactions;
            return [
                {
                    icon: svgAssets.multisigDollar,
                    title: "Balance",
                    value: calculatedTransactions?.ada || 0,
                    inlineValue: {
                        display: false,
                        value: calculatedTransactions?.ada || 0
                    }
                },
                {
                    icon: svgAssets.multisigTotal,
                    title: "Total",
                    value: calculatedTransactions?.total || 0,
                    inlineValue: {
                        display: true,
                        value: calculatedTransactions?.total || 0
                    }
                },
                {
                    icon: svgAssets.multisigPaid,
                    title: "Paid",
                    value: calculatedTransactions?.paid || 0,
                    inlineValue: {
                        display: true,
                        value: calculatedTransactions?.paid || 0
                    }
                },
                {
                    icon: svgAssets.multisigPending,
                    title: "Pending",
                    value: calculatedTransactions?.pending || 0,
                    inlineValue: {
                        display: true,
                        value: calculatedTransactions?.pending || 0
                    }
                },
                {
                    icon: svgAssets.multisigExpired,
                    title: "Expired",
                    value: calculatedTransactions?.expired || 0,
                    inlineValue: {
                        display: true,
                        value: calculatedTransactions?.expired || 0
                    }
                }
            ]
        }
    },
    mounted() {
        this.initialLoad();
    },
    methods: {
        async initialLoad() {
            this.loading = true;
            try {
                const dbWallet = new Dexie('wallet-' + this.loggedWallet.id);
                await dbWallet.open();
                let multisigs = await dbWallet.table('multisig').toArray();
                if (multisigs.length > 0) {
                    //sort by latest first
                    this.parseMultisigWallets(multisigs);
                    this.multisigStore.setMultiSigWallets(multisigs);
                    await this.multisigStore.setSelectedMultisig(multisigs[0], this.loggedWallet.chain, this.loggedWallet.network);
                    this.setMultisigWalletTransactions();
                    this.setSelectedAddress(multisigs[0].addressBech32);
                }
            } catch (error) {
                console.log('Failed to load multisig data:', error);
            } finally {
                this.loading = false;
            }
        },

        setMultisigWalletTransactions() {
            this.multisigWalletTransactions = this.multisigStore.calculatedTransactions;
        },

        setSelectedAddress(address) {
            this.selectedAddress = address;
        },

        parseMultisigWallets(multisigs) {
            multisigs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
            multisigs = multisigs.map((row, index) => ({
                index,
                addressBech32: row.id, //multisig address
                name: row.name,
                signaturesRequired: row.requiredSigners || 1,
                totalSigners: NativeScript.from_hex(row.multisigScriptCBOR).get_required_signers().len(),
                scriptCBOR: row.multisigScriptCBOR,
                stakeAddress: row.stakeAddress,
                multisigDBName: this.multisigStore.generateMultisigDBName(this.loggedWallet.publicKey, row.name)
            }));
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
            const selected = this.multisigWallets.filter(imultisig => imultisig.addressBech32 === selectedValue);
            this.multiSigWallet = selected[0];
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
            this.showCreateMultisigDialog = false;
            this.showFundWallet = false;
            this.initialLoad();
        },
        parseTransactions(transactions) {
            const parsedTransactions = transactions.map(transaction => {
                return {
                    id: transaction.tx_hash,
                    date: new Date(transaction.tx_timestamp).toLocaleDateString(),
                    amount: transaction.amount,
                    wallet: transaction.wallet,
                    status: transaction.status,
                    actions: transaction.actions,
                }
            });
            console.log("parsed transactions:::", parsedTransactions);
            this.setTransactions(parsedTransactions);
        },

        setTransactions(parsedTransactions) {
            this.multisigWalletTransactions = parsedTransactions;
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