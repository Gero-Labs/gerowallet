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
  /* ContentLayout is a natural-flow scroll page, so height:100% collapses to
     auto and the portal iframe clipped to ~480px, hiding the retailer grid.
     Pin to the viewport (minus app-bar + padding, matching MediaPlayer) so the
     flex child iframe gets a real height and the portal scrolls internally. */
  width: 100%;
  /* Definite height (not min-height) so the portal's height:100% resolves;
     with only min-height it fell back to auto and min-height:0 collapsed it. */
  height: calc(100vh - 80px);
  display: flex;
}
</style>
