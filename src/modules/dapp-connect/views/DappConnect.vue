<template>
  <DappModal title="Connect with Gero Wallet" :website="queryParams?.website">
    <section id="dapp-warning">Confirm URL before granting the access to DApps!</section>

    <section id="dapp-wallet">
      <Select
        :value="wallet"
        :items="[wallet]"
        :readonly="false"
      ></Select>
    </section>

    <section id="dapp-heading">
      Allow the site to:
    </section>

    <section id="dapp-consent">
      <div id="dapp-consent-check">
        <input type="checkbox" v-model="consent" />
        <!-- <v-checkbox dark color="primary" v-model="consent"></v-checkbox> -->
      </div>
      <div id="dapp-consent-text">
        <p>View the address and balance of the selected wallet.</p>
        <br/>
        <p>For your security, any future transactions from this website will require you to enter your spending password
        before signing.</p>
      </div>
    </section>

    <div id="filler" />

    <DappFooter>
      <AppButton type="framed" role="danger" @click="decline">Decline</AppButton>
      <AppButton type="filled" role="primary" @click="confirm" :disabled="!consent">Confirm</AppButton>
    </DappFooter>
  </DappModal>
</template>

<!------------------------------------------------------------------------------ Script -->

<script>
import { useStore } from '@/store';

import Select from '@/shared/components/Select.vue';
import DappModal from '../components/DappModal.vue';
import DappFooter from '../components/DappFooter.vue';
import AppButton from '@/shared/components/AppButton.vue';

export default {
  name: 'dapp-connect',
  components: { DappModal, DappFooter, AppButton, Select },
  data() {
    return {
      queryParams: {},
      consent: false,
      store: useStore,
      wallet: undefined,
    };
  },
  methods: {
    decline() {
      window.close();
    },
    confirm() {
      const url = this.queryParams.website;

      if (!url) {
        throw 'Missing website query parameter';
      }

      this.wallet.addConnectedDapp(url);
    },
  },
  async created() {
    this.queryParams = this.$route.query;

    // TODO: Uncomment for real data.
    // this.wallet = useStore().getWallet;

    this.wallet = {
      name: 'My Wallet',
      icon: 'pink',
    };
  },
};
</script>

<!------------------------------------------------------------------------------ Styles -->

<style scoped>
@import '../style.scss';

#dapp-warning {
  color: black;
  font-size: 16px;
  font-weight: 400;
  line-height: 24px;
  text-align: center;
  background: #00dff3;
}

#dapp-consent {
  display: flex;
  flex-direction: row;
}

#dapp-consent-check {
  display: flex;
  margin-right: 8px;

  &>input[type=checkbox] {
    width: 20px;
    height: 20px;
    /* !! make blue vuetify */
  }
}

#dapp-consent-text {
  width: 400px;
  display: block;
  text-align: left;
}
</style>
