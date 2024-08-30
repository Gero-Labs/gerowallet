<template>
  <v-overlay
    absolute
    :value="value"
    opacity="0.94"
    class="settingsOverlay"
    color="black"
  >
    <v-card class="fill-height transparent">
      <v-card-title class="pb-0">
        <v-btn small icon @click="closeOverlay">
          <v-icon>mdi-swap-vertical-bold</v-icon>
        </v-btn>
        <v-spacer></v-spacer>
        Swap Overview
        <v-spacer></v-spacer>
        <v-btn small icon @click="closeOverlay">
          <v-icon>mdi-window-close</v-icon>
        </v-btn>
        <v-row no-gutters>
          <v-col cols="12" xl="4" lg="4" md="4">
            <v-card-title style="font-size: 14px; text-align: left; color: #88919e" class="text-left px-0 py-2" >
              Bonus Output
            </v-card-title>
            <v-card-subtitle style="font-size: 12px; word-break: break-word" class="text-left pa-0">
              +3,103,751.16 HUNT
            </v-card-subtitle>
          </v-col>
          <v-col cols="12" xl="4" lg="4" md="4">
            <v-card-title style="font-size: 14px; text-align: left; color: #88919e" class="text-left px-0 py-2" >
              Net Price
            </v-card-title>
            <v-card-subtitle style="font-size: 12px; word-break: break-word" class="text-left pa-0">
              39.78 ADA
            </v-card-subtitle>
          </v-col>
          <v-col cols="12" xl="4" lg="4" md="4">
            <v-card-title style="font-size: 14px; text-align: left; color: #88919e" class="text-left px-0 py-2" >
              Min. Receive
            </v-card-title>
            <v-card-subtitle style="font-size: 12px; word-break: break-word" class="text-left pa-0">
              3,042,492.45 HUNT
            </v-card-subtitle>
          </v-col>
          <v-col cols="12" xl="4" lg="4" md="4">
            <v-card-title style="font-size: 14px; text-align: left; color: #88919e" class="text-left px-0 py-2" >
              Order Deposits
            </v-card-title>
            <v-card-subtitle style="font-size: 12px; word-break: break-word" class="text-left pa-0">
              26 ADA
            </v-card-subtitle>
          </v-col>
          <v-col cols="12" xl="4" lg="4" md="4">
            <v-card-title style="font-size: 14px; text-align: left; color: #88919e" class="text-left px-0 py-2" >
              Batchers Fees
            </v-card-title>
            <v-card-subtitle style="font-size: 12px; word-break: break-word" class="text-left pa-0">
              9.5 ADA
            </v-card-subtitle>
          </v-col>
          <v-col cols="12" xl="4" lg="4" md="4">
            <v-card-title style="font-size: 14px; text-align: left; color: #88919e" class="text-left px-0 py-2" >
              Frontend Fee
            </v-card-title>
            <v-card-subtitle style="font-size: 12px; word-break: break-word" class="text-left pa-0">
              123,456.46 ADA
            </v-card-subtitle>
          </v-col>
        </v-row>
        <v-divider></v-divider>
      </v-card-title>
      <v-card-text class="d-flex justify-space-around justify-center flex-column pb-2" style="overflow-y: auto; height: calc(100% - 250px)">
        <v-row no-gutters>
          <v-col cols="6" v-for="(dex,index) in dexes" :key="index" style="height: 38px">
            <v-list-item class="px-2" dense>
              <v-list-item-action class="mr-2 my-0">
                <v-avatar size="24">
                  <v-img :src="dex.img" contain></v-img>
                </v-avatar>
              </v-list-item-action>
              <v-list-item-content>
                <v-list-item-title class="text-left" style="font-size: 10px;">
                  0 ADA
                </v-list-item-title>
                <v-list-item-subtitle>
                  <v-progress-linear height="8">

                  </v-progress-linear>
                </v-list-item-subtitle>
              </v-list-item-content>
            </v-list-item>
          </v-col>
        </v-row>
      </v-card-text>
      <v-card-actions class="justify-center text-center pt-0">
        <v-form ref="form" v-model="valid">
          <v-row no-gutters>
            <v-col cols="4">
              <h4>Tx Fee</h4>
              <h4>v</h4>
            </v-col>
            <v-col cols="4">
              <h4>Tx Fee</h4>
              <h4>b</h4>
            </v-col>
            <v-col cols="4">
              <h4>Tx Fee</h4>
              <h4><strong>a</strong></h4>
            </v-col>
            <v-col cols="8" class="pt-0" style="display: ruby; align-self: center;">
              <v-tooltip
                v-model="tooltip.enabled"
                top
                color="red"
              >
                <template v-slot:activator="{ }">
                  <v-text-field
                    flat
                    style="width: 100%;"
                    block
                    dense
                    v-model="spendingPassword"
                    outlined
                    label="Spending Password"
                    :type="showPassword ? 'text' : 'password'"
                    :rules="passwordRules"
                    hide-details
                    required
                    :disabled="loading"
                  >
                    <template v-slot:append>
                      <v-icon @click="showPassword = !showPassword" tabindex="-1">
                        {{ showPassword ? 'mdi-eye' : 'mdi-eye-off' }}
                      </v-icon>
                    </template>
                  </v-text-field>
                </template>
                <span>{{ tooltip.text }}</span>
              </v-tooltip>
            </v-col>
            <v-col cols="4" style="align-self: center;">
              <v-btn block color="primary" elevation="0" @click="submit" height="40" :disabled="loading || !valid" :loading="loading" class="ml-2 mt-0" style="margin-bottom: 1px">
                Submit
              </v-btn>
            </v-col>
          </v-row>
        </v-form>
      </v-card-actions>
    </v-card>
  </v-overlay>
