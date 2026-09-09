<template>
  <div class="mtl" :class="{ 'mtl--compact': compact }">
    <div
      v-for="(node, i) in nodes"
      :key="node.key"
      class="mtl-node"
      :class="node.state"
    >
      <div class="mtl-node__marker">
        <div class="mtl-dot">
          <v-icon v-if="node.state === 'done'" x-small color="var(--g-canvas)">mdi-check</v-icon>
          <span v-else-if="node.state === 'active'" class="mtl-pulse"></span>
        </div>
        <div
          v-if="i < nodes.length - 1"
          class="mtl-conn"
          :class="{ filled: node.state === 'done' }"
        ></div>
      </div>
      <div class="mtl-node__body">
        <div class="mtl-node__label">{{ node.label }}</div>
        <div
          v-if="node.showBar && node.state === 'active'"
          class="mtl-bar"
          :class="{ indeterminate: node.percent === null }"
        >
          <div
            class="mtl-bar__fill"
            :style="node.percent != null ? { width: node.percent + '%' } : undefined"
          ></div>
        </div>
        <div v-if="node.detail && node.state === 'active'" class="mtl-node__detail">
          {{ node.detail }}
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The five-node send timeline, shared by the options-page dialog and the
 * side-panel sheet.
 *
 * One component rather than two copies: the panel previously had no timeline
 * at all, and adding a second one duplicated both the markup and its keyframes.
 * `compact` is the panel's smaller variant — same nodes, same states, tighter
 * metrics.
 *
 * The node model itself lives in `useMidnightSendTimeline`, so what a stage
 * means is decided in exactly one place too.
 */
import type { TimelineNode } from '@/shared/composables/useMidnightSendTimeline';

withDefaults(defineProps<{
  nodes: TimelineNode[];
  compact?: boolean;
}>(), { compact: false });
</script>

<style scoped>
.mtl {
  display: flex;
  flex-direction: column;
  flex: 1;
  min-width: 0;
}

.mtl-node {
  display: flex;
  gap: 12px;
  min-height: 54px;
}

.mtl--compact .mtl-node {
  gap: 10px;
  min-height: 34px;
}

.mtl-node:last-child {
  min-height: auto;
}

.mtl-node__marker {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.mtl-dot {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  flex-shrink: 0;
  background: var(--g-raised);
  transition: background-color 0.35s ease, box-shadow 0.35s ease;
}

.mtl--compact .mtl-dot {
  width: 14px;
  height: 14px;
}

.mtl-node.done .mtl-dot {
  background: var(--g-accent);
}

.mtl-node.active .mtl-dot {
  background: transparent;
  box-shadow: 0 0 0 2px var(--g-accent);
}

/* Status pulse — sanctioned motion: it reports that work is ongoing. */
.mtl-pulse {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--g-accent);
  animation: mtl-pulse 1.2s ease-in-out infinite;
}

.mtl--compact .mtl-pulse {
  width: 6px;
  height: 6px;
}

@keyframes mtl-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.55); opacity: 0.5; }
}

.mtl-conn {
  width: 2px;
  flex: 1;
  min-height: 20px;
  margin: 3px 0;
  background: var(--g-raised);
  transition: background-color 0.4s ease;
}

.mtl--compact .mtl-conn {
  min-height: 12px;
  margin: 2px 0;
}

.mtl-conn.filled {
  background: var(--g-accent);
}

.mtl-node__body {
  flex: 1;
  min-width: 0;
  padding-top: 2px;
}

.mtl-node__label {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-3);
  transition: color 0.3s ease;
}

.mtl--compact .mtl-node__label {
  font-size: 12px;
}

.mtl-node.active .mtl-node__label {
  color: var(--g-text-1);
}

.mtl-node.done .mtl-node__label {
  color: var(--g-text-2);
}

.mtl-bar {
  margin-top: 7px;
  height: 4px;
  max-width: 190px;
  border-radius: var(--g-r-chip);
  background: var(--g-hairline-1);
  overflow: hidden;
}

.mtl--compact .mtl-bar {
  margin-top: 5px;
  max-width: none;
}

.mtl-bar__fill {
  height: 100%;
  width: 0;
  border-radius: var(--g-r-chip);
  background: var(--g-accent);
  transition: width 0.45s cubic-bezier(0.4, 0, 0.2, 1);
}

/* Indeterminate: proving reports no percentage, and a fabricated one would
   be a lie about progress. */
.mtl-bar.indeterminate .mtl-bar__fill {
  width: 40%;
  animation: mtl-indet 1.1s ease-in-out infinite;
}

@keyframes mtl-indet {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(320%); }
}

.mtl-node__detail {
  margin-top: 5px;
  font-size: 11px;
  color: var(--g-text-3);
}

@media (prefers-reduced-motion: reduce) {
  .mtl-pulse,
  .mtl-bar.indeterminate .mtl-bar__fill { animation: none; }
  .mtl-bar__fill,
  .mtl-dot,
  .mtl-conn,
  .mtl-node__label { transition: none; }
}
</style>
