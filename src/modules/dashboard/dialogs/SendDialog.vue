<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Quick Send" subtitle="Send AP3X or other assets to another wallet.">
    <v-btn v-if="currentStep > 1" @click="prevStep" icon class="arrow-left"
      ><v-icon color="#cccdd0">mdi-arrow-left</v-icon></v-btn
    >
    <CustomStepper :currentStep="currentStep" :steps="steps">
      <v-stepper-content step="1">
        <SendRecipientDetailsStep
          @next="nextStep"
          :sendData="this.sendData"
          @updateRecipientAddress="updateRecipientAddress"
        ></SendRecipientDetailsStep>
      </v-stepper-content>
      <v-stepper-content step="2">
        <AssetsToSendStep
          @next="nextStep"
          @prev="prevStep"
          @select="selectCollectible"
          :sendData="this.sendData"
        ></AssetsToSendStep>
      </v-stepper-content>
      <v-stepper-content step="3">
        <SummaryStep :sendData="this.sendData" @next="nextStep" @prev="prevStep"></SummaryStep>
      </v-stepper-content>
    </CustomStepper>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';
import CustomStepper from '@/shared/components/CustomStepper.vue';
import SendRecipientDetailsStep from '../components/SendRecipientDetailsStep.vue';
import AssetsToSendStep from '../components/AssetsToSendStep.vue';
import SummaryStep from '../components/SummaryStep.vue';
import { useStore } from '@/store';
import {mapState} from "pinia";

export default {
  name: 'BuyDialog',
  components: { BaseDialog, CustomStepper, SendRecipientDetailsStep, AssetsToSendStep, SummaryStep },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    ...mapState(useStore, ['loggedWallet']),
  },
  watch: {
    isOpen(val) {
      if (val) {
        this.resetData();
      }
    },
  },
  data: () => ({
    steps: [
      {
        name: 'recipientDetails',
        label: 'Recipient Details',
      },
      {
        name: 'assetsToSend',
        label: 'Assets to Send',
      },
      {
        name: 'summary',
        label: 'Summary',
      },
    ],
    currentStep: 1,
    sendData: {
      selectedCollectibles: {},
      recipientAddress: '',
      selectedWallet: {},
    },
  }),
  methods: {
    nextStep() {
      if (this.currentStep < this.steps.length) {
        this.currentStep++;
      }
    },
    prevStep() {
      if (this.currentStep > 1) {
        this.currentStep--;
      }
    },
    updateRecipientAddress(address) {
      this.sendData.recipientAddress = address;
    },
    selectCollectible(collectible) {
      if (this.sendData.selectedCollectibles[collectible.name]) {
        this.$delete(this.sendData.selectedCollectibles, collectible.name);
      } else {
        this.$set(this.sendData.selectedCollectibles, collectible.name, collectible);
      }
    },
    resetData() {
      this.currentStep = 1;
      this.sendData = {
        selectedCollectibles: {},
        recipientAddress: '',
        selectedWallet: this.loggedWallet,
      };
    },
  },
};
</script>

<style scoped>
.titles {
  align-items: center;
  text-align: center;
  display: flex;
  flex-direction: column;
}

.arrow-left {
  cursor: pointer;
  position: absolute;
  top: 10px;
  left: 10px;
}
</style>
