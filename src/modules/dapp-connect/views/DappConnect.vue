<template>
  <div>
    <header>
      <h1>Connect with Gero Wallet</h1>
    </header>

    <main>
      <section>
        <p>Website: {{ queryParams.website || '-' }}</p>
      </section>

      <section>
        <p>Confirm URL before granting the access to DApps!</p>
      </section>

      <section>
        <span>WalletName </span>
        <i>{{ queryParams.walletName || '-' }}</i>
      </section>

      <section>
        <h4>Allow the site to:</h4>
        <label style="display: flex">
          <input type="checkbox" v-model="permission"/>
          <p>View the address and balance of the selected wallet.</p>
        </label>

        <p>
          For your security, any future transactions from this website will require you to enter your spending password
          before signing.
        </p>
      </section>

      <div></div>
    </main>

    <footer>
      <button @click="decline" style="margin-right: 0.5rem">Decline</button>
      <button @click="confirm" :disabled="!permission">Confirm</button>
    </footer>
  </div>
</template>

<script>
import {useStore} from "@/store";

export default {
  name: 'dapp-connect',
  data() {
    return {
      queryParams: {},
      permission: '',
      store: useStore,
      wallet: undefined
    };
  },
  async created() {
    this.queryParams = this.$route.query;
    this.wallet = useStore().getWallet
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
    }
  },
};
</script>
