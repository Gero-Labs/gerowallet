<template>
  <component :is="layout">
    <router-view></router-view>
  </component>
</template>
<script setup lang="ts">
import { computed } from 'vue';

const vmProxy = getCurrentInstance()!.proxy as any
const route = vmProxy.$route;
const layout = computed(() => route.meta.layout || 'div');
</script>
