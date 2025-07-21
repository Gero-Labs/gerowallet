<template>
  <BaseDialog
    :isOpen="isOpen"
    @close="$emit('close')"
    title="Your Rewards"
    subtitle="View your pending and historical rewards"
    :min-height="0"
  >
    <div style="z-index: 3" class="px-4">
      <v-row>
        <v-col cols="12" xl="7" lg="7" md="7">
          <div class="card-text">
            <div style="justify-content: flex-start; align-items: center; gap: 16px; display: inline-flex">
              <div style="flex-direction: column; justify-content: flex-start; align-items: flex-start; display: inline-flex">
                <div style="justify-content: center; align-items: center; display: inline-flex">
                  <div class="header-text">Ready to Claim</div>
                </div>
                <div class="amount-section">
                  <div class="amount">
                    <div class="highlight-text">{{ filters.toCurrency(eligible ? (eligible.tokenAmount * 1000000) : 0, false, 2, "", (eligible ? " "+eligible.tokenSymbol : ""), false, 6) }}</div>
                  </div>
                  <div class="usd-amount" v-if="eligible">
                    <div class="usd-text">{{ filters.toCurrency(eligible?.totalEstimatedUsd, false, 2, '$', '', false, 0) }}</div>
                  </div>
                </div>
              </div>
              <v-btn class="geroButton" :loading="loading" icon height="80" width="80" style="letter-spacing: normal; font-size: 20px; text-transform: capitalize; color: black!important; background: linear-gradient(134deg, #00C7F3 40%, #00FFD1 100%);" :disabled="!eligible || eligible.minimumClaimThreshold > eligible.tokenAmount || loading" @click="claim">Claim</v-btn>
            </div>
          </div>
        </v-col>
        <v-col cols="12" xl="5" lg="5" md="5" class="text-center" style="align-content: center;">
          <div>
            <div style="color: white; font-size: 16px; font-weight: 600; line-height: 24px; word-wrap: break-word">Pending Rewards</div>
            <div style="align-self: stretch; color: #A3A3A3; font-size: 30px; font-weight: 600; line-height: 38px; word-wrap: break-word">
              {{ filters.toCurrency(pending ? (pending.tokenAmount * 1000000) : 0, false, 2, "", (pending ? " "+pending.tokenSymbol : ""), false, 6) }}
            </div>
            <div style="align-self: stretch; text-align: center; color: #737373; font-size: 16px; font-weight: 600; line-height: 38px; word-wrap: break-word">
              {{ filters.toCurrency(pending ? pending?.totalEstimatedUsd : 0, false, 2, '$', '', false, 0) }}
            </div>
          </div>
        </v-col>
      </v-row>
    </div>
    <v-card-title>
      Rewards Details
      <v-spacer></v-spacer>
      <v-btn-toggle mandatory active-class="highlight" @change="handleSwitchTab">
        <v-btn color="black" :value="0" rounded style="text-transform: capitalize"> Deals
          <v-chip small outlined color="#009DAB" style="background-color: #00555C!important; color: #CECFD2;" class="ml-1 px-2">{{deals?.length}}</v-chip>
        </v-btn>
        <v-btn color="black" :value="1" rounded style="text-transform: capitalize" :disabled="claims?.length === 0"> Claims
          <v-chip small outlined color="#009DAB" style="background-color: #00555C!important; color: #CECFD2;" class="ml-1 px-2">{{claims.length}}</v-chip>
        </v-btn>
      </v-btn-toggle>
    </v-card-title>
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1">
      <v-tabs-items v-model="currentTab" class="transparent">
        <v-tab-item :transition="false">
          <v-card outlined>
            <v-data-table
                :headers="dealsHeaders"
                :items="deals"
                hide-default-footer
                class="transparent"
                :header-props="{ 'sort-icon': 'mdi-menu-up' }"
                show-expand
                single-expand
                :expanded.sync="expanded"
                item-key="retailerName"
            >
              <template v-slot:[`item.retailerName`]="{ item }">
                <v-list-item>
                  <v-list-item-avatar :color="item.retailerBackgroundColor">
                    <v-img :src="bringCache.retailerIconBasePath+item.retailerIconPath" contain></v-img>
                  </v-list-item-avatar>
                  <v-list-item-title>{{ item.retailerName }}</v-list-item-title>
                </v-list-item>
              </template>
              <template v-slot:[`item.eligibleDate`]="{ item }">
                <Countdown v-if="item['eligibleDate']" :deadline="new Date(item['eligibleDate'])"></Countdown>
                <span v-else-if="item.status === 'pending'">Pending</span>
                <span v-else-if="item.status === 'completed'">Completed</span>
                <span v-else>N/A</span>
              </template>
              <template v-slot:[`item.tokenAmount`]="{ item }">
                <div>{{ filters.toCurrency(item.tokenAmount, false, 2, "", " "+item.tokenSymbol, true, 0) }}</div>
                <div style="color: #475467" v-if="item.totalEstimatedUsd">{{ filters.toCurrency(item.totalEstimatedUsd, false, 2, '$', '', true, 0) }}</div>
              </template>
              <template v-slot:expanded-item="{ headers, item }">
                <td :colspan="headers.length">
                  <v-timeline v-if="item.history?.length > 0">
                    <v-timeline-item
                        v-for="(history, i) in item.history"
                        :key="i"
                        :color="getColor(history.action)"
                        small
                    >
                      <template v-slot:opposite>
                        <span
                            :class="`headline font-weight-bold ${getColor(history.action)}--text`"
                            v-text="history.year"
                        ></span>
                      </template>
                      <div class="py-4">
                        <h2 :class="`headline font-weight-light mb-4 ${getColor(history.action)}--text`">
                          {{ getActionTitle(history.action)}}
                        </h2>
                        <div>
                          {{ history.description }}
                        </div>
                      </div>
                    </v-timeline-item>
                  </v-timeline>
                  <span v-else>No Data</span>
                </td>
              </template>
            </v-data-table>
          </v-card>
        </v-tab-item>
        <v-tab-item :transition="false">
          <v-card outlined>
            <v-data-table
                :headers="claimHeaders"
                :items="claims"
                hide-default-footer
                class="transparent"
                :header-props="{ 'sort-icon': 'mdi-menu-up' }"
            >
              <template v-slot:[`item.date`]="{ item }">
                {{new Date(item.date).toLocaleString()}}
              </template>
              <template v-slot:[`item.tokenAmount`]="{ item }">
                <div>{{ filters.toCurrency(item.tokenAmount+"", false, 2, "", " "+item.tokenSymbol, true, 0) }}</div>
              </template>
            </v-data-table>
          </v-card>
        </v-tab-item>
      </v-tabs-items>
    </v-card-text>
  </BaseDialog>
