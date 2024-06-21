<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Swap" subtitle="Effortlessly exchange tokens directly from your wallet.">
    <swap-currency-selector
      :value="quantity"
      @updateQuantity="updateQuantity"
    ></swap-currency-selector>
  </BaseDialog>
</template>
<script>
import filters from "@/shared/utils/filters";
import SwapCurrencySelector from "@/shared/components/SwapCurrencySelector.vue";
import BaseDialog from "@/shared/components/BaseDialog.vue";

export default {
  name: "SwapDialog",
  filters,
  components: { SwapCurrencySelector, BaseDialog },
  props: {
    isOpen: {
      type: Boolean,
      default: false,
    },
  },
  data: () => ({
    quantity: 1,
  }),
  computed: {

  },
  methods: {
    updateQuantity(value) {
      this.quantity = value;
    },
  },
};
</script>

<style scoped></style>
