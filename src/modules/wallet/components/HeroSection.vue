<template>
  <div>
    <img :src="cardBanner" alt="Contactless" class="card-banner" />
  </div>
</template>

<script setup lang="ts">
import assets from '@/utils/assets';
const cardBanner = assets.cardBanner;
</script>

<style lang="scss" scoped>
@import '../styles/variables';
@import '../styles/mixins';
.card-banner {
  object-fit: contain;
  width: 100%;
  height: auto;
}
</style>
