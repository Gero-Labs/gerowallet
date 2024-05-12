<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')">
    <v-card-title style="word-break: break-word">Buy</v-card-title>
    <v-card-text
        class="text-center justify-center pb-2 fill-height"
        style="width: 388px; height: 600px; align-content: center; margin: auto"
    >
      <iframe
          style="border-radius: 24px"
          allow="accelerometer; autoplay; camera; gyroscope; payment"
          frameborder="0"
          height="100%"
          src="https://buy-staging.moonpay.io?apiKey=pk_test_123&showOnlyCurrencies=eth_zksync&theme=dark"
          width="100%"
      >
        <p>Your browser does not support iframes.</p>
      </iframe>
    </v-card-text>
  </BaseDialog>
</template>
<script>
import BaseDialog from '@/shared/components/BaseDialog.vue';

export default {
  name: 'BuyDialog',
  components: {BaseDialog},
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  data: () => ({
    loading: false,
  }),
  async mounted() {

  }
}
</script>

<style scoped>

</style>