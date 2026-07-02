<template>
  <div class="cashback-root">
    <CashbackPortal />
  </div>
</template>
<script setup lang="ts">
import CashbackPortal from '@/modules/cashback/CashbackPortal.vue';
</script>
<style scoped>
.cashback-root {
  width: 100%;
  height: 100%;
  min-height: 480px;
  display: flex;
}
</style>
