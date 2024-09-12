<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Your Rewards" subtitle="View your pending and historical rewards">
    <div style="z-index: 3" class="px-4">
      <v-row>
        <v-col cols="12" xl="7" lg="7" md="7">
          <div class="card-text" style="height: 190px">
            <div style="justify-content: flex-start; align-items: center; gap: 16px; display: inline-flex" v-if="!isClaim">
              <div style="flex-direction: column; justify-content: flex-start; align-items: flex-start; gap: 16px; display: inline-flex">
                <div style="align-self: stretch; justify-content: center; align-items: center; gap: 12px; display: inline-flex">
                  <v-avatar size="48" class="avatar-bg">
                    <v-icon color="#00DFF3">mdi-gift-outline</v-icon>
                  </v-avatar>
                  <div class="header-text">Ready to Claim</div>
                </div>
                <div class="amount-section">
                  <div class="amount">
                    <div class="highlight-text">{{ eligible ? (eligible.tokenAmount * 1000000) : 0 | toCurrency(false, 2, "", (eligible ? " "+eligible.tokenSymbol : ""), false, 6) }}</div>
                  </div>
                  <div class="usd-amount" v-if="eligible">
                    <div class="usd-text">Total Value: {{ eligible?.totalEstimatedUsd | toCurrency(false, 2, '$', '', false, 0) }}</div>
                  </div>
                  <span v-if="eligible">Minimum to claim: {{ eligible ? (eligible.minimumClaimThreshold * 1000000) : 0 | toCurrency(false, 2, "", (eligible ? " "+eligible.tokenSymbol : ""), false, 6) }}</span>
                </div>
              </div>
              <v-btn class="geroButton" icon height="100" width="100" style="letter-spacing: normal; font-size: 24px; text-transform: capitalize; color: black!important; background: linear-gradient(134deg, #00C7F3 40%, #00FFD1 100%);" :disabled="!eligible || eligible.minimumClaimThreshold > eligible.tokenAmount" @click="toggleClaim(true)">Claim</v-btn>
            </div>
            <div style="justify-content: flex-start; align-items: start; display: inline-flex; flex-flow: column;" v-else>
              <v-form>
                <div style="position: relative; top: -6px; left: -56px">
                  <v-btn text small plain @click="isClaim = false" class="px-0" :ripple="false">
                    <v-icon class="mr-1" small>
                      mdi-arrow-left
                    </v-icon>Back
                  </v-btn>
                </div>
                <div>
                  <v-slider label="Claim Amt." hide-details thumb-label="always" v-model="amountToClaim" :min="eligible.minimumClaimThreshold" :max="eligible.tokenAmount">
                    <template v-slot:thumb-label="{ value }">
                      <span style="font-size: 9px">
                        {{ value * 1000000 | toCurrency(false, 2, '₳', '', false, 6)  }}
                      </span>
                    </template>
                  </v-slider>
                  <v-tooltip
                    v-model="tooltip.enabled"
                    top
                    color="red"
                  >
                    <template v-slot:activator="{ }">
                      <v-text-field
                        flat
                        style="width: 295px; margin: auto"
                        block
                        dense
                        v-model="spendingPassword"
                        outlined
                        label="Spending Password"
                        :type="show1 ? 'text' : 'password'"
                        :rules="[rules.required]"
                        hide-details
                        class="my-2"
                        required
                        :disabled="loading"
                        @keydown.enter.stop="claim"
                      >
                        <template v-slot:append>
                          <v-icon @click="show1 = !show1" tabindex="-1">
                            {{ show1 ? 'mdi-eye' : 'mdi-eye-off' }}
                          </v-icon>
                        </template>
                      </v-text-field>
                    </template>
                    <span>{{ tooltip.text }}</span>
                  </v-tooltip>
                  <v-btn
                    style="width: 295px; color: black!important;"
                    class="geroButton mt-2"
                    :disabled="loading || !spendingPassword"
                    :loading="loading"
                    @click="claim"
                  >Sign and Confirm
                  </v-btn>
                </div>
              </v-form>
            </div>
          </div>
        </v-col>
        <v-col cols="12" xl="5" lg="5" md="5" class="text-center" style="align-content: center;">
          <div>
            <div style="color: white; font-size: 16px; font-weight: 600; line-height: 24px; word-wrap: break-word">Pending Rewards</div>
            <div style="align-self: stretch; color: #A3A3A3; font-size: 30px; font-weight: 600; line-height: 38px; word-wrap: break-word">
              {{ pending ? (pending.tokenAmount * 1000000) : 0 | toCurrency(false, 2, "", (pending ? " "+pending.tokenSymbol : ""), false, 6) }}
            </div>
            <div style="align-self: stretch; text-align: center; color: #737373; font-size: 16px; font-weight: 600; line-height: 38px; word-wrap: break-word">
              {{ pending?.totalEstimatedUsd | toCurrency(false, 2, '$', '', false, 0) }}
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
                <Countdown :deadline="new Date(item.eligibleDate)"></Countdown>
              </template>
              <template v-slot:[`item.tokenAmount`]="{ item }">
                <div>{{item.tokenAmount | toCurrency(false, 2, "", " "+item.tokenSymbol, true, 0) }}</div>
                <div style="color: #475467">{{item.totalEstimatedUsd | toCurrency(false, 2, '$', '', true, 0)}}</div>
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
                          {{ getActionTitle(history.actiom)}}
                        </h2>
                        <div>
                          {{ getActionText(history.actiom)}}
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
                <div>{{ (item.tokenAmount+"") | toCurrency(false, 2, "", " "+item.tokenSymbol, true, 0) }}</div>
              </template>
            </v-data-table>
          </v-card>
        </v-tab-item>
      </v-tabs-items>
    </v-card-text>
  </BaseDialog>
