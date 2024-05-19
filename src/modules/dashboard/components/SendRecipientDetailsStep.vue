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
        class="recipient-address"
        @input="$emit('updateRecipientAddress', $event)"
      ></v-textarea>
    </div>

    <v-btn
      class="continue-button"
      @click="$emit('next')"
      :disabled="!sendData.recipientAddress"
      >Continue <v-icon>mdi-arrow-right</v-icon></v-btn
    >
  </div>
</template>

<script>
import Select from '@/shared/components/Select.vue';

export default {
  components: { Select },
  name: 'SendRecipientDetailsStep',
  props: {
    sendData: {
      type: Object,
      required: true,
    },
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

    &:disabled {
      opacity: 0.5;
    }
    
  }
}
</style>
