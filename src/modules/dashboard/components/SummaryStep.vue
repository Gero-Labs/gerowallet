<template>
  <div class="summary-container">
    <div class="sections-container">
      <section class="info-container">
        <Select :value="from" :items="wallets" :readonly="true" label="From"></Select>
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
        <v-text-field class="text-field" outlined placeholder="Password"></v-text-field>
        <v-btn class="continue-button" @click="$emit('next')">Sign and confirm</v-btn>
      </section>
    </div>
  </div>
</template>

<script>
import Select from "@/shared/components/Select.vue";

export default {
  components: { Select },
  name: "SummaryStep",
  data() {
    return {
      wallets: [
        { text: "Wallet 1", icon: "mdi-wallet" },
        { text: "Wallet 2", icon: "mdi-wallet" },
        { text: "Wallet 3", icon: "mdi-wallet" },
      ],
      from: { text: "Wallet 1", icon: "mdi-wallet" },
    };
  },
  methods: {
    // Your component's methods go here
  },
  mounted() {
    // Code to run when the component is mounted goes here
  },
};
</script>

<style scoped>
.summary-container {
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

      .text-field {
        border-radius: 10px;
        & > v-input__control > .v-input__slot > .v-text-field__slot > input {
          padding: 10px !important;
        }
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
