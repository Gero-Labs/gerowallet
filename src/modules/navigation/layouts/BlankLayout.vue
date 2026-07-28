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
  transition: color var(--g-dur-slow) ease-in-out, background-color var(--g-dur-slow) ease-in-out, border-color var(--g-dur-slow) ease-in-out, opacity var(--g-dur-slow) ease-in-out, transform var(--g-dur-slow) ease-in-out, box-shadow var(--g-dur-slow) ease-in-out !important;
}
</style>
