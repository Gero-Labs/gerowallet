<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="How it Works?" subtitle="" :min-height="560" :height="560" :width="604">
    <v-card-text class="px-0 pt-2 pb-0" style="z-index: 3; color: white">
      Search for your favorite items and brands, browse through various categories, or explore our top brands to find exactly what you need.<br>
      <br>
      Once you've made your selection, complete your purchase using your preferred fiat payment method, such as a credit card, PayPal, Apple Pay, Google Pay, or other digital wallets.<br>
      <br>
      Within 48 hours, your crypto cashback will appear in the "pending rewards" area.<br>
      <br>
      After the specified lock period ends, simply check your pending cashback and claim your crypto rewards with a few clicks. The cashback will then be instantly transferred to your wallet.<br>
      <br>
      Enjoy up to 20% in crypto cashback on every purchase, making your shopping experience not only enjoyable but also highly rewarding.<br>
      <br>
      Note: Only cashback with a minimum USD value of $0.10, at the time of the reporting of the purchase, will be processed. Purchases that yield a cashback of less than $0.10 will be ignored
    </v-card-text>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/dialogs/BaseDialog.vue';
import filters from '@/shared/utils/filters';
import axios from 'axios';

export default {
  name: 'HowItWorksDialog',
  components: {BaseDialog },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    }
  },
  filters,
  data: () => ({
    loading: true,
    disabled: true,
  }),
  mounted() {

  },
  watch: {
    isOpen(val) {
      if (val) {
        this.loading = true
        this.default = true
      }
    }
  },
};
</script>
<style scoped>

.card-text {
  width: 100%;
  padding: 24px;
  background: linear-gradient(90deg, rgb(0, 14, 17), rgb(0, 19, 16));
  border-radius: 12px;
  border: 1px solid #00DFF3;
  display: flex;
  flex-direction: column;
  justify-content: center;
  align-items: center;
}

::-webkit-scrollbar {
  width: 14px;
}

::-webkit-scrollbar-thumb {
  border: 4px solid rgba(0, 0, 0, 0);
  background-clip: padding-box;
}

/* Handle on hover */
::-webkit-scrollbar-thumb:hover {
  border: 4px solid rgba(0, 0, 0, 0);
  background-clip: padding-box;
}
</style>
