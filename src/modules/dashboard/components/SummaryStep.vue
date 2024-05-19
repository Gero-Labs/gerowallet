<template>
  <div class="summary-container">
    <div class="sections-container">
      <section class="info-container">
        <Select
        :value="sendData.selectedWallet"
        :items="wallets"
        label="From"
        :readonly="true"
      ></Select>
        <v-icon>mdi-arrow-down</v-icon>

        <label>To</label>
        <div class="recipient-box">
          <v-icon>mdi-wallet</v-icon>
          <span
            >addr1qxm3wdq5xzzkqj637205c67ckg8ra59jzj7j7kn49yjjxtpkavy59l827lfa2mc8u6xvjzze96ph3m5u25v7ph78atxsgwum12314yc</span
          >
        </div>

        <v-icon>mdi-arrow-down</v-icon>

        <label>You're giving</label>
      </section>

      <section class="confirm-container">
        <img src="../assets/risk-low.png" alt="risk" />
        <v-text-field class="text-field" outlined placeholder="Password"></v-text-field>
        <v-btn class="continue-button" @click="$emit('next')">Sign and confirm</v-btn>
      </section>
    </div>
  </div>
</template>

<script>
import Select from "@/shared/components/Select.vue";
import { useStore } from "@/store";

export default {
  components: { Select },
  name: "SummaryStep",
  props: {
    sendData: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      wallets: {},
      from: { text: "Wallet 1", icon: "mdi-wallet" },
    };
  },
  methods: {
    // Your component's methods go here
  },
  mounted() {
    const colorsMapping = {
      green: '#00685b',
      purple: '#43269f',
      red: '#b2105b',
      orange: '#e14e02',
      blue: '#125db5',
      grey: '#415153',
    };
    const store = useStore();
    this.wallets = store.wallets.map(wallet => ({
      ...wallet,
      icon: 'mdi-circle',
      iconColor: colorsMapping[wallet.icon],
    }));
  },
};
</script>

<style>
.summary-container {
  margin-top: 20px;
  
  .sections-container {
    display: flex;
    gap: 40px;

    .info-container {
      flex: 3;
      display: flex;
      flex-direction: column;
      
      .recipient-box {
        display: flex;
        gap: 10px;
        padding: 10px;
        word-break: break-all;
        font-size: 12px;
        background: linear-gradient(to right, #005d65, #0000003d);
      }
    }
    
    .confirm-container {
      flex: 2;
      display: flex;
      flex-direction: column;
      align-items: center;

      .text-field {
        width: 100%;
        border-radius: 10px;
      }

      .continue-button {
        background: linear-gradient(to right, #00c7f3, #00fad5);
        color: black;
        padding: 20px;
        border-radius: 10px;
        width: 100%;
      }
    }
  }
}
</style>
