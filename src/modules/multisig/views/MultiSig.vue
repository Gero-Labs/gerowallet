<template>
  <div>
    <v-layout>
      <v-row no-gutters>
        <v-col cols="12" class="pa-2">
          <v-container fluid class="multisig-container">
            <v-card outlined class="liquid-glass">
              <v-card-title class="multisig-title">
                <span>{{ $t('multisig.title') }}</span>
                <v-spacer></v-spacer>
                <v-btn
                  v-if="!multiSigAmountReached"
                  small
                  outlined
                  color="#00DFF3"
                  class="mx-2 text-caption text-capitalize"
                  @click="showCreateMultisigDialog = true"
                >
                  <v-icon small left> mdi-plus-circle </v-icon>
                  {{ $t('multisig.createMultisigWallet') }}
                </v-btn>
                <v-card-subtitle v-else class="multisig-description">
                  {{ $t('multisig.reachedLimit', { limit: MAX_MULTISIG_WALLETS_PER_USER }) }}
                </v-card-subtitle>
                <v-btn
                  v-show="Object.keys(getMultiSigWallet).length != 0"
                  color="#CCC"
                  outlined
                  class="mx-2 text-caption text-capitalize"
                  @click="showNewMultisigTransaction = true"
                >
                  <v-icon small left> mdi-plus-circle </v-icon>
                  {{ $t('multisig.newMultisigTransaction') }}
                </v-btn>
              </v-card-title>
              <v-card-subtitle class="multisig-description">{{ $t('multisig.multisigTransactionDescription') }}</v-card-subtitle>
              <v-card-text>
                <v-row no-gutters>
                  <v-col cols="12">
                    <v-row class="align-end">
                      <v-col cols="4">
                        {{ $t('multisig.selectMultisigToManage') }}
                        <v-select
                          class="mt-2"
                          dense
                          :label="
                            !showMultisigWallets
                              ? $t('multisig.noWalletsToManage')
                              : getMultiSigWallet
                              ? ''
                              : $t('multisig.selectMultisigToManage')
                          "
                          :disabled="!showMultisigWallets"
                          v-model="getMultiSigWallet"
                          prepend-inner-icon="mdi-account-multiple-outline"
                          :items="getMultiSigWallets"
                          item-text="name"
                          item-value="paymentAddress"
                          outlined
                          hide-details
                          @change="onSelectedWallet"
                        ></v-select>
                      </v-col>
                      <v-col cols="auto">
                        <!-- <v-btn v-show="getMultiSigWallet" color="#CCC" outlined class="text-caption text-capitalize"
                          @click="showCreateMultisigDialog = true">
                          <v-avatar dense tile size="20" class="mr-2 custom-icon">
                              <img :src="svgAssets.detailsSvg" />
                          </v-avatar>
                          {{ $t('multisig.showWalletDetails') }}
                      </v-btn> -->
                      </v-col>
                      <v-col cols="auto">
                        <v-btn
                          v-show="Object.keys(getMultiSigWallet).length != 0"
                          color="#CCC"
                          outlined
                          class="text-caption text-capitalize"
                          @click="showFundWallet = true"
                        >
                          <v-avatar dense tile size="20" class="mr-2 custom-icon">
                            <img :src="assets.depositSvg" />
                          </v-avatar>
                          {{ $t('multisig.fundWallet') }}
                        </v-btn>
                      </v-col>
                    </v-row>
                    <v-row>
                      <v-col cols="12">
                        {{ $t('multisig.walletAddress') }}
                        {{ filters.shortenStringWithEllipsis(getMultiSigWallet.paymentAddress, 14) }}
                        <CopyButton
                          ref="copyAddress"
                          x-small
                          :value="getMultiSigWallet.paymentAddress"
                          v-if="getMultiSigWallet.paymentAddress"
                        >
                        </CopyButton>
                      </v-col>
                    </v-row>
                    <v-row>
                      <v-col cols="2.4" v-for="info in walletInfo" :key="info.title">
                        <v-card :disabled="!showMultisigWallets" dense rounded="lg" outlined>
                          <v-list-item>
                            <v-list-item-avatar dense tile size="30" class="custom-icon">
                              <v-img :src="info.icon" alt="" contain />
                            </v-list-item-avatar>
                            <v-list-item-content>
                              <v-list-item-title>
                                {{ info.title }}
                              </v-list-item-title>
                              <v-list-item-subtitle style="color: white">
                                {{ filters.toCurrency(info.value, false, 2, '₳', '', true, 2) }}
                              </v-list-item-subtitle>
                            </v-list-item-content>
                          </v-list-item>
                        </v-card>
                      </v-col>
                    </v-row>
                  </v-col>
                </v-row>
              </v-card-text>
            </v-card>
            <v-row class="mt-4">
              <v-col cols="9">
                <v-text-field
                  v-model="search"
                  append-icon="mdi-magnify"
                  :label="$t('common.search')"
                  single-line
                  hide-details
                  outlined
                  dense
                />
              </v-col>
              <v-col cols="3" class="text-center align-center justify-center">
                <v-btn outlined color="#CCC" @click="selectDates" class="mt-1 text-caption text-capitalize">
                  <v-icon small left>mdi-calendar</v-icon>
                  {{ $t('multisig.selectDates') }}
                </v-btn>
                &nbsp;
                <v-btn outlined color="#CCC" @click="applyFilters" class="mt-1 text-caption text-capitalize">
                  <v-icon small left>mdi-filter</v-icon>
                  {{ $t('multisig.applyFilters') }}
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
                  :loading-text="$t('multisig.loadingTransactions')"
                  :no-data-text="$t('multisig.noPendingTransactions')"
                  :search="search"
                  hide-default-footer
                >
                  <template v-slot:[`item.id`]="{ item }">
                    <a style="color: white" class="mr-1">{{ filters.shortenStringWithEllipsis(item.tx_hash, 14) }}</a>
                    <CopyButton ref="copyAddress" x-small :value="item.tx_hash" v-if="item.tx_hash"></CopyButton>
                  </template>
                  <template v-slot:[`item.date`]="{ item }">
                    {{ new Date(item.time * 1000).toLocaleDateString() }}
                  </template>
                  <template v-slot:[`item.amount`]="{ item }">
                    {{ item.sentAmount ? item.sentAmount : item.receivedAmount }}
                  </template>
                  <template v-slot:[`item.status`]="{ item }">
                    {{ item.status }}
                  </template>
                  <template v-slot:[`item.actions`]="{ item }">
                    <v-btn v-if="item.status === String(t('common.pending'))" small outlined color="#CCC" @click="signTransaction(item)">
                      <v-icon small left>mdi-check</v-icon>
                      {{ $t('multisig.sign') }}
                    </v-btn>
                    <span v-else> - </span>
                  </template>
                </v-data-table>
              </v-col>
            </v-row>
          </v-container>
        </v-col>
      </v-row>
    </v-layout>
    <CreateMultisigWalletDialog
      v-if="!multiSigAmountReached"
      :isOpen="showCreateMultisigDialog"
      @close="catchCloseDialog"
    />
    <FundWallet
      :isOpen="showFundWallet"
      @close="catchCloseDialog"
      :recipientAddressProp="selectedAddress"
      :isMultisig="true"
    />
    <MultisigTransaction
      :isOpen="showNewMultisigTransaction"
      @close="catchCloseDialog"
      :recipientAddressProp="selectedAddress"
      :isMultisig="true"
    />
  </div>
