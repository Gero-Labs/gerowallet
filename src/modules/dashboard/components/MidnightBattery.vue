<template>
  <div
    class="battery"
    :class="{ 'battery--sm': small }"
    role="progressbar"
    :aria-valuenow="pct ?? undefined"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-label="ariaLabel"
  >
    <div class="battery__cells" :class="{ 'battery__cells--unk': unknown, 'battery__cells--dead': dead }">
      <div
        v-if="pct !== null"
        class="battery__fill"
        :class="{ 'battery__fill--full': full }"
        :style="{ width: pct + '%' }"
      />
      <!-- Dividers: sand over the empty track, dark once the fill passes them,
           so the gradient still reads underneath. -->
      <div
        v-for="n in dividerCount"
        :key="n"
        class="battery__divider"
        :class="{ 'battery__divider--covered': pct !== null && (n * 100 / (dividerCount + 1)) <= pct }"
        :style="{ left: (n * 100 / (dividerCount + 1)) + '%' }"
      />
      <!-- Overlay slot: the dashboard gauge drops its dust-particle canvas in
           here, so the animated variant and the plain one stay one battery. -->
      <slot />
    </div>
    <div class="battery__nub" />
  </div>
</template>

<script setup lang="ts">
/**
 * The DUST battery, as its own component.
 *
 * Lifted verbatim from `MidnightDustGauge.vue`, which owned the only copy, so
 * the fee-wallet strip can draw a sponsor's charge with the SAME battery rather
 * than a lookalike. Every value here — the gradient, the sand dividers, the
 * nub — comes from that original; nothing was redesigned in the move.
 *
 * `pct === null` is the honest unknown: no fill is drawn and the track is
 * hatched. That is not the same as 0%, and rendering it as an empty battery is
 * exactly the misreading that sent a whole debugging session after the wrong
 * wallet.
 */
import { computed } from 'vue';

const props = withDefaults(defineProps<{
  /** Charge 0-100, or null when it has not been read. */
  pct?: number | null;
  /** The 14px variant used inside the fee-wallet strip. */
  small?: boolean;
  /** Hatched track — charge not known. */
  unknown?: boolean;
  /** Sponsor cannot pay at all (e.g. wrong network): drawn dead, not empty. */
  dead?: boolean;
  /** Charged to cap — a warmer gradient and a fully rounded fill. */
  full?: boolean;
  ariaLabel?: string;
}>(), { pct: null, small: false, unknown: false, dead: false, full: false, ariaLabel: undefined });

/** Fewer cells in the small variant, so the ticks stay legible at 14px. */
const dividerCount = computed(() => (props.small ? 7 : 11));
</script>

<style lang="scss" scoped>
.battery {
  display: flex;
  align-items: stretch;
  gap: 3px;
  height: 22px;
}

.battery--sm {
  height: 14px;
  gap: 2px;
}

.battery__cells {
  position: relative;
  flex: 1;
  border-radius: var(--g-r-control);
  background: rgba(2, 6, 18, 0.55);
  border: 1px solid rgba(236, 201, 133, 0.12);
  overflow: hidden;
}

.battery--sm .battery__cells {
  border-radius: var(--g-r-chip);
}

/* Unknown: hatched, never an empty track — an empty battery reads as zero. */
.battery__cells--unk {
  background:
    repeating-linear-gradient(135deg, rgba(236, 201, 133, 0.06) 0 4px, transparent 4px 10px),
    rgba(2, 6, 18, 0.55);

  .battery__divider {
    background: rgba(236, 201, 133, 0.18);
  }
}

.battery__cells--dead {
  border-color: var(--g-hairline-2);

  .battery__divider {
    background: rgba(255, 255, 255, 0.08);
  }
}

.battery__fill {
  position: absolute;
  inset: 0 auto 0 0;
  height: 100%;
  border-radius: 5px 0 0 5px;
  background: linear-gradient(90deg, #2E1065 0%, #7C3AED 45%, #C4A7FC 72%, #ecc985 100%);
  transition: width 0.9s cubic-bezier(0.22, 1, 0.36, 1);
}

.battery__fill--full {
  border-radius: 5px;
  background: linear-gradient(90deg, #2E1065 0%, #9D7BEA 55%, #ffe9b2 100%);
}

.battery__divider {
  position: absolute;
  top: 0;
  bottom: 0;
  width: 1px;
  background: rgba(236, 201, 133, 0.45);
  transition: background 0.4s ease;
}

.battery__divider--covered {
  background: rgba(0, 0, 0, 0.38);
}

.battery__nub {
  width: 3px;
  align-self: center;
  height: 10px;
  border-radius: 0 2px 2px 0;
  background: rgba(236, 201, 133, 0.35);
}

.battery--sm .battery__nub {
  width: 2px;
  height: 7px;
}

@media (prefers-reduced-motion: reduce) {
  .battery__fill,
  .battery__divider {
    transition: none;
  }
}
</style>
