<template>
  <div
    v-if="visible"
    class="bottom-sheet-overlay"
    :style="overlayStyle"
    @click.self="onBackdropClick"
  >
    <div
      ref="sheetRef"
      class="bottom-sheet-container"
      :style="sheetStyle"
      role="dialog"
      aria-modal="true"
      :aria-label="title || 'sheet'"
      @pointerdown="onPointerDown"
      @keydown.esc.stop.prevent="onEscape"
    >
      <div v-if="effectiveShowHandle" class="bottom-sheet-handle">
        <div class="handle-bar" />
      </div>
      <div v-if="title" class="bottom-sheet-header">
        <span class="text-subtitle-1 white--text font-weight-bold">{{ title }}</span>
        <v-btn v-if="variant !== 'trust'" icon small @click="close" class="white--text">
          <v-icon small>mdi-close</v-icon>
        </v-btn>
      </div>
      <div class="bottom-sheet-content" ref="contentRef">
        <slot />
      </div>
      <div v-if="$slots.footer" class="bottom-sheet-footer">
        <slot name="footer" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, nextTick, onBeforeUnmount } from 'vue';
import { createSpring, projectMomentum, rubberBand } from '../composables/sheetPhysics';
import { useSheetVisibility } from '../composables/useSheetVisibility';

const props = withDefaults(defineProps<{
  value: boolean;
  title?: string;
  height?: string;
  persistent?: boolean;
  showHandle?: boolean;
  draggable?: boolean;
  variant?: 'standard' | 'trust';
}>(), {
  height: '85%',
  persistent: false,
  showHandle: true,
  draggable: true,
  variant: 'standard',
});

const emit = defineEmits<{
  (e: 'input', value: boolean): void;
  (e: 'close'): void;
  (e: 'escape'): void;
}>();

const visible = ref(false);
const sheetRef = ref<HTMLElement | null>(null);
const contentRef = ref<HTMLElement | null>(null);

const translateY = ref(0);
const sheetHeight = ref(0);
const phase = ref<'entering' | 'open' | 'leaving' | 'closed'>('closed');

// Trust sheets never show a handle (nothing suggests dismissal-by-drag).
const effectiveShowHandle = computed(() => props.variant === 'trust' ? false : props.showHandle);
// Can a drag DISMISS this sheet? Trust and persistent sheets: never.
const canDragDismiss = computed(() => props.draggable && props.variant !== 'trust' && !props.persistent);
// Can the user drag it at all (rubber-band feedback even when not dismissible)?
const canDrag = computed(() => props.draggable);

const prefersReducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

// --- Spring loop ---
const spring = createSpring({ initialValue: 0, dampingRatio: 1, response: 0.3 });
let rafId: number | null = null;
let lastFrame = 0;
let onSpringSettle: (() => void) | null = null;

function startLoop() {
  if (rafId !== null) return;
  lastFrame = performance.now();
  const tick = (now: number) => {
    const dt = Math.min((now - lastFrame) / 1000, 0.1);
    lastFrame = now;
    spring.step(dt);
    translateY.value = spring.getValue();
    if (spring.isSettled()) {
      rafId = null;
      const cb = onSpringSettle;
      onSpringSettle = null;
      cb?.();
      return;
    }
    rafId = requestAnimationFrame(tick);
  };
  rafId = requestAnimationFrame(tick);
}

function stopLoop() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
  }
  onSpringSettle = null;
}

function springTo(target: number, initialVelocity?: number, onSettle?: () => void) {
  onSpringSettle = onSettle ?? null;
  spring.setTarget(target, initialVelocity);
  startLoop();
}

// --- Styles ---
const overlayStyle = computed(() => {
  if (phase.value === 'closed') return {};
  const progress = sheetHeight.value > 0
    ? 1 - Math.max(0, translateY.value) / sheetHeight.value
    : phase.value === 'entering' || phase.value === 'open' ? 1 : 0;
  return { background: `rgba(0, 0, 0, ${0.4 * Math.max(0, Math.min(1, progress))})` };
});

const sheetStyle = computed(() => ({
  height: props.height,
  transform: `translateY(${translateY.value}px)`,
  opacity: prefersReducedMotion && phase.value === 'leaving' ? 0 : 1,
}));

// --- Open / Close ---
let previouslyFocused: HTMLElement | null = null;
const { markSheetOpened, markSheetClosed } = useSheetVisibility();
let holdsOpenCredit = false; // guards against double-increment/decrement

