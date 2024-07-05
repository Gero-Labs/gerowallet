<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Swap" subtitle="Effortlessly exchange tokens directly from your wallet.">
    <v-card-text class="px-3 justify-center text-center" style="z-index: 1">
      <TokenSelector
        :value="quantity"
        @updateQuantity="updateQuantity"
      ></TokenSelector>
    </v-card-text>
  </BaseDialog>
</template>
<script>
import filters from "@/shared/utils/filters";
import BaseDialog from "@/shared/components/BaseDialog.vue";
import TokenSelector from '@/shared/components/TokenSelector.vue';

export default {
  name: "SwapDialog",
  filters,
  components: { TokenSelector, BaseDialog },
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
