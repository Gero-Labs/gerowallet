<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')">
    <v-card-title style="word-break: break-word"
      >Swap
      <v-spacer></v-spacer>
    </v-card-title>
    <v-card-subtitle>Effortlessly exchange tokens directly from your wallet.</v-card-subtitle>
    <v-card-text
      class="text-center justify-center pb-2"
      style="width: 388px; height: 600px; align-content: center; margin: auto"
    >
      <swap-currency-selector
        :value="quantity"
        @updateQuantity="updateQuantity"
      ></swap-currency-selector>
    </v-card-text>
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