watch(() => props.value, async (val) => {
  if (val) {
    if (!holdsOpenCredit) { holdsOpenCredit = true; markSheetOpened(); }
    previouslyFocused = document.activeElement as HTMLElement | null;
    visible.value = true;
    phase.value = 'entering';
    await nextTick();
    measureSheet();
    if (prefersReducedMotion) {
      spring.setValue(0);
      translateY.value = 0;
      phase.value = 'open';
    } else {
      spring.setValue(sheetHeight.value);
      translateY.value = sheetHeight.value;
      springTo(0, undefined, () => { phase.value = 'open'; });
    }
    await nextTick();
    focusIntoSheet();
  } else {
    animateDismiss();
  }
});

function measureSheet() {
  if (sheetRef.value) sheetHeight.value = sheetRef.value.offsetHeight;
}

function focusIntoSheet() {
  const el = sheetRef.value;
  if (!el) return;
  const focusable = el.querySelector<HTMLElement>(
    'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
  );
  (focusable ?? el).focus?.();
  if (!focusable) el.setAttribute('tabindex', '-1');
}

function finishClose() {
  visible.value = false;
  phase.value = 'closed';
  spring.setValue(0);
  translateY.value = 0;
  if (holdsOpenCredit) { holdsOpenCredit = false; markSheetClosed(); }
  emit('input', false);
  emit('close');
  previouslyFocused?.focus?.();
  previouslyFocused = null;
}

function close() {
  animateDismiss();
}

function animateDismiss(initialVelocity?: number) {
  phase.value = 'leaving';
  if (prefersReducedMotion) {
    // 200ms opacity fade handled by sheetStyle; finish after the fade.
    setTimeout(finishClose, 200);
    return;
  }
  springTo(sheetHeight.value || 2000, initialVelocity, finishClose);
}

function onBackdropClick() {
  if (props.variant === 'trust' || props.persistent) return;
  close();
}

function onEscape() {
  if (props.variant === 'trust') {
    // Deliberate keypress: the consumer decides (maps to its explicit reject).
    emit('escape');
    return;
  }
  close();
}

// --- Drag handling (Pointer Events) ---
const HYSTERESIS_PX = 8;
const INTERACTIVE = 'input, textarea, select, button, a, [contenteditable], .v-btn, .v-input';

let dragPointerId: number | null = null;
let dragCommitted = false;
let dragStartClientY = 0;
let dragStartTranslateY = 0;
let dragFromHandle = false;
let suppressNextClick = false;
// Velocity ring buffer: last 5 {y, t} samples.
const samples: Array<{ y: number; t: number }> = [];

function onPointerDown(e: PointerEvent) {
  if (!canDrag.value) return;
  if (e.button !== 0 && e.pointerType === 'mouse') return;

  const target = e.target as HTMLElement;

  // Never begin a drag — and critically, never call setPointerCapture — from
  // a real control (buttons, inputs, links), regardless of whether it sits
  // inside the handle/header zone. Capturing the pointer on the container
  // disrupts the browser's native click synthesis on the ORIGINAL target, so
  // gating this on "not in the handle/header" silently broke the header close
  // button: pointerdown on it started a drag-capture sequence and its click
  // handler never fired. Only bare handle/header background may start a drag
  // directly; a button placed there must always be clickable.
  if (target.closest(INTERACTIVE)) return;

  dragFromHandle = !!target.closest('.bottom-sheet-handle') || !!target.closest('.bottom-sheet-header');

  dragPointerId = e.pointerId;
  dragCommitted = false;
  dragStartClientY = e.clientY;
  samples.length = 0;
  samples.push({ y: e.clientY, t: performance.now() });

  sheetRef.value?.setPointerCapture(e.pointerId);
  sheetRef.value?.addEventListener('pointermove', onPointerMove);
  sheetRef.value?.addEventListener('pointerup', onPointerUp);
  sheetRef.value?.addEventListener('pointercancel', onPointerCancel);
}

function contentAtTop(): boolean {
  return !contentRef.value || contentRef.value.scrollTop <= 0;
}

