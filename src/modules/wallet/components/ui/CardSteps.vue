<template>
  <ol class="card-steps" :class="{ 'card-steps--compact': compact }" :aria-label="label">
    <li
      v-for="(step, i) in steps"
      :key="step"
      class="card-steps__item"
      :class="`is-${stateOf(i)}`"
      :aria-current="stateOf(i) === 'current' ? 'step' : undefined"
    >
      <span class="card-steps__dot g-num" aria-hidden="true">
        <v-icon v-if="stateOf(i) === 'done'" x-small>mdi-check</v-icon>
        <template v-else>{{ i + 1 }}</template>
      </span>
      <span class="card-steps__label">{{ step }}</span>
      <span v-if="i < steps.length - 1" class="card-steps__line" aria-hidden="true"></span>
    </li>
  </ol>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  steps: string[];
  /** Index of the step in progress; steps before it are done. steps.length = all done. */
  current: number;
  label: string;
  compact?: boolean;
}>(), { compact: false });

function stateOf(i: number): 'done' | 'current' | 'todo' {
  if (i < props.current) return 'done';
  return i === props.current ? 'current' : 'todo';
}
</script>

<style lang="scss" scoped>
.card-steps {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-2) var(--g-s-3);
  list-style: none;
  margin: 0;
  padding: 0;
}

.card-steps__item {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.card-steps__dot {
  display: grid;
  place-items: center;
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: var(--g-r-pill);
  border: 1px solid var(--g-hairline-3);
  color: var(--g-text-3);
  font-size: 11px;
  font-weight: 600;

  .v-icon {
    color: var(--g-accent);
  }
}

.card-steps__label {
  font-size: 13px;
  color: var(--g-text-3);
}

.card-steps__line {
  width: 40px;
  height: 1px;
  background: var(--g-hairline-2);
}

.is-done {
  .card-steps__dot {
    border-color: transparent;
    background: color-mix(in srgb, var(--g-accent) 14%, transparent);
  }

  .card-steps__label {
    color: var(--g-text-2);
  }

  .card-steps__line {
    background: var(--g-accent);
  }
}

.is-current {
  .card-steps__dot {
    border-color: var(--g-accent);
    color: var(--g-accent);
  }

  .card-steps__label {
    color: var(--g-text-1);
    font-weight: 550;
  }
}

.card-steps--compact {
  flex-wrap: nowrap;
  gap: var(--g-s-2);

  .card-steps__item {
    flex: 1;
    min-width: 0;
  }

  .card-steps__item:last-child {
    flex: none;
  }

  .card-steps__dot {
    width: 20px;
    height: 20px;
  }

  .card-steps__label {
    font-size: 12px;
    white-space: nowrap;
  }

  .card-steps__line {
    flex: 1;
    width: auto;
    min-width: var(--g-s-3);
  }
}

@media (max-width: 600px) {
  .card-steps--compact .card-steps__item:not(.is-current) .card-steps__label {
    display: none;
  }
}
</style>
