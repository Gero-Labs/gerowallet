<template>
  <div class="send-recipient-details-container">
    <div class="item-container">
       <Select :items="wallets" label="Choose Wallet" ></Select>
    </div>

    <div class="item-container">
      <label>Recipient Address</label>
      <p class="recipient-address">
        addr1q9hnmantdjruxqzc9qqq6kznup8xha3shuvhtktsp3j0rmh4xmy84q2crvzy6he2j69798923xvt3jk5n3nd9eecmxkskmexus
      </p>
    </div>

    <v-btn class="continue-button" @click="$emit('next')">Continue <v-icon>mdi-arrow-right</v-icon></v-btn>
  </div>
</template>

<script>
import Select from "@/shared/components/Select.vue";

export default {
  components:{Select},
  name: "SendRecipientDetailsStep",
  data() {
    return {
      wallets: [
        { text: "Wallet 1", icon: "mdi-wallet" },
        { text: "Wallet 2", icon: "mdi-wallet" },
        { text: "Wallet 3", icon: "mdi-wallet" },
      ],
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
.send-recipient-details-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-around;
  height: 500px;

  & .item-container {
    width: 60%;
  }

  .recipient-address {
    background-color: #292929;
    border-radius: 6px;
    padding: 5px 10px;
  }

  .continue-button {
    background: linear-gradient(to right, #00c7f3, #00fad5);
    color: black;
  }
}
</style>
