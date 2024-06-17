<template>
  <div class="send-recipient-details-container">
    <div class="item-container">
      <Select
        :value="sendData.selectedWallet"
        :items="[sendData.selectedWallet]"
        label="Choose Wallet"
        :readonly="true"
      ></Select>
    </div>

    <div class="item-container">
      <label>Recipient Address</label>
      <v-textarea
        :value="sendData.recipientAddress"
        rows="3"
        outlined
        :rules="[rules.required, rules.paymentAddress(loggedWallet.network !== Network.MAINNET)]"
        class="recipient-address"
        @input="$emit('updateRecipientAddress', $event)"
      ></v-textarea>
    </div>

    <v-btn
      class="continue-button"
      @click="$emit('next')"
      :disabled="!sendData.recipientAddress"
      >Continue <v-icon style="color: black!important;">mdi-arrow-right</v-icon></v-btn
    >
  </div>
</template>

<script>
import Select from '@/shared/components/Select.vue';
import rules from "@/shared/utils/rules";
import {mapState} from "pinia";
import {useStore} from "@/store";
import {Network} from "@/models/types";

export default {
  components: { Select },
  name: 'SendRecipientDetailsStep',
  props: {
    sendData: {
      type: Object,
      required: true,
    },
  },
  computed: {
    Network() {
      return Network
    },
    ...mapState(useStore, ['loggedWallet']),
  },
  data: () => ({
    rules,
  })
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

    &:disabled {
      opacity: 0.5;
      color: black!important;
    }

  }
}
</style>
