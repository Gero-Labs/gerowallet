<template>
  <div class="gero-ticker d-flex align-center" v-if="displayPrice">
    <div class="gero-ticker d-flex align-center" style="min-width: 120px; cursor: pointer" @click="cycleDisplayMode">
      <div class="d-flex flex-column">
        <span class="gero-label" style="font-size: 12px; font-weight: 600" :style="{ color: primaryColor }">{{
          tokenName
        }}</span>
        <span class="gero-price" style="font-size: 10px; color: #fff"
          >{{ currentCurrencySymbol }}{{ displayPrice }}</span
        >
      </div>
    </div>
  </div>
</template>
<script setup lang="ts">
import { ref, computed } from 'vue';

// Display mode: 'ADA', 'USD', 'EUR'
const displayMode = ref<'ADA' | 'USD' | 'EUR'>('USD');

const props = defineProps({
  primaryColor: {
    type: String,
    default: '#00c7f3',
  },
  tokenName: {
    type: String,
    default: 'GERO',
  },
  priceInAda: {
    type: Number,
    default: 0,
  },
  priceInUsd: {
    type: Number,
    default: 0,
  },
  priceInEur: {
    type: Number,
    default: 0,
  },
});

const displayPrice = computed(() => {
  switch (displayMode.value) {
    case 'ADA':
      return props.priceInAda.toFixed(6);
    case 'USD':
      return props.priceInUsd.toFixed(6);
    case 'EUR':
      return props.priceInEur.toFixed(6);
    default:
      return '0.000000';
  }
});

const currentCurrencySymbol = computed(() => {
  switch (displayMode.value) {
    case 'ADA':
      return '₳';
    case 'USD':
      return '$';
    case 'EUR':
      return '€';
    default:
      return '$';
  }
});

function cycleDisplayMode() {
  // Cycle through USD → EUR → ADA → USD
  if (displayMode.value === 'USD') {
    displayMode.value = 'EUR';
  } else if (displayMode.value === 'EUR') {
    displayMode.value = 'ADA';
  } else {
    displayMode.value = 'USD';
  }
}
</script>
<style scoped lang="scss">
.gero-ticker {
  transition: background-color var(--g-dur-base) ease, transform var(--g-dur-base) ease;
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
