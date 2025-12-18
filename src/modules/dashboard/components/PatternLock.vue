<template>
  <div class="pattern-lock">
    <canvas
      ref="canvas"
      :width="canvasSize"
      :height="canvasSize"
      @mousedown="handleStart"
      @mousemove="handleMove"
      @mouseup="handleEnd"
      @touchstart="handleStart"
      @touchmove="handleMove"
      @touchend="handleEnd"
    ></canvas>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onBeforeUnmount, getCurrentInstance } from 'vue';

interface Dot {
  x: number;
  y: number;
  index: number;
  active: boolean;
}

interface Props {
  value?: number[];
  size?: number;
  dotRadius?: number;
  lineWidth?: number;
}

const props = withDefaults(defineProps<Props>(), {
  value: () => [],
  size: 4,
  dotRadius: 12,
  lineWidth: 5
});

const emit = defineEmits<{
  (e: 'input', value: number[]): void;
  (e: 'complete', value: number[]): void;
}>();

// Get Vuetify theme primary color
const instance = getCurrentInstance();
const primaryColor = String(instance?.proxy?.$vuetify?.theme?.currentTheme?.primary || '#1976D2');

// Template refs
const canvas = ref<HTMLCanvasElement | null>(null);

// Reactive state
const canvasSize = ref(300);
const dots = ref<Dot[]>([]);
const pattern = ref<number[]>([]);
const drawing = ref(false);
const currentX = ref(0);
const currentY = ref(0);
const resetTimeout = ref<number | null>(null);

// Lifecycle
onMounted(() => {
  initializeDots();
  draw();
});

onBeforeUnmount(() => {
  // Clear any pending reset timeout to prevent errors
  if (resetTimeout.value) {
    clearTimeout(resetTimeout.value);
    resetTimeout.value = null;
  }
});

// Methods
function initializeDots() {
  const padding = 50;
  const spacing = (canvasSize.value - 2 * padding) / (props.size - 1);

  dots.value = [];
  for (let row = 0; row < props.size; row++) {
    for (let col = 0; col < props.size; col++) {
      dots.value.push({
        x: padding + col * spacing,
        y: padding + row * spacing,
        index: row * props.size + col,
        active: false
      });
    }
  }
}

function getCanvas(): HTMLCanvasElement | null {
  return canvas.value;
}

function getContext(): CanvasRenderingContext2D | null {
  const canvasEl = getCanvas();
  if (!canvasEl) return null;
  return canvasEl.getContext('2d');
}

function draw() {
  const ctx = getContext();
  const canvasEl = getCanvas();

  // Safety check: if component is destroyed, refs will be undefined
  if (!ctx || !canvasEl) return;

  // Clear canvas
  ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);

  // Draw dots
  dots.value.forEach(dot => {
    if (dot.active) {
      // Active/linked dots: white filled dot with teal outer perimeter circle
      // Draw filled inner dot (white)
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, props.dotRadius * 0.5, 0, 2 * Math.PI);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();

      // Draw outer perimeter circle (primary color)
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, props.dotRadius, 0, 2 * Math.PI);
      ctx.strokeStyle = primaryColor;
      ctx.lineWidth = 3;
      ctx.stroke();
    } else {
      // Inactive/unlinked dots: white filled dots
      ctx.beginPath();
      ctx.arc(dot.x, dot.y, props.dotRadius * 0.5, 0, 2 * Math.PI);
      ctx.fillStyle = '#FFFFFF';
      ctx.fill();
    }
  });

  // Draw lines between pattern dots (primary color)
  if (pattern.value.length > 0) {
    ctx.beginPath();
    const firstDot = dots.value[pattern.value[0]];
    ctx.moveTo(firstDot.x, firstDot.y);

    for (let i = 1; i < pattern.value.length; i++) {
      const dot = dots.value[pattern.value[i]];
      ctx.lineTo(dot.x, dot.y);
    }

    // Draw line to current position if drawing
    if (drawing.value) {
      ctx.lineTo(currentX.value, currentY.value);
    }

    ctx.strokeStyle = primaryColor;
    ctx.lineWidth = props.lineWidth;
    ctx.stroke();
  }
}

function getMousePos(event: MouseEvent | TouchEvent): { x: number; y: number } {
  const canvasEl = getCanvas();
  if (!canvasEl) return { x: 0, y: 0 };
  const rect = canvasEl.getBoundingClientRect();

  let clientX: number;
  let clientY: number;

  if (event instanceof MouseEvent) {
    clientX = event.clientX;
    clientY = event.clientY;
  } else {
    clientX = event.touches[0].clientX;
    clientY = event.touches[0].clientY;
  }

  return {
    x: clientX - rect.left,
    y: clientY - rect.top
  };
}

function getDotAtPosition(x: number, y: number): Dot | null {
  for (const dot of dots.value) {
    const distance = Math.sqrt((x - dot.x) ** 2 + (y - dot.y) ** 2);
    if (distance <= props.dotRadius * 2) {
      return dot;
    }
  }
  return null;
}

function handleStart(event: MouseEvent | TouchEvent) {
  event.preventDefault();
  const pos = getMousePos(event);
  const dot = getDotAtPosition(pos.x, pos.y);

  if (dot) {
    drawing.value = true;
    pattern.value = [dot.index];
    dots.value.forEach(d => {
      d.active = d.index === dot.index;
    });
    currentX.value = dot.x;
    currentY.value = dot.y;
    draw();
  }
}

function handleMove(event: MouseEvent | TouchEvent) {
  if (!drawing.value) return;

  event.preventDefault();
  const pos = getMousePos(event);
  currentX.value = pos.x;
  currentY.value = pos.y;

  const dot = getDotAtPosition(pos.x, pos.y);
  if (dot && !pattern.value.includes(dot.index)) {
    pattern.value.push(dot.index);
    dot.active = true;
  }

  draw();
}

function handleEnd(event: MouseEvent | TouchEvent) {
  if (!drawing.value) return;

  event.preventDefault();
  drawing.value = false;

  if (pattern.value.length >= 4) {
    emit('input', pattern.value);
    emit('complete', pattern.value);
  }

  // Reset after a short delay
  resetTimeout.value = setTimeout(() => {
    reset();
  }, 300) as unknown as number;
}

function reset() {
  pattern.value = [];
  dots.value.forEach(dot => {
    dot.active = false;
  });
  draw();
}
</script>

<style scoped>
.pattern-lock {
  display: flex;
  justify-content: center;
  align-items: center;
}

canvas {
  border: 1px solid #E0E0E0;
  border-radius: 8px;
  touch-action: none;
  cursor: pointer;
}
</style>
