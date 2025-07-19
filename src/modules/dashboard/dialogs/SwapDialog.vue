<template>
  <BaseDialog :isOpen="isOpen" @close="$emit('close')" title="Swap" subtitle="Effortlessly exchange tokens directly from your wallet." :min-height="300" :width="550">
    <v-card-text class="text-center justify-center">
      <SwapWidget @onSwap="$emit('close')"></SwapWidget>
    </v-card-text>
  </BaseDialog>
</template>
<script>
import filters from "@/shared/utils/filters";
import BaseDialog from "@/shared/dialogs/BaseDialog.vue";
import SwapWidget from '@/modules/swap/components/SwapWidget.vue';
import { mapActions } from 'pinia';
import { dexHunterStore } from '@/stores/modules/dexhunter';

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
  watch: {
    isOpen(val) {
      if (val) {
        this.loadTokens(true)
      }
    }
  },
  methods: {
    ...mapActions(dexHunterStore, ['loadTokens']),
  },
};
</script>

<style scoped></style>