</template>

<script setup lang="ts">
import { useTranslation } from '@/shared/composables/useTranslation';
import { ref, computed, onMounted, toRefs } from 'vue';
import { walletStore } from '@/stores/walletStore';
// import { multisigStore } from '@/stores/modules/multisig';
import Dexie from 'dexie';
import filters from '@/shared/utils/filters';
import assets from '@/utils/assets';
import CreateMultisigWalletDialog from '@/modules/multisig/dialogs/CreateMultisigWallet.vue';
import FundWallet from '@/modules/multisig/dialogs/FundWallet.vue';
import MultisigTransaction from '@/modules/multisig/dialogs/MultisigTransaction.vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import { Transaction, WalletInfo, MultisigWalletInterface } from '@/modules/multisig/types/MultiSigTypes';


const { t } = useTranslation();

const MAX_MULTISIG_WALLETS_PER_USER = 3;

// State
const loading = ref(false);
const showCreateMultisigDialog = ref(false);
const showNewMultisigTransaction = ref(false);
const showFundWallet = ref(false);
const search = ref('');
const selectedAddress = ref('');
const multisigWalletTransactions = ref<Transaction[]>([]);

// Use walletStore for logged wallet information
const { loggedWallet, getWallet } = toRefs(walletStore);
// const multisigStoreInstance = multisigStore();

// Computed wrappers for Pinia getters
// const getMultiSigWallet = computed(() => multisigStoreInstance.getMultiSigWallet);
// const getMultiSigWallets = computed(() => multisigStoreInstance.getMultiSigWallets);
const getMultiSigWallet = computed(() => ({}));
const getMultiSigWallets = computed(() => []);

// Headers for the data table
const headers = [
  { text: String(t('common.date')), value: 'date' },
  { text: String(t('common.amount')), value: 'amount' },
  { text: String(t('common.recipient')), value: 'recipient' },
  { text: String(t('common.status')), value: 'status' },
  { text: String(t('common.actions')), value: 'actions', sortable: false },
];

