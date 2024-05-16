<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')">
    <v-btn v-if="currentStep > 1" @click="prevStep" icon class="arrow-left"><v-icon  color="#cccdd0">mdi-arrow-left</v-icon></v-btn>
    <div class="titles">
      <v-card-title class="display-1">Quick Send</v-card-title>
      <v-card-subtitle class="text--secondary">
        Send AP3X or other assets to another wallet.
      </v-card-subtitle>
    </div>

    <CustomStepper :currentStep="currentStep" @next="nextStep" @prev="prevStep" :steps="steps"></CustomStepper>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';
import CustomStepper from '@/shared/components/CustomStepper.vue';
import SendRecipientDetailsStep from '../components/SendRecipientDetailsStep.vue';
import AssetsToSendStep from '../components/AssetsToSendStep.vue';
import SummaryStep from '../components/SummaryStep.vue';

export default {
  name: 'BuyDialog',
  components: {BaseDialog, CustomStepper},
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  computed: {
    
  },
  data: () => ({
    loading: false,
    currentStep: 1,
    steps: [
      {
        name: 'recipientDetails',
        label: 'Recipient Details',
        component: SendRecipientDetailsStep,
      },
      {
        name: 'assetsToSend',
        label: 'Assets to Send',
        component: AssetsToSendStep,
      },
      {
        name: 'summary',
        label: 'Summary',
        component: SummaryStep,
      },
    ],
  }),
  methods:{
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
  }
}
</script>

<style scoped>
.titles{
  align-items: center;
  text-align: center;
  display: flex;
  flex-direction: column;
}

.arrow-left{
  cursor: pointer;
  position: absolute;
  top: 10px;
  left: 10px;
}

</style>