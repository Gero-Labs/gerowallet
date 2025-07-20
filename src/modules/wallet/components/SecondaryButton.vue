<template>
  <button class="secondary-button" @click="$emit('click')">
    <span class="button-text">{{ text }}</span>
  </button>
</template>

<script setup lang="ts">
interface Props {
  text: string;
}

defineProps<Props>();
defineEmits<{
  click: [];
}>();
</script>

<style scoped>
.secondary-button {
  background: #13161b;
  border: 1px solid #373a41;
  border-radius: 8px;
  padding: 12px 18px;
  font-size: 16px;
  font-weight: 600;
  color: #cecfd2;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
  box-shadow: 0px 1px 2px 0px rgba(255, 255, 255, 0), inset 0px -2px 0px 0px rgba(12, 14, 18, 0.05),
    inset 0px 0px 0px 1px rgba(12, 14, 18, 0.18);
  width: fit-content;
  display: flex;
  align-items: center;
  justify-content: center;
}

.secondary-button:hover {
  background: #1a1d22;
  border-color: #4a4d54;
  color: #e0e1e4;
  transform: translateY(-1px);
  box-shadow: 0px 4px 8px 0px rgba(0, 0, 0, 0.2), inset 0px -2px 0px 0px rgba(12, 14, 18, 0.1),
    inset 0px 0px 0px 1px rgba(12, 14, 18, 0.25);
}

.secondary-button:active {
  transform: translateY(0);
}

.button-text {
  position: relative;
  z-index: 1;
}

@media (max-width: 768px) {
  .secondary-button {
    padding: 10px 16px;
    font-size: 14px;
  }
}
</style>
