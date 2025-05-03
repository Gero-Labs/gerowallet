<template>
  <v-card class="transparent" flat style="min-height: calc(100vh - 128px);">
    <v-card-title class="justify-center text-center pb-0 text-h3">
      Gero DAO
    </v-card-title>
    <v-card-subtitle class="justify-center text-center" style="display: inline-flex; width: 100%">
      Powered by <v-img class="ml-1" :src="assets.clarityLogo" alt="Clarity Logo" width="48" max-width="48" style="margin-top: 1px;" contain/>
    </v-card-subtitle>
    <v-card-subtitle class="justify-center pt-0 text-center text-subtitle-1">
      Gero Decentralized Autonomous Organization empowers GERO holders to actively participate in shaping Gero OS future.<br>
      You can cast your vote directly or propose your own changes, engage in discussions, and ultimately bring them to a vote.
    </v-card-subtitle>
    <v-card-text>

    </v-card-text>
  </v-card>
</template>
<script setup lang="ts">
import { onMounted } from 'vue'
import assets from '@/utils/assets';

onMounted(() => {

})
</script>
<style scoped>

</style>
