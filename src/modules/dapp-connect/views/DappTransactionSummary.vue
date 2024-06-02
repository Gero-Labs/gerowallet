<template>
  <DappModal title="Transaction Summary" :website="queryParams?.website">
    <section id="dapp-receiver">
      <DappAddress :address="queryParams?.receiver" :risk="risks?.addressRisk" />
    </section>

    <section id="dapp-wallet">
      <Select :value="wallet" :items="[wallet]" :readonly="false" />
    </section>

    <section>
      <TransactionCard :transaction="transaction.give" :risk="risks?.givingRisk">
        You're giving
      </TransactionCard>
    </section>

    <section>
      <TransactionCard :transaction="transaction.receive" :risk="risks?.receivingRisk">
        You're receiving
      </TransactionCard>
    </section>

    <section id="dapp-tx-risk">
      <TransactionRisk :risk="risks?.score" />
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

<script>
import { useStore } from '@/store';

import { DappRisk, DappScore } from '@/models/dapp/statuses.enum';

import Select from '@/shared/components/Select.vue';
import DappModal from '../components/DappModal.vue';
import DappFooter from '../components/DappFooter.vue';
import DappAddress from '../components/DappAddress.vue';
import AppButton from '@/shared/components/AppButton.vue';
import TransactionRisk from '../components/TransactionRisk.vue';
import TransactionCard from '../components/TransactionCard.vue';

export default {
  name: 'dapp-sign',
  components: { DappModal, DappFooter, DappAddress, TransactionCard, TransactionRisk, AppButton, Select },
  data() {
    return {
      password: '',
      store: useStore,
      risks: {},
      wallet: {},
      queryParams: {},
      transaction: {},
    };
  },
  methods: {
    decline() {
      window.close();
    },
    confirm() {
      // TODO: Sign the transaction.

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

    this.risks = {
      givingRisk: false,
      receivingRisk: true,
      score: DappScore.Low,
      domainRisk: DappRisk.Whitelist,
      addressRisk: DappRisk.Blacklist,
    };

    this.transaction = {
      give: {
        total: 5,
        txFee: 0.17,
        currency: 'ADA',
        provider: 'AP3X',
        address: 'addr1qyq3',
        assets: [
          { amount: 5, currency: 'ADA' },
          { amount: 1, currency: 'Red BERRY' },
          { amount: 1, currency: 'Green BERRY' },
          { amount: 1, currency: 'Blue BERRY' },
          { amount: 1, currency: 'Cyan BERRY' },
          { amount: 1, currency: 'Magenta BERRY' },
          { amount: 1, currency: 'Yellow BERRY' },
          { amount: 1, currency: 'Black BERRY' },
          { amount: 1, currency: 'White BERRY' },
        ],
      },
      receive: {
        total: 100,
        currency: 'ADA',
        provider: 'AP3X',
        address: 'addr1qyq3',
        assets: [
          { amount: 50, currency: 'NOT' },
          { amount: 50, currency: 'TON' },
        ],
      },
    };
  },
};
</script>

<!------------------------------------------------------------------------------ Styles -->

<style scoped>
@import '../style.scss';

#dapp-sign-details {
  max-height: 300px;
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
