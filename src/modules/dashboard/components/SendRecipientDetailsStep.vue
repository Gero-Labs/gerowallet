<template>
  <div class="send-recipient-details-container">
    <div class="item-container">
      <Select
        :value="wallets[0]"
        :items="wallets"
        label="Choose Wallet"
        @input="$emit('selectWallet', $event)"
        :readonly="true"
      ></Select>
    </div>

    <div class="item-container">
      <label>Recipient Address</label>
      <v-textarea
        :value="sendData.recipientAddress"
        rows="3"
        outlined
        class="recipient-address"
        @input="$emit('updateRecipientAddress', $event)"
      ></v-textarea>
    </div>

    <v-btn
      class="continue-button"
      @click="$emit('next')"
      >Continue <v-icon>mdi-arrow-right</v-icon></v-btn
    >
  </div>
</template>

<script>
import Select from '@/shared/components/Select.vue';
import { useStore } from '@/store';

export default {
  components: { Select },
  name: 'SendRecipientDetailsStep',
  props: {
    sendData: {
      type: Object,
      required: true,
    },
  },
  data() {
    return {
      wallets: [],
    };
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
    this.wallets = [{...store.loggedWallet,
      icon: 'mdi-circle',
      iconColor: colorsMapping[store.loggedWallet.icon],
    }]
  },
};
</script>

<style>
.send-recipient-details-container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-around;
  height: 500px;

  & .item-container {
    width: 60%;
  }

  .recipient-address > .v-input__control > .v-input__slot {
    background-color: #292929;
    border-radius: 6px;
    padding: 5px 10px;

    & textarea {
      resize: none;
    }
  }

  .continue-button {
    background: linear-gradient(to right, #00c7f3, #00fad5);
    color: black;

    .continue-button {
      background: linear-gradient(to right, #00c7f3, #00fad5);
      color: black;
    }
  }
}
</style>