</template>
<script setup lang="ts">
import { computed, ref, toRefs } from 'vue';
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import filters from '@/shared/utils/filters';
import Countdown from "@/shared/components/Countdown.vue";
import bringStoreModule from '@/stores/bringStore';
import { bringStore } from '@/stores/bringStore';
import { walletStore } from '@/stores/walletStore';
import networks from '@/utils/networks';
import { stringToHex } from '@/shared/utils/converter';
import snackbar from '@/plugins/snackbar';
import { METHOD } from '@/chrome/config';
import { Address } from '@emurgo/cardano-serialization-lib-browser';
import cashbackApi from '@/api/cashback-api';
import { Messaging } from '@/chrome/messaging';

interface Props {
  isOpen: boolean;
}

defineProps<Props>();
defineEmits<{
  close: [];
}>();

const { bringCache } = toRefs(bringStore);
const { loggedWallet } = toRefs(walletStore);

const currentTab = ref(0);
const expanded = ref([]);
const messageToSign = ref(undefined);
const signature = ref(undefined);
const loading = ref(false);

const dealsHeaders = ref([
  { text: "Retailer Name", align: "start", sortable: true, value: "retailerName"},
  { text: "Available In", align: "center", sortable: true, value: "eligibleDate"},
  { text: "Claimed Amount", align: "center", sortable: true, value: "tokenAmount"},
  { text: '', value: 'data-table-expand' },
]);

