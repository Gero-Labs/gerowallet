<template>
  <!-- Beside the dialog when the window has room for both: it slides out from behind the
       dialog's right edge while the dialog moves aside, and an accent line draws across its
       top once, so it is seen without anything looping. Otherwise it opens in place. -->
  <Teleport :to="host?.el.value ?? 'body'" :disabled="!beside">
    <Transition :name="beside ? 'dialog-drawer-side' : 'dialog-drawer-inline'" appear>
      <aside v-if="open" class="dialog-drawer" :class="{ 'dialog-drawer--side': beside }" :aria-label="label">
        <span v-if="beside" class="dialog-drawer__accent" aria-hidden="true"></span>
        <slot></slot>
      </aside>
    </Transition>
  </Teleport>
</template>

<script setup lang="ts">
import { computed, inject, onBeforeUnmount, watch } from 'vue';
import { DIALOG_DRAWER_HOST } from './dialogDrawer';

const props = defineProps<{
  open: boolean;
  /** The drawer's accessible name. */
  label?: string;
}>();

const host = inject(DIALOG_DRAWER_HOST, null);
const id = Symbol('dialogDrawer');
const beside = computed(() => !!host?.el.value && host.roomBeside.value);

watch(() => props.open, (open) => host?.setOpen(id, open), { immediate: true });
onBeforeUnmount(() => host?.setOpen(id, false));
</script>

<style lang="scss" scoped>
.dialog-drawer {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  text-align: left;
}

/* Beside the dialog: a sheet of its own, as tall as it needs up to the dialog's height. */
.dialog-drawer--side {
  @include g-glass-overlay();
  position: relative;
  max-height: 100%;
  overflow-y: auto;
  padding: var(--g-s-5) var(--g-s-4) var(--g-s-4);
  border-radius: var(--g-r-sheet);
  pointer-events: auto;
}

/* The header hairline, in the accent gradient: drawn left to right once as the drawer lands. */
.dialog-drawer__accent {
  position: absolute;
  top: 0;
  left: var(--g-s-4);
  right: var(--g-s-4);
  height: 2px;
  border-radius: var(--g-r-pill);
  background: linear-gradient(90deg, var(--g-grad-1), var(--g-grad-2));
  transform-origin: left center;
  animation: dialog-drawer-accent var(--g-dur-slow) var(--g-ease) var(--g-dur-base) both;
}

@keyframes dialog-drawer-accent {
  from { transform: scaleX(0); opacity: 0; }
  to { transform: scaleX(1); opacity: 1; }
}

/* Slides out from behind the dialog's edge, in step with the dialog moving aside. */
.dialog-drawer-side-enter-active,
.dialog-drawer-side-leave-active {
  transition:
    transform var(--g-dur-slow) var(--g-ease-sheet),
    opacity var(--g-dur-slow) var(--g-ease-sheet);
}

.dialog-drawer-side-enter-from,
.dialog-drawer-side-leave-to {
  transform: translateX(-56px) scale(0.97);
  opacity: 0;
}

.dialog-drawer-inline-enter-active,
.dialog-drawer-inline-leave-active {
  transition:
    transform var(--g-dur-base) var(--g-ease),
    opacity var(--g-dur-base) var(--g-ease);
}

.dialog-drawer-inline-enter-from,
.dialog-drawer-inline-leave-to {
  transform: translateY(-8px);
  opacity: 0;
}
</style>
