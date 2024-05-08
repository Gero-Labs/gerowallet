<template>
  <BaseDialog :isOpen="dialogLocal" @close="dialogLocal = false">
    <v-card-title style="word-break: break-word"
      >Swap
      <v-spacer></v-spacer>
    </v-card-title>
    <v-card-subtitle>Effortlessly exchange tokens directly from your wallet.</v-card-subtitle>
    <v-card-text
      class="text-center justify-center pb-2"
      style="width: 388px; height: 600px; align-content: center; margin: auto"
    >
      <swap-currency-selector
        :value="quantity"
        :max="Number(maxTokens)"
        @updateQuantity="updateQuantity"
      ></swap-currency-selector>
    </v-card-text>
    <v-card-actions>
      <v-spacer></v-spacer>
      <v-btn color="primary" text :disabled="loading" @click="dialogLocal = false"> Cancel </v-btn>
      <v-btn :disabled="loading" color="primary" elevation="0" :loading="loading" @click="addTokens"> Add </v-btn>
      <v-spacer></v-spacer>
    </v-card-actions>
    <v-overlay :absolute="true" :value="loading || txError" color="black" opacity="0.85">
      <v-card v-if="loading && !txError" flat class="transparent text-center justify-center">
        <v-avatar v-if="txState === 'Done!'" size="28" color="green">
          <v-icon> mdi-check </v-icon>
        </v-avatar>
        <v-card-title class="pt-4 text-center justify-center" style="word-break: break-word; font-size: 24px">
          {{ txState === "Done!" ? "Congratulations!" : txState }}
        </v-card-title>
        <v-card-subtitle
          v-if="txState === 'Done!'"
          class="pt-0 text-center"
          style="word-break: break-word; color: white; font-size: 12px; line-height: 2"
        >
          <strong>{{ txTotalTokens }}</strong> Forge tokens have been successfully added!
        </v-card-subtitle>
        <v-card-text v-if="txState === 'Done!'" class="text-center justify-center pb-0" style="word-break: break-word">
          Transaction ID
        </v-card-text>
        <v-btn
          v-if="txState === 'Done!'"
          text
          plain
          :href="network === 'preview' ? 'https://preview.cexplorer.io/tx/' + txId : 'https://cexplorer.io/tx/' + txId"
          target="_blank"
        >
          {{ txId | truncate }}
        </v-btn>
        <v-progress-linear
          v-if="
            txState === 'Awaiting Signature ...' || txState === 'Minting ...' || txState === 'Verifying Transaction ...'
          "
          buffer-value="0"
          color="primary"
          stream
          value="0"
          style="color: white; width: 200px; margin: auto"
        ></v-progress-linear>
        <v-card-actions class="text-center justify-center">
          <v-btn
            v-if="txState === 'Done!'"
            color="green"
            @click="
              reload();
              dialogLocal = false;
            "
          >
            Close
          </v-btn>
        </v-card-actions>
      </v-card>
      <v-card v-else-if="txError" flat class="transparent text-center justify-center">
        <v-card-title class="justify-center" style="word-break: break-word"> Unexpected Error Occurred ! </v-card-title>
        <v-card-text class="pb-0 text-center justify-center" style="word-break: break-word">
          Please Inform @AdaboxIO team about it with all the relevant details:
        </v-card-text>
        <v-card-text class="pb-0 text-center justify-center" style="word-break: break-word; color: white">
          {{ txState }}
        </v-card-text>
        <v-card-text class="text-center justify-center" style="word-break: break-word">
          We're deeply sorry for the inconvenience.<br />
          Adabox Forge Team.
        </v-card-text>
        <v-card-actions class="text-center justify-center pt-2">
          <v-btn color="primary" @click="reload"> Close </v-btn>
        </v-card-actions>
      </v-card>
    </v-overlay>
  </BaseDialog>
</template>
<script>
import filters from "@/shared/utils/filters";
import api from "@/api/api";
import SwapCurrencySelector from "@/shared/components/SwapCurrencySelector.vue";
import BaseDialog from "@/shared/components/BaseDialog.vue";

export default {
  name: "SwapDialog",
  filters,
  components: { SwapCurrencySelector, BaseDialog },
  props: {
    dialog: Boolean,
    project: {
      type: Object,
      default() {
        return {};
      },
    },
  },
  data: () => ({
    loading: false,
    quantity: 1,
    connectorApi: undefined,
    txState: "Awaiting Signature ...",
    txError: false,
    txId: "",
    txRetryCount: 0,
    txTotalTokens: 0,
    network: "mainnet",
  }),
  computed: {
    maxTokens() {
      // return this.$store.getters.getAccount.wallet.balance.forge || 0
      return 115110240000;
    },
    dialogLocal: {
      get() {
        return this.dialog;
      },
      set(value) {
        this.$emit("dialogChange", value);
        this.quantity = 1;
      },
    },
  },
  methods: {
    updateQuantity(value) {
      this.quantity = value;
    },
    reload() {
      this.loading = false;
      this.txError = false;
      this.txId = "";
      this.txRetryCount = 0;
      this.txTotalTokens = 0;
    },
    async addTokens() {
      this.loading = true;
      const walletName = this.$store.getters.getAccount.wallet.cip30;
      const connector = Reflect.get(window.cardano, walletName);
      this.connectorApi = await connector.enable();
      this.txState = "Awaiting Signature ...";
      const changeAddress = await this.connectorApi.getChangeAddress();
      let txPair;
      try {
        const utxos = await this.connectorApi.getUtxos();
        txPair = await api.createForgeTokensBurnTx(changeAddress, utxos, this.project.id, this.quantity, this.network);
      } catch (error) {
        this.txState = error.message;
        this.txError = true;

        return;
      }
      let signedTx;
      try {
        if (!txPair) {
          throw new Error("Failed to Retrieve Tx");
        }
        console.log(txPair);
        signedTx = await this.connectorApi.signTx(txPair.second, true);
      } catch (error) {
        console.log(error);
        if (error.info) {
          this.$emit("snackbarChange", { text: error.info, color: "error" });
        } else {
          this.$emit("snackbarChange", {
            text: "Transaction Signing Error Please Contact Adabox Team.",
            color: "error",
          });
        }
        this.loading = false;
        return;
      }
      this.txState = "Minting ...";
      try {
        const response = await api.submitForgeTokenBurnTx(txPair.first, signedTx);
        if (response.status === 200) {
          this.txState = "Verifying Transaction ...";
          this.verifyInterval = setInterval(() => this.verifyTx(this.network, response.data), 5000);
        } else {
          this.txState = response.statusText;
          this.txError = true;
        }
      } catch (e) {
        this.txState = e.message;
        this.txError = true;
      }
    },
    async verifyTx(network, pair) {
      try {
        if (this.txRetryCount < 60) {
          const response = await api.verifyTx(network, pair.first);
          if (response.status === 200) {
            this.txTotalTokens = pair.second;
            this.$emit("appliedTokensChange", { projectId: this.project.id, tokens: pair.second });
            clearInterval(this.verifyInterval);
            this.txId = pair.first;
            this.txState = "Done!";
          }
          this.txRetryCount++;
        } else {
          clearInterval(this.verifyInterval);
          this.txState = "Verification Failed for Tx Id: " + pair.first;
          this.txError = true;
        }
      } catch (e) {
        console.log(e);
        clearInterval(this.verifyInterval);
        this.txError = true;
        this.txState = e.message;
      }
    },
  },
};
</script>

<style scoped></style>
