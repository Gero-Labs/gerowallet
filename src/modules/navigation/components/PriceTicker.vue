<template>
  <div class="gero-ticker d-flex align-center">
    <div class="gero-ticker d-flex align-center" style="min-width: 120px; cursor: pointer" @click="$emit('click')">
      <div class="d-flex flex-column">
        <span class="gero-label" style="font-size: 12px; font-weight: 600" :style="{ color: primaryColor }">{{
          tokenName
        }}</span>
        <span class="gero-price" style="font-size: 10px; color: #fff" v-if="price"
          >{{ getCurrencySymbol() }}{{ price }}</span
        >
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useCurrencyConverter } from '@/shared/composables/useCurrencyConverter';
const { getCurrencySymbol } = useCurrencyConverter();

const props = defineProps({
  primaryColor: {
    type: String,
    default: '#00c7f3',
  },
  tokenName: {
    type: String,
    default: 'GERO',
  },
  price: {
    type: Number,
    default: 0,
  },
});
</script>
<style scoped lang="scss">
.gero-ticker {
  transition: all 0.2s ease;
  border-radius: 6px;
  padding: 4px 8px;
}

.gero-ticker:hover {
  background-color: rgba(0, 199, 243, 0.1);
  transform: scale(1.05);
}

.gero-ticker:active {
  transform: scale(0.98);
}
</style>
