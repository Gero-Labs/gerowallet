<template>
  <v-tab-item>
    <v-layout class="py-2" column>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3>Wallet Name</h3>
          <span class="helper  my-0">Edit your wallet name</span>
        </v-col>
        <v-col cols="5" style="align-content: center;">
          <v-text-field disabled outlined dense v-model="walletName" hide-details></v-text-field>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3>Wallet Profile Picture</h3>
          <span class="helper">Choose a profile picture for your wallet</span>
        </v-col>
        <v-col cols="5" class="d-flex justify-space-between" style="align-content: center; flex-flow: wrap;">
          <v-row no-gutters>
            <v-col cols="12" class="text-center py-2">
              <v-avatar size="100" rounded>
                <v-img v-if="loggedWallet" :src="avatar"></v-img>
              </v-avatar>
            </v-col>
            <v-col cols="12" class="py-2">
              <v-btn
                block
                outlined
                color="grey"
                autocapitalize="on"
                disabled
              >
                <span class="capitalize">Upload Picture</span>
                <v-icon
                  right
                  dark
                > mdi-cloud-upload-outline
                </v-icon>
              </v-btn>
            </v-col>
            <v-col cols="12" class="py-2">
              <v-btn
                block
                outlined
                color="grey"
                disabled
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
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3>Currency Preference</h3>
          <span class="helper">Choose your preferred currency</span>
        </v-col>
        <v-col cols="5" style="align-content: center;">
          <v-select
            :items="currencies"
            outlined
            dense
            v-model="selectedCurrency"
            hide-details
            return-object
            disabled
          ></v-select>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3>Display Language</h3>
          <span class="helper">Set the language for Gero Dashboard</span>
        </v-col>
        <v-col cols="5" style="align-content: center;">
          <v-select v-model="loc" :items="Object.values(languages)" item-text="name" outlined dense hide-details disabled>
            <template v-slot:item="{ item }">
              <v-list-item-avatar size="20">
                <flag :iso="item.iso" style="font-size: 20px;"></flag>
              </v-list-item-avatar>
              <v-list-item-content>
                <v-list-item-title class="text-center">{{ item.name }}</v-list-item-title>
              </v-list-item-content>
            </template>
            <template v-slot:selection="{ item }">
              <v-list-item dense style="min-height: 32px; height: 32px;">
                <v-list-item-avatar size="20">
                  <flag :iso="item.iso" style="font-size: 20px;"></flag>
                </v-list-item-avatar>
                <v-list-item-content class="py-0">
                  <v-list-item-title class="text-center">{{ item.name }}</v-list-item-title>
                </v-list-item-content>
              </v-list-item>
            </template>
          </v-select>
          <!--          <v-text-field disabled outlined dense value="English" hide-details></v-text-field>-->
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3>Region</h3>
          <span class="helper">Choose region, affects dates & time</span>
        </v-col>
        <v-col cols="5" style="align-content: center;">
          <v-text-field outlined disabled dense value="English (US)" hide-details></v-text-field>
        </v-col>
      </v-row>
      <v-row no-gutters class="py-2">
        <v-col cols="7" class="text-left">
          <h3>Welcome Guide</h3>
          <span class="helper">Display the introductory guide to help you navigate your wallet (temporarily disabled).</span>
        </v-col>
        <v-col cols="5" style="align-content: center;">
          <v-btn
            block
            outlined
            color="grey"
            @click="showGuide"
          >
            <span class="capitalize">Show Guide</span>
          </v-btn>
        </v-col>
      </v-row>
    </v-layout>
  </v-tab-item>
</template>
<script>
import { mapActions, mapState } from 'pinia';
import { useStore } from '@/store';
import languages from '@/plugins/languages';
import assets from '@/utils/assets';

export default {
  name: 'ProfileTab',
  computed: {
    ...mapState(useStore, ['loggedWallet', 'locale']),
    avatar() {
      if (this.loggedWallet.icon.includes('http')) {
        return this.loggedWallet.icon;
      } else {
        return assets.resolveIcon(this.loggedWallet.icon);
      }
    },
  },
  watch: {
    loc(val) {
      if (val) {
        const iso = Object.values(this.languages).find(value => value.name === val).iso;
        this.setLocale(iso);
        this.$i18n.locale = iso;
      }
    },
  },
  methods: {
    ...mapActions(useStore, ['setLocale', 'setWelcomeDone']),
    showGuide() {
      this.$emit('close');
      this.setWelcomeDone(false);
    }
  },
  data: () => ({
    languages,
    currencies: ['USD', 'AUD', 'CAD', 'EUR', 'GBP'],
    selectedCurrency: 'USD',
    walletName: 'MyWalletName',
    loc: undefined,
    assets,
  }),
  created() {
    console.log(this.loggedWallet);
    this.walletName = this.loggedWallet.name;
    this.loc = this.languages[this.locale].name;
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
