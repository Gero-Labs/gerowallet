<template>
  <section class="swap-rows" :class="panel ? 'glass-panel' : 'glass-tier'" :aria-label="ariaLabel">
    <div v-if="eyebrow" class="t-label">{{ eyebrow }}</div>
    <template v-for="(row, index) in rows" :key="index">
      <hr v-if="row.rule" class="swap-rows__rule">
      <div v-else class="swap-rows__row t-body-sm">
        <span class="swap-rows__label">{{ row.label }}</span>
        <span
          class="swap-rows__value g-num"
          :class="[row.tone ? `swap-rows__value--${row.tone}` : '', { 'g-mono': row.mono }]"
          :data-test="row.test"
        >{{ row.value }}</span>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
export interface SwapRow {
  label?: string;
  value?: string;
  /** `muted` for a fact that is not a figure; `success`/`warning` for a state. */
  tone?: 'muted' | 'success' | 'warning';
  mono?: boolean;
  /** A hairline between groups instead of a row. */
  rule?: boolean;
  test?: string;
}

withDefaults(defineProps<{
  rows: SwapRow[];
  eyebrow?: string;
  ariaLabel?: string;
  /** A page-level card (glass panel) rather than one nested in a card (glass tier). */
  panel?: boolean;
}>(), { eyebrow: '', ariaLabel: undefined, panel: true });
</script>

<style scoped lang="scss">
.swap-rows {
  padding: var(--g-s-3) var(--g-s-4);
  border-radius: var(--g-r-card);
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.swap-rows__row {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.swap-rows__label {
  color: var(--g-text-3);
}

.swap-rows__value {
  color: var(--g-text-1);
  text-align: right;
  min-width: 0;
  overflow-wrap: anywhere;
}

.swap-rows__value--muted { color: var(--g-text-2); }
.swap-rows__value--success { color: var(--g-success); }
.swap-rows__value--warning { color: var(--g-warning); }

.swap-rows__rule {
  height: 1px;
  border: 0;
  margin: 0;
  background: var(--g-hairline-1);
}
</style>
