<template>
  <DappModal title="Sign Data" :website="queryParams?.website">
    <section id="dapp-wallet">
      <Select :value="wallet" :items="[wallet]" :readonly="false"></Select>
    </section>

    <section id="dapp-heading">The website requested a signature</section>

    <section id="dapp-sign-details">
      <p>{{ message }}</p>
    </section>

    <div id="filler" />

    <DappFooter>
      <v-text-field
        dark
        outlined
        hide-details
        type="password"
        v-model="password"
        style="grid-column: 1 / 3"
        placeholder="Type your spending password"
      />
      <AppButton type="framed" role="danger" @click="decline">Decline</AppButton>
      <AppButton type="filled" role="primary" @click="confirm" :disabled="!password">Confirm & Sign</AppButton>
    </DappFooter>
  </DappModal>
</template>

<!------------------------------------------------------------------------------ Script -->

<script scoped>
import { useStore } from '@/store';

import Select from '@/shared/components/Select.vue';
import DappModal from '../components/DappModal.vue';
import DappFooter from '../components/DappFooter.vue';
import AppButton from '@/shared/components/AppButton.vue';

export default {
  name: 'dapp-sign',
  components: { DappModal, DappFooter, AppButton, Select },
  data() {
    return {
      queryParams: {},
      message: '',
      password: '',
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

      if (!url) throw 'Missing website query parameter';

      // TODO: Sign the message.
      throw 'Not implemented';
    },
  },
  async created() {
    this.queryParams = this.$route.query;

    // TODO: Real data sources.
    // this.wallet = useStore().getWallet;

    // Mock data.
    this.wallet = {
      name: 'My Wallet',
      icon: 'pink',
    };

    this.message = `Wallet Address Verification Request.

      Click to verify your wallet address and accept adabox.io terms of service: https://adabox.io/tos

      Verification Hash:
      129387197812498fjqf92urfkjasflkj128urakjfalksfjalj12489usflkjasflkajsf098123klojflkajsflkajfs09812u3lkjasflkjaslkfj901823klojaslkjaslfkjasflkj

      Click to verify your wallet address and accept adabox.io terms of service: https://adabox.io/tos

      Verification Hash:
      129387197812498fjqf92urfkjasflkj128urakjfalksfjalj12489usflkjasflkajsf098123klojflkajsflkajfs09812u3lkjasflkjaslkfj901823klojaslkjaslfkjasflkj

      Click to verify your wallet address and accept adabox.io terms of service: https://adabox.io/tos

      Verification Hash:
      129387197812498fjqf92urfkjasflkj128urakjfalksfjalj12489usflkjasflkajsf098123klojflkajsflkajfs09812u3lkjasflkjaslkfj901823klojaslkjaslfkjasflkj

      Click to verify your wallet address and accept adabox.io terms of service: https://adabox.io/tos

      Verification Hash:
      129387197812498fjqf92urfkjasflkj128urakjfalksfjalj12489usflkjasflkajsf098123klojflkajsflkajfs09812u3lkjasflkjaslkfj901823klojaslkjaslfkjasflkj

      Click to verify your wallet address and accept adabox.io terms of service: https://adabox.io/tos

      Verification Hash:
      129387197812498fjqf92urfkjasflkj128urakjfalksfjalj12489usflkjasflkajsf098123klojflkajsflkajfs09812u3lkjasflkjaslkfj901823klojaslkjaslfkjasflkj
    `;
  },
};
</script>

<!------------------------------------------------------------------------------ Styles -->

<style scoped>
@import '../style.scss';

#dapp-sign-details {
  max-height: 274px;
  overflow-y: auto;
}

#dapp-sign-details > p {
  padding: 8px;
  color: white;
  font-size: 16px;
  font-weight: 500;
  text-align: left;
  line-height: 20px;
  background: #141414;
  word-wrap: break-word;
  white-space: pre-line;
}
</style>
