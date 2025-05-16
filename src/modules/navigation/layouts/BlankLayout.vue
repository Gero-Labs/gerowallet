<template>
  <v-app id="inspire" class="transition">
    <v-main class="d-flex align-center">
      <router-view></router-view>
    </v-main>
  </v-app>
</template>
<script setup lang="ts">
</script>
<style>
.transition {
  transition: all 1s ease-in-out!important;
}
</style>
