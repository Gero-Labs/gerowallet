<template>
  <div v-if="visible" class="bottom-sheet-overlay" :style="overlayStyle" @click.self="onBackdropClick">
    <div
      ref="sheetRef"
      class="bottom-sheet-container"
      :class="{ 'no-transition': dragging }"
      :style="sheetStyle"
      @touchstart.passive="onDragStart"
      @mousedown="onDragStart"
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
      <div class="bottom-sheet-content" ref="contentRef">
        <slot />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';

const props = withDefaults(defineProps<{
  value: boolean;
  title?: string;
  height?: string;
  persistent?: boolean;
  showHandle?: boolean;
  draggable?: boolean;
}>(), {
  height: '85%',
  persistent: false,
  showHandle: true,
  draggable: true,
});

const emit = defineEmits<{
  (e: 'input', value: boolean): void;
  (e: 'close'): void;
}>();

const visible = ref(false);
const sheetRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);

// Animation state
const translateY = ref(0);       // current Y offset in px (0 = fully open)
const sheetHeight = ref(0);      // measured height of the container
const phase = ref<'entering' | 'open' | 'leaving' | 'closed'>('closed');
let dismissTimer: ReturnType<typeof setTimeout> | null = null;

// Drag state
const dragging = ref(false);
const dragStartY = ref(0);
const dragStartTranslateY = ref(0);
const velocity = ref(0);
const lastMoveY = ref(0);
const lastMoveTime = ref(0);

// Rubber band damping — iOS uses ~0.55
const RUBBER_BAND_FACTOR = 0.35;
const DISMISS_THRESHOLD = 0.3;  // 30% of sheet height
const DISMISS_VELOCITY = 600;   // px/s

// --- Computed styles ---

const overlayStyle = computed(() => {
  if (phase.value === 'closed') return {};
  const progress = sheetHeight.value > 0
    ? 1 - Math.max(0, translateY.value) / sheetHeight.value
    : phase.value === 'entering' || phase.value === 'open' ? 1 : 0;
  return {
    background: `rgba(0, 0, 0, ${0.4 * Math.max(0, Math.min(1, progress))})`,
  };
});

const sheetStyle = computed(() => ({
  height: props.height,
  transform: `translateY(${translateY.value}px)`,
}));

// --- Open / Close ---

watch(() => props.value, async (val) => {
  // Cancel any pending dismiss — prevents race where dismiss timer fires after re-open
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }

  if (val) {
    visible.value = true;
    phase.value = 'entering';
    translateY.value = 2000; // start offscreen
    await nextTick();
    measureSheet();
    // Animate in: start from full height offset
    translateY.value = sheetHeight.value;
    // Force reflow then animate to 0
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        translateY.value = 0;
        phase.value = 'open';
      });
    });
  } else {
    animateDismiss();
  }
});

function measureSheet() {
  if (sheetRef.value) {
    sheetHeight.value = sheetRef.value.offsetHeight;
  }
}

function close() {
  animateDismiss();
}

function animateDismiss() {
  phase.value = 'leaving';
  translateY.value = sheetHeight.value || 2000;
  dismissTimer = setTimeout(() => {
    dismissTimer = null;
    visible.value = false;
    phase.value = 'closed';
    translateY.value = 0;
    emit('input', false);
    emit('close');
  }, 350);
}

function onBackdropClick() {
  if (!props.persistent) close();
}

// --- Drag handling ---

function onDragStart(e: TouchEvent | MouseEvent) {
  if (!props.draggable) return;
  // Don't drag if scrolled inside content
  if (contentRef.value && contentRef.value.scrollTop > 0) {
    // Allow drag only if touching above the content or on the handle
    const target = e.target as HTMLElement;
    if (!target.closest('.bottom-sheet-handle') && !target.closest('.bottom-sheet-header')) {
      return;
    }
  }

  dragging.value = true;
  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
  dragStartY.value = clientY;
  dragStartTranslateY.value = translateY.value;
  velocity.value = 0;
  lastMoveY.value = clientY;
  lastMoveTime.value = performance.now();

  window.addEventListener('touchmove', onDragMove, { passive: false });
  window.addEventListener('touchend', onDragEnd);
  window.addEventListener('mousemove', onDragMove);
  window.addEventListener('mouseup', onDragEnd);
}

function onDragMove(e: TouchEvent | MouseEvent) {
  if (!dragging.value) return;
  e.preventDefault();

  const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
  const delta = clientY - dragStartY.value;
  const now = performance.now();

  // Track velocity
  const dt = now - lastMoveTime.value;
  if (dt > 0) {
    velocity.value = (clientY - lastMoveY.value) / dt * 1000; // px/s
  }
  lastMoveY.value = clientY;
  lastMoveTime.value = now;

  let newTranslate = dragStartTranslateY.value + delta;

  // Rubber band when dragging upward (beyond open position)
  if (newTranslate < 0) {
    newTranslate = newTranslate * RUBBER_BAND_FACTOR;
  }

  translateY.value = newTranslate;
}

function onDragEnd() {
  if (!dragging.value) return;
  dragging.value = false;

  window.removeEventListener('touchmove', onDragMove);
  window.removeEventListener('touchend', onDragEnd);
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragEnd);

  const currentY = translateY.value;
  const v = velocity.value;

  // Dismiss if dragged past threshold OR flicked down fast
  if (
    currentY > sheetHeight.value * DISMISS_THRESHOLD ||
    v > DISMISS_VELOCITY
  ) {
    animateDismiss();
  } else {
    // Spring back to open
    translateY.value = 0;
  }
}

onBeforeUnmount(() => {
  window.removeEventListener('touchmove', onDragMove);
  window.removeEventListener('touchend', onDragEnd);
  window.removeEventListener('mousemove', onDragMove);
  window.removeEventListener('mouseup', onDragEnd);
});
</script>

<style scoped>
.bottom-sheet-overlay {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  z-index: 100;
  display: flex;
  align-items: flex-end;
  transition: background 0.35s ease;
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
  will-change: transform;
  transition: transform 0.35s cubic-bezier(0.32, 0.72, 0, 1);
  box-shadow:
    0 -12px 40px rgba(0, 0, 0, 0.6),
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    inset -1px 0 0 rgba(45, 240, 247, 0.06);
  touch-action: none;
}

.bottom-sheet-container.no-transition {
  transition: none !important;
}

.bottom-sheet-handle {
  display: flex;
  justify-content: center;
  padding: 10px 0 6px;
  cursor: grab;
}

.bottom-sheet-handle:active {
  cursor: grabbing;
}

.handle-bar {
  width: 36px;
  height: 4px;
  background: rgba(255, 255, 255, 0.3);
  border-radius: 2px;
  transition: background 0.15s ease;
}

.bottom-sheet-handle:hover .handle-bar {
  background: rgba(255, 255, 255, 0.5);
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
  -webkit-overflow-scrolling: touch;
}
</style>