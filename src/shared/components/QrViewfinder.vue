<template>
  <div class="qr-viewfinder" :style="{ width: `${size}px` }">
    <slot />
  </div>
</template>

<script setup lang="ts">
/** A square camera frame for scanning a device's QR (the scanner goes in the slot at 100% × 100%). */
withDefaults(defineProps<{ size?: number }>(), { size: 246 });
</script>

<style scoped lang="scss">
// A square viewfinder with accent corner marks, instead of a full-width video.
// Shared by Keystone pairing and the Keystone sign dialog.
.qr-viewfinder {
  position: relative;
  flex: none;
  max-width: 100%;
  aspect-ratio: 1;
  overflow: hidden;
  border-radius: var(--g-r-control);
  border: 1px solid var(--g-hairline-2);
  // A solid backdrop while the camera starts (it is a control, not a surface).
  background: var(--g-canvas);

  &::after {
    content: '';
    position: absolute;
    inset: var(--g-s-3);
    pointer-events: none;
    --mark: 22px;
    background:
      linear-gradient(var(--g-accent), var(--g-accent)) top left / var(--mark) 2px,
      linear-gradient(var(--g-accent), var(--g-accent)) top left / 2px var(--mark),
      linear-gradient(var(--g-accent), var(--g-accent)) top right / var(--mark) 2px,
      linear-gradient(var(--g-accent), var(--g-accent)) top right / 2px var(--mark),
      linear-gradient(var(--g-accent), var(--g-accent)) bottom left / var(--mark) 2px,
      linear-gradient(var(--g-accent), var(--g-accent)) bottom left / 2px var(--mark),
      linear-gradient(var(--g-accent), var(--g-accent)) bottom right / var(--mark) 2px,
      linear-gradient(var(--g-accent), var(--g-accent)) bottom right / 2px var(--mark);
    background-repeat: no-repeat;
  }

  // The scanner's own status text (camera starting, permission) fits the square.
  :deep(.status-message) {
    padding: var(--g-s-3);
  }
}
</style>