</template>
<script>
import { mapActions, mapState } from 'pinia';
import { appWallet, useStore } from '@/store';
import BaseDialog from '@/shared/components/BaseDialog.vue';
import filters from '@/shared/utils/filters';
import Countdown from "@/shared/components/Countdown.vue";
import { bringStore } from '@/store/modules/bring';
import networks from '@/shared/utils/networks';
import { stringToHex } from '@/shared/utils/converter';
import rules from '@/shared/utils/rules';
import snackbar from '@/plugins/snackbar';

export default {
  name: 'ViewRewardsDialog',
  components: {Countdown, BaseDialog },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  filters,
  computed: {
    ...mapState(bringStore, ['bringCache']),
    ...mapState(useStore, ['loggedWallet', 'baseAddress']),
    eligible() {
      if (this.bringCache && this.bringCache?.data?.eligible?.length > 0) {
        return this.bringCache.data.eligible[0]
      }
      return undefined
    },
    pending() {
      if (this.bringCache && this.bringCache?.data?.totalPendings?.length > 0) {
        return this.bringCache.data.totalPendings[0]
      }
      return undefined
    },
    claims() {
      if (this.bringCache) {
        return this.bringCache.data.movements.claims
      }
      return []
    },
    deals() {
      if (this.bringCache) {
        return this.bringCache.data.movements.deals
      }
      return []
    }
  },
  methods: {
    ...mapActions(bringStore, ['loadBringCache']),
    toggleClaim(val) {
      if (val) {
        this.spendingPassword = ''
      }
      this.isClaim = val
    },
    handleSwitchTab(tab) {
      this.currentTab = tab;
    },
    getColor(action) {
      if (action === 'PURCHASE_POSTED') {
        return 'red'
      } else if (action === 'PURCHASE_APPROVED') {
        return 'green'
      } else { //PURCHASE_CORRECTED
        return 'blue'
      }
    },
    getActionTitle(action) {
      if (action === 'PURCHASE_POSTED') {
        return 'Purchase Made'
      } else if (action === 'PURCHASE_APPROVED') {
        return 'Cashback Eligible'
      } else { //PURCHASE_CORRECTED
        return 'Purchase Updated'
      }
    },
    getActionText(action) {
      if (action === 'PURCHASE_POSTED') {
        return 'A purchase has been successfully completed.'
      } else if (action === 'PURCHASE_APPROVED') {
        return 'Your recent purchase is now eligible for cashback rewards.'
      } else { //PURCHASE_CORRECTED
        return 'The amount or release date of your purchase has been adjusted due to a retailer\'s decision or item return.'
      }
    },
    async claim() {
      const wallet = appWallet
      if (wallet.verifySpendingPassword(this.spendingPassword)) {
        this.loading = true
        try {
          const res = await appWallet.api.claimInit(this.baseAddress, this.baseAddress, networks.resolveCurrencyTicker(this.loggedWallet.chain, this.loggedWallet.network), this.amountToClaim)
          const messageToSign = res.messageToSign
          const res2 = await wallet.signData(stringToHex(this.baseAddress), stringToHex(messageToSign), this.spendingPassword, 0, false)
          const status = await appWallet.api.claimSubmit(this.baseAddress, this.baseAddress, networks.resolveCurrencyTicker(this.loggedWallet.chain, this.loggedWallet.network), this.amountToClaim, messageToSign, res2.signature, res2.key)
          if (status === 202) {
            snackbar.fireSuccess(`Successfully Claimed ${this.amountToClaim} ADA Cashback!`)
            this.spendingPassword = ''
            await this.loadBringCache()
            this.isClaim = false
          }
        } catch (e) {
          if (JSON.parse(e).status === 403) {
            snackbar.setError(`403 Forbidden`)
          }
          console.log(e)
        }
        this.loading = false
      } else if (this.spendingPassword) {
        this.tooltip.enabled = true
        setTimeout(() => {
          this.tooltip.enabled = false;
        }, 3000);
      }
    },
  },
  data: () => ({
    amountToClaim: 0,
    isClaim: false,
    currentTab: 0,
    dealsHeaders: [
      { text: "Retailer Name", align: "start", sortable: true, value: "retailerName"},
      { text: "Available In", align: "center", sortable: true, value: "eligibleDate"},
      { text: "Claimed Amount", align: "center", sortable: true, value: "tokenAmount"},
      { text: '', value: 'data-table-expand' },
    ],
    expanded: [],
    claimHeaders: [
      { text: "Time", align: "start", sortable: true, value: "date"},
      { text: "Claimed Amount", align: "center", sortable: true, value: "tokenAmount"},
    ],
    messageToSign: undefined,
    signature: undefined,
    tooltip: {
      enabled: false,
      text: 'Wrong Spending Password!',
    },
    rules,
    show1: false,
    loading: false,
    spendingPassword: '',
  }),
  mounted() {
      this.amountToClaim = this.eligible?.tokenAmount
  },
  watch: {
    isOpen(val) {
      if (val) {
        // appWallet.api.
      }
    }
  },
};
</script>
<style scoped>
.dialogStyle {
  -webkit-backdrop-filter: blur(12px) brightness(0.2);
  backdrop-filter: blur(12px);
  background: #000000ab;
  border: solid 2px #ffffff44;
}

.card-text {
  width: 100%;
  padding: 24px;
  background: linear-gradient(90deg, rgb(0, 14, 17), rgb(0, 19, 16));
  border-radius: 12px;
  border: 1px solid #00DFF3;
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
  font-size: 24px;
  font-weight: 600;
  line-height: 24px;
  word-wrap: break-word;
}

.amount-section {
  font-weight: 700;
  align-self: stretch;
  height: 76px;
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
  height: 38px;
  display: flex;
  flex-direction: column;
  justify-content: flex-start;
  align-items: center;
  color: #A3A3A3;
}
</style>
