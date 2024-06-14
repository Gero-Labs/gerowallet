<template>
  <div>
    <div class="d-flex">
      <div class="col-6">
        <h2>Wallet Name</h2>
        <p class="helper  my-0">Edit your wallet name</p>
      </div>
      <div class="col-6">
        <v-text-field disabled outlined dense v-model="walletName"></v-text-field>
      </div>
    </div>

    <div class="d-flex">
      <div class="col-6">
        <h2>Wallet Profile Picture</h2>
        <p class="helper">Choose a profile picture for your wallet</p>
      </div>
      <div class="col-6 d-flex justify-space-between">
        <div>
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

        </div>
        <div>
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
        </div>


      </div>
    </div>

    <div class="d-flex">
      <div class="col-6">
        <h2>Currency Preference</h2>
        <p class="helper">Choose your preferred currency</p>
      </div>
      <div class="col-6">
        <v-select
          :items="currencies"
          outlined
          dense
          v-model="selectedCurrency"
        ></v-select>
      </div>
    </div>

    <div class="d-flex">
      <div class="col-6">
        <h2>Display Language</h2>
        <p class="helper">Set the language for Gero Dashboard</p>
      </div>
      <div class="col-6">
        <v-text-field disabled outlined dense value="English"></v-text-field>
      </div>
    </div>

    <div class="d-flex">
      <div class="col-6">
        <h2>Region</h2>
        <p class="helper">Choose region, affects dates & time</p>
      </div>
      <div class="col-6">
        <v-text-field outlined disabled dense value="English (US)"></v-text-field>
      </div>
    </div>


  </div>

</template>

<script>
export default {
  data: () => ({
    currencies: ['USD', 'AUD', 'CAD', 'EUR', 'GBP'],
    selectedCurrency: 'USD',
    walletName:'MyWalletName'
  }),
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