function onPointerMove(e: PointerEvent) {
  if (e.pointerId !== dragPointerId) return;
  const dy = e.clientY - dragStartClientY;

  samples.push({ y: e.clientY, t: performance.now() });
  if (samples.length > 5) samples.shift();

  if (!dragCommitted) {
    if (Math.abs(dy) < HYSTERESIS_PX) return;
    // Scroll handoff: on content, only a DOWNWARD drag with content at its top
    // becomes a sheet drag; everything else stays native scrolling.
    if (!dragFromHandle && !(dy > 0 && contentAtTop())) {
      releasePointer();
      return;
    }
    dragCommitted = true;
    // Interruptibility: grab the sheet wherever it currently is.
    stopLoop();
    dragStartTranslateY = translateY.value;
    dragStartClientY = e.clientY; // re-anchor so there is no hysteresis jump
  }

  e.preventDefault();
  let next = dragStartTranslateY + (e.clientY - dragStartClientY);
  if (next < 0) {
    // Above fully-open: rubber band.
    next = rubberBand(next, sheetHeight.value || 600);
  } else if (!canDragDismiss.value) {
    // Trust/persistent sheets: alive but anchored, heavy rubber band downward.
    next = rubberBand(next, sheetHeight.value || 600);
  }
  translateY.value = next;
  spring.setValue(next); // keep the spring's state at the presentation value
}

function releaseVelocity(): number {
  if (samples.length < 2) return 0;
  const newest = samples[samples.length - 1];
  if (performance.now() - newest.t > 100) return 0; // stale: user held still
  const oldest = samples[0];
  const dt = newest.t - oldest.t;
  if (dt <= 0) return 0;
  return ((newest.y - oldest.y) / dt) * 1000; // px/s, positive = downward
}

function onPointerUp(e: PointerEvent) {
  if (e.pointerId !== dragPointerId) return;
  const committed = dragCommitted;
  const v = releaseVelocity();
  releasePointer();
  if (!committed) return;
  suppressNextClick = true;
  setTimeout(() => { suppressNextClick = false; }, 100);

  if (canDragDismiss.value) {
    // Momentum projection decides: where would this motion come to rest?
    const projected = translateY.value + projectMomentum(v);
    if (projected > (sheetHeight.value || 600) / 2) {
      animateDismiss(v);
      return;
    }
  }
  // Snap back to open, inheriting the release velocity (no seam).
  springTo(0, v, () => { phase.value = 'open'; });
}

function onPointerCancel(e: PointerEvent) {
  if (e.pointerId !== dragPointerId) return;
  const committed = dragCommitted;
  releasePointer();
  if (committed) springTo(0, 0, () => { phase.value = 'open'; });
}

function releasePointer() {
  if (dragPointerId !== null) {
    try { sheetRef.value?.releasePointerCapture(dragPointerId); } catch { /* gone */ }
  }
  sheetRef.value?.removeEventListener('pointermove', onPointerMove);
  sheetRef.value?.removeEventListener('pointerup', onPointerUp);
  sheetRef.value?.removeEventListener('pointercancel', onPointerCancel);
  dragPointerId = null;
  dragCommitted = false;
}

// Swallow the click that follows a committed drag so buttons under the finger
// do not activate. Registered per instance and removed on unmount (a bare
// module-level listener would leak once per mount).
function clickBlocker(e: MouseEvent) {
  if (suppressNextClick) {
    e.stopPropagation();
    e.preventDefault();
  }
}
window.addEventListener('click', clickBlocker, true);

onBeforeUnmount(() => {
  stopLoop();
  releasePointer();
  window.removeEventListener('click', clickBlocker, true);
  // Safety net: if this instance is destroyed while still holding an "open"
  // credit (torn down by a parent re-render rather than going through
  // finishClose), don't leak the shared counter.
  if (holdsOpenCredit) { holdsOpenCredit = false; markSheetClosed(); }
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
  box-shadow:
    0 -12px 40px rgba(0, 0, 0, 0.6),
    inset 0 1px 0 rgba(255, 255, 255, 0.12),
    inset -1px 0 0 rgba(45, 240, 247, 0.06);
  outline: none;
}

.bottom-sheet-handle {
  display: flex;
  justify-content: center;
  padding: 10px 0 6px;
  cursor: grab;
  touch-action: none;
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
  touch-action: none;
}

.bottom-sheet-content {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
  -webkit-overflow-scrolling: touch;
  touch-action: pan-y;
}

/* Optional sticky footer (Sign/Reject, a TTL countdown, ...) — stays fixed
   at the bottom of the sheet while .bottom-sheet-content scrolls above it,
   so the primary action and time-critical info are never scrolled out of
   view on a long review (Apple fluid-interfaces §11: what's in the frame
   matters more than raw scroll position). */
.bottom-sheet-footer {
  flex-shrink: 0;
  padding: 12px 16px 16px;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  background: rgba(10, 12, 16, 0.4);
}
</style>
