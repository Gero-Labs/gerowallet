<template>
  <div v-if="value" class="bottom-sheet-overlay" @click.self="onBackdropClick">
    <div
      class="bottom-sheet-container"
      :class="{ 'bottom-sheet-enter': entering, 'bottom-sheet-leave': leaving }"
      :style="{ height: height }"
    >
      <div class="bottom-sheet-handle" v-if="showHandle">
        <div class="handle-bar" />
      </div>
      <div v-if="title" class="bottom-sheet-header">
        <span class="text-subtitle-1 white--text font-weight-bold">{{ title }}</span>
        <v-btn icon small @click="close" class="white--text">
          <v-icon small>mdi-close</v-icon>
        </v-btn>
      </div>
      <div class="bottom-sheet-content">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue';

const props = withDefaults(defineProps<{
  value: boolean;
  title?: string;
  height?: string;
  persistent?: boolean;
  showHandle?: boolean;
}>(), {
  height: '85%',
  persistent: false,
  showHandle: true,
});

const emit = defineEmits<{
  (e: 'input', value: boolean): void;
  (e: 'close'): void;
}>();

const entering = ref(false);
const leaving = ref(false);
let enterTimer: ReturnType<typeof setTimeout> | null = null;
let leaveTimer: ReturnType<typeof setTimeout> | null = null;

watch(() => props.value, (val) => {
  if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; leaving.value = false; }
  if (val) {
    entering.value = true;
    if (enterTimer) clearTimeout(enterTimer);
    enterTimer = setTimeout(() => { entering.value = false; enterTimer = null; }, 300);
  }
});

function close() {
  if (enterTimer) { clearTimeout(enterTimer); enterTimer = null; entering.value = false; }
  leaving.value = true;
  leaveTimer = setTimeout(() => {
    leaving.value = false;
    leaveTimer = null;
    emit('input', false);
    emit('close');
  }, 300);
}

function onBackdropClick() {
  if (!props.persistent) close();
}
</script>

<style scoped>
.bottom-sheet-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: rgba(0, 0, 0, 0.4);
  z-index: 100;
  display: flex;
  align-items: flex-end;
}

.bottom-sheet-container {
  width: 100%;
  background:
    linear-gradient(180deg, rgba(19, 22, 27, 0.65) 0%, rgba(10, 12, 16, 0.75) 100%),
    radial-gradient(ellipse at 30% 0%, rgba(45, 240, 247, 0.06) 0%, transparent 60%),
    radial-gradient(ellipse at 70% 20%, rgba(255, 255, 255, 0.03) 0%, transparent 50%);
  backdrop-filter: blur(40px) saturate(1.8) brightness(1.1);
  -webkit-backdrop-filter: blur(40px) saturate(1.8) brightness(1.1);
  border-radius: 16px 16px 0 0;
  border: 1px solid rgba(255, 255, 255, 0.15);
  border-bottom: none;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  transform: translateY(0);
  transition: transform 0.3s ease-out;
  box-shadow:
    0 -12px 40px rgba(0, 0, 0, 0.6),
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    inset -1px 0 0 rgba(45, 240, 247, 0.06);
}

.bottom-sheet-enter {
  animation: slideUp 0.3s ease-out;
}

.bottom-sheet-leave {
  animation: slideDown 0.3s ease-out;
}

@keyframes slideUp {
  from { transform: translateY(100%); }
  to { transform: translateY(0); }
}

@keyframes slideDown {
  from { transform: translateY(0); }
  to { transform: translateY(100%); }
}

.bottom-sheet-handle {
  display: flex;
  justify-content: center;
  padding: 8px 0 4px;
}

.handle-bar {
  width: 36px;
  height: 4px;
  background: rgba(255, 255, 255, 0.25);
  border-radius: 2px;
}

.bottom-sheet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
  background: rgba(255, 255, 255, 0.03);
}

.bottom-sheet-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
</style>