</template>
<script lang="ts">
import { defineComponent } from 'vue';
import filters from '@/shared/utils/filters';
import networks from '@/shared/utils/networks';
import rules from '@/shared/utils/rules';
import { mapState } from 'pinia';
import { useStore } from '@/store';

export default defineComponent({
  name: 'SwapOverviewOverlay',
  props: {
    value: {
      type: Boolean,
    },
  },
  computed: {
    ...mapState(useStore, ['loggedWallet', 'utxos', 'addresses']),
  },
  watch: {
    isOpen(val) {
      if (val) {
        this.spendingPassword = ''
        if (this.$refs.form) {
          this.$refs.form.resetValidation()
        }
      }
    },
    spendingPassword() {
      this.passwordRules = [
        rules.required
      ]
    }
  },
  methods: {
    submit() {

    },
    closeOverlay() {
      this.$emit('input', false);
    },
  },
  filters,
  data: () => ({
    networks,
    loading: false,
    spendingPassword: '',
    showPassword: false,
    tooltip: {
      enabled: false,
      text: 'Wrong Spending Password!',
    },
    valid: false,
    passwordRules: [
      rules.required
    ],
    dexes: [
      { img: 'https://storage.googleapis.com/dexhunter-images/public/splashlogo.jpeg', amount: 0, priceImpact: 0 },
      { img: 'https://storage.googleapis.com/dexhunter-images/public/minswap.png', amount: 0, priceImpact: 0 },
      { img: 'https://storage.googleapis.com/dexhunter-images/public/sundaev3.webp', amount: 0, priceImpact: 0 },
      { img: 'https://storage.googleapis.com/dexhunter-images/public/axo.jpeg', amount: 0, priceImpact: 0 },
      { img: 'https://storage.googleapis.com/dexhunter-images/public/vyfi.png', amount: 0, priceImpact: 0 },
      { img: 'https://storage.googleapis.com/dexhunter-images/public/wingriders.png', amount: 0, priceImpact: 0 },
      { img: 'https://storage.googleapis.com/dexhunter-images/public/spectrum.png', amount: 0, priceImpact: 0 },
      { img: 'https://storage.googleapis.com/dexhunter-images/public/sundae.png', amount: 0, priceImpact: 0 },
    ]
  }),
});
</script>
<style scoped>
.v-list-item__content {
  padding: 4px 0;
}
</style>
