<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Swap" subtitle="Effortlessly exchange tokens directly from your wallet." :min-height="300" :width="500">
    <v-card-text class="text-center justify-center">
      <SwapWidget @onSwap="$emit('close')"></SwapWidget>
    </v-card-text>
  </BaseDialog>
</template>
<script>
import filters from "@/shared/utils/filters";
import BaseDialog from "@/shared/dialogs/BaseDialog.vue";
import TokenSelector from '@/shared/components/TokenSelector.vue';
import SwapWidget from '@/modules/swap/components/SwapWidget.vue';

export default {
  name: "SwapDialog",
  filters,
  components: { SwapWidget, BaseDialog },
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