// Computed
const showMultisigWallets = computed(() => {
  return getMultiSigWallets.value.length > 0;
});

const walletInfo = computed<WalletInfo[]>(() => {
  // const { currentBalance, total, paid, pending, expired } = multisigStoreInstance.calculatedTransactions;
  const { currentBalance, total, paid, pending, expired } = {
    currentBalance: 0,
    total: 0,
    paid: 0,
    pending: 0,
    expired: 0,
  };
  return [
    {
      icon: assets.multisigDollar,
      title: String(t('common.balance')),
      value: currentBalance || 0,
      inlineValue: {
        display: false,
        value: currentBalance || 0,
      },
    },
    {
      icon: assets.multisigTotal,
      title: String(t('common.total')),
      value: total || 0,
      inlineValue: {
        display: true,
        value: total || 0,
      },
    },
    {
      icon: assets.multisigPaid,
      title: String(t('multisig.paid')),
      value: paid || 0,
      inlineValue: {
        display: true,
        value: paid || 0,
      },
    },
    {
      icon: assets.multisigPending,
      title: String(t('common.pending')),
      value: pending || 0,
      inlineValue: {
        display: true,
        value: pending || 0,
      },
    },
    {
      icon: assets.multisigExpired,
      title: String(t('multisig.expired')),
      value: expired || 0,
      inlineValue: {
        display: true,
        value: expired || 0,
      },
    },
  ];
});

const multiSigAmountReached = ref(false);

const checkMultiSigAmount = async () => {
  const multisigTable = await getWallet.value.db.table('multisig');
  const multisigAmount = await multisigTable.count();
  multiSigAmountReached.value = multisigAmount >= MAX_MULTISIG_WALLETS_PER_USER;
};

onMounted(async () => {
  await checkMultiSigAmount();
});

// Methods
const initialLoad = async (): Promise<void> => {
  loading.value = true;
  try {
    const dbWallet = new Dexie('wallet-' + loggedWallet.value.id);
    await dbWallet.open();
    let multisigs = await dbWallet.table('multisig').toArray();
    if (multisigs.length > 0) {
      multisigs = parseMultisigWallets(multisigs) as MultisigWalletInterface[];
      // multisigStoreInstance.setMultiSigWallets(multisigs);
      // await multisigStoreInstance.setSelectedMultisig(
      //   multisigs[0],
      //   loggedWallet.value.chain,
      //   loggedWallet.value.network
      // );
      setSelectedAddress(multisigs[0].paymentAddress || '');
      // await multisigStoreInstance.initAll();
    }
  } catch (error) {
    console.error('Failed to load multisig data:', error);
  } finally {
    loading.value = false;
  }
};

const setSelectedAddress = (address: string): void => {
  selectedAddress.value = address;
};

const parseMultisigWallets = (multisigs: any[]): MultisigWalletInterface[] => {
  multisigs.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  return multisigs.map((row, index) => ({
    index,
    addressBech32: row.paymentAddress || '',
    name: row.name,
    requiredSigners: row.requiredSigners || 1,
    totalSigners: NativeScript.from_hex(row.cbor).get_required_signers().len(),
    multisigScriptCBOR: row.cbor,
    stakeAddress: row.stakeAddress,
    id: row.id,
    chain: row.chain,
    network: row.network,
    createdAt: row.createdAt,
    signers: row.signers,
  }));
};

const onSelectedWallet = (selectedValue: string): void => {
  selectedAddress.value = selectedValue;
  const selected = (getMultiSigWallets.value as MultisigWalletInterface[]).filter(
    multisig => (multisig.addressBech32 || multisig.id) === selectedValue
  );
  if (selected.length > 0) {
    // multisigStoreInstance.multiSigWallet = selected[0];
  }
};

const signTransaction = (transaction: Transaction): void => {
  console.log('Sign transaction:', transaction);
};

const selectDates = (): void => {
  console.log('show the date picker dialog');
};

const applyFilters = (): void => {
  console.log('apply the filters');
};

const catchCloseDialog = (): void => {
  showNewMultisigTransaction.value = false;
  showCreateMultisigDialog.value = false;
  showFundWallet.value = false;
  initialLoad();
};

// Lifecycle hooks
onMounted(() => {
  initialLoad();
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
}

.multisig-card {
  background-color: #0c0e12;
  border-radius: 12px;
  border: 1px solid #1f242f;
}

.multisig-table {
  background-color: transparent;
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

.wallet-name,
.wallet-value {
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
  height: 24px;
  margin-right: 8px;
  vertical-align: middle;
  display: inline-block;
}
</style>
