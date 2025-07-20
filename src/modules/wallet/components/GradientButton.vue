<template>
  <button class="gradient-button" @click="$emit('click')">
    <span class="button-text">{{ text }}</span>
  </button>
</template>

<script setup lang="ts">
interface Props {
  text: string;
}

defineProps<Props>();
defineEmits<{
  (e: 'click'): void;
}>();
</script>

<style scoped>
.gradient-button {
  border-radius: 8px;
  border: 1px solid #00dff3;
  background: linear-gradient(90deg, #00c7f3 19.82%, #23c0a3 103.14%);
  box-shadow: 0px 0px 0px 1px rgba(12, 14, 18, 0.18) inset, 0px -2px 0px 0px rgba(12, 14, 18, 0.05) inset,
    0px 1px 2px 0px rgba(255, 255, 255, 0);
  padding: 12px 20px;
  font-size: 16px;
  font-weight: 600;
  color: white;
  cursor: pointer;
  transition: all 0.3s ease;
  position: relative;
  overflow: hidden;
  width: fit-content;
  display: flex;
  align-items: center;
  justify-content: center;
}

.gradient-button::before {
  content: '';
  position: absolute;
  top: 0;
  left: -100%;
  width: 100%;
  height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent);
  transition: left 0.5s ease;
}

.gradient-button:hover::before {
  left: 100%;
}

.gradient-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 10px 25px rgba(0, 199, 243, 0.3);
}

.gradient-button:active {
  transform: translateY(0);
}

.button-text {
  position: relative;
  z-index: 1;
}
</style>
