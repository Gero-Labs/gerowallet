<template>
  <div class="mini-layout">
    <MiniHeader
      @wallet-switch="$emit('wallet-switch')"
      @settings="$emit('settings')"
    />
    <main class="mini-content">
      <router-view />
    </main>
    <BottomNav />
  </div>
</template>

<script setup lang="ts">
import MiniHeader from '../components/MiniHeader.vue';
import BottomNav from '../components/BottomNav.vue';
</script>

<style scoped>
.mini-layout {
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: #0a0a0a;
  overflow: hidden;
}

.mini-content {
  flex: 1;
  overflow-y: auto;
  overflow-x: hidden;
}
</style>