const claimHeaders = ref([
  { text: "Time", align: "start", sortable: true, value: "date"},
  { text: "Claimed Amount", align: "center", sortable: true, value: "tokenAmount"},
]);

const baseAddress = computed(() => {
  return loggedWallet.value?.baseAddress;
});

const amountToClaim = computed(() => {
  if (eligible.value) {
    return eligible.value.tokenAmount;
  }
  return 0;
});

const eligible = computed(() => {
  if (bringCache.value && bringCache.value?.data?.eligible?.length > 0) {
    return bringCache.value.data.eligible[0];
  }
  return undefined;
});

const pending = computed(() => {
  if (bringCache.value && bringCache.value?.data?.totalPendings?.length > 0) {
    return bringCache.value.data.totalPendings[0];
  }
  return undefined;
});

const claims = computed(() => {
  if (bringCache.value) {
    return bringCache.value.data.movements.claims;
  }
  return [];
});

const deals = computed(() => {
  if (bringCache.value) {
    return bringCache.value.data.movements.deals;
  }
  return [];
});

const handleSwitchTab = (tab: number) => {
  currentTab.value = tab;
};

const getColor = (action: string) => {
  if (action === 'PURCHASE_POSTED') {
    return 'red';
  } else if (action === 'PURCHASE_APPROVED') {
    return 'green';
  } else { //PURCHASE_CORRECTED
    return 'blue';
  }
};

const getActionTitle = (action: string) => {
  if (action === 'PURCHASE_POSTED') {
    return 'Purchase Made';
  } else if (action === 'PURCHASE_APPROVED') {
    return 'Cashback Eligible';
  } else { //PURCHASE_CORRECTED
    return 'Purchase Updated';
  }
};

const claim = async () => {
  loading.value = true;
  try {
    const res = await cashbackApi.claimInit(baseAddress.value, baseAddress.value, networks.resolveCurrencyTicker(loggedWallet.value.chain, loggedWallet.value.network), amountToClaim.value);
    const messageToSignValue = res.messageToSign;
    const request = {
      method: METHOD.signData,
      data: { address: Address.from_bech32(baseAddress.value).to_hex(), payload: stringToHex(messageToSignValue) },
    };
    const signatureResult = await Messaging.sendToBackground(request);
    if (signatureResult.error) {
      snackbar.setError(signatureResult.error.info);
    } else {
      const status = await cashbackApi.claimSubmit(baseAddress.value, baseAddress.value, networks.resolveCurrencyTicker(loggedWallet.value?.chain, loggedWallet.value?.network), amountToClaim.value, messageToSignValue, signatureResult.data?.signature, signatureResult.data?.key);
      if (status === 202) {
        snackbar.fireSuccess(`Successfully Claimed ${amountToClaim.value} ADA Cashback!`);
        await bringStoreModule.loadBringCache(baseAddress.value);
      }
    }
  } catch (e) {
    snackbar.setError(e);
    console.log(e);
  }
  loading.value = false;
};
</script>
<style scoped>
.card-text {
  width: 100%;
  padding: 10px;
  background-color: #161B26;
  border-radius: 12px;
  border: 1px solid #333741;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
  gap: 24px;
}

.avatar-bg {
  background: linear-gradient(134deg, rgba(0, 199.26, 243, 0.25) 40%, rgba(0, 255, 209.10, 0.25) 100%);
}

.header-text {
  color: white;
  font-size: 14px;
  font-weight: 600;
  line-height: 24px;
  word-wrap: break-word;
}

.amount-section {
  font-weight: 700;
  align-self: stretch;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: start;
}

.amount {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: flex-start;
  gap: 16px;
}

.highlight-text {
  align-self: stretch;
  background: linear-gradient(to right, #00c7f3, #00fad5);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  font-size: 30px;
  line-height: 38px;
  word-wrap: break-word;
}

.usd-amount {
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  color: #A3A3A3;
}
</style>
