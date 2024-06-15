<template>
  <v-tab-item>
    <v-layout class="py-2" column>
      <v-row no-gutters class="py-2">
        <v-col cols="6">
          <h3>Wallet Name</h3>
          <span class="helper  my-0">Edit your wallet name</span>
        </v-col>
        <v-col cols="6">
          <v-text-field disabled outlined dense v-model="walletName" hide-details></v-text-field>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="6">
          <h3>Wallet Profile Picture</h3>
          <span class="helper">Choose a profile picture for your wallet</span>
        </v-col>
        <v-col cols="6" class="d-flex justify-space-between">
          <v-btn
            width="11.25rem"
            outlined
            color="grey"
            autocapitalize="on"
          >
            <span class="capitalize">Upload Picture</span>
            <v-icon
              right
              dark
            > mdi-cloud-upload-outline
            </v-icon>
          </v-btn>
          <v-btn
            width="11.25rem"
            outlined
            color="grey"
          >
            <span class="capitalize">Choose NFT</span>
            <v-icon
              right
              dark
            >
              mdi-account-box-outline
            </v-icon>
          </v-btn>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="6">
          <h3>Currency Preference</h3>
          <span class="helper">Choose your preferred currency</span>
        </v-col>
        <v-col cols="6">
          <v-select
            :items="currencies"
            outlined
            dense
            v-model="selectedCurrency"
            hide-details
          ></v-select>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="6">
          <h3>Display Language</h3>
          <span class="helper">Set the language for Gero Dashboard</span>
        </v-col>
        <v-col cols="6">
          <v-text-field disabled outlined dense value="English" hide-details></v-text-field>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="6">
          <h3>Region</h3>
          <span class="helper">Choose region, affects dates & time</span>
        </v-col>
        <v-col cols="6">
          <v-text-field outlined disabled dense value="English (US)" hide-details></v-text-field>
        </v-col>
      </v-row>
    </v-layout>
  </v-tab-item>
</template>
<script>
import { mapActions, mapState } from 'pinia';
import { useStore } from '@/store';

export default {
  computed: {
    ...mapState(useStore, ['loggedWallet']),
  },
  data: () => ({
    currencies: ['USD', 'AUD', 'CAD', 'EUR', 'GBP'],
    selectedCurrency: 'USD',
    walletName:'MyWalletName'
  }),
  created() {
    console.log(this.loggedWallet)
    this.walletName = this.loggedWallet.name
  }
};
</script>

<style scoped>
h2 {
  font-size: 1.125rem;
  font-weight: 600;
  line-height: 1.75rem;
  color: #F5F5F6;
}

.helper {
  font-size: 0.875rem;
  font-weight: 400;
  line-height: 1.25rem;
  color: #94969C;
}

.col-6 {
  padding: 0 !important;
}

.capitalize {
  text-transform: capitalize !important;
}

</style>
