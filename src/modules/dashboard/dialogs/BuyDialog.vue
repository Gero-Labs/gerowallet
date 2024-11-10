<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Buy">
    <v-card-text
      class="text-center justify-center pb-2 fill-height" style="overflow-y: clip;"
    >
      <iframe
        style="border-radius: 24px;"
        allow="accelerometer; autoplay; camera; gyroscope; payment"
        frameborder="0"
        height="100%"
        :src="moonPayUrl"
        width="100%"
      >
        <p>Your browser does not support iframes.</p>
      </iframe>
    </v-card-text>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';
import { mapState } from 'pinia';
import { appWallet, useStore } from '@/store';

export default {
  name: 'BuyDialog',
  components: {BaseDialog},
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  watch: {
    isOpen(val) {
      if (val && !this.moonPayUrl) {
        this.fetch();
      }
    }
  },
  computed: {
    ...mapState(useStore, ['baseAddress'])
  },
  methods: {
    async fetch() {
      if (appWallet) {
        try {
          this.moonPayUrl = await appWallet.api.moonPaySign(`https://buy.moonpay.com/?apiKey=MOONPAY_API_KEY_REMOVED&enabledPaymentMethods=credit_debit_card&theme=dark&currencyCode=ada&walletAddress=${this.baseAddress}&colorCode=%232f9cac&baseCurrencyCode=usd`)
        } catch (error) {
          console.error(error)
        }
      }
    }
  },
  data: () => ({
    moonPayUrl: '',
  })
}
</script>

<style scoped>

</style>
