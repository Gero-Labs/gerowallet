<template>
  <!-- Each phase reflects work the wallet is actually doing; nothing here runs on a timer. -->
  <ol class="card-phases" aria-live="polite">
    <li
      v-for="(phase, i) in phases"
      :key="phase"
      class="card-phases__item"
      :class="`is-${stateOf(i)}`"
      :aria-current="stateOf(i) === 'current' ? 'step' : undefined"
    >
      <span class="card-phases__mark" aria-hidden="true">
        <v-icon v-if="stateOf(i) === 'done'" small>mdi-check</v-icon>
        <v-progress-circular v-else-if="stateOf(i) === 'current'" indeterminate size="16" width="2" color="primary" />
      </span>
      <span>{{ phase }}</span>
    </li>
  </ol>
</template>

<script setup lang="ts">
const props = defineProps<{
  phases: string[];
  /** Index of the phase in progress; phases.length = all done. */
  current: number;
}>();

function stateOf(i: number): 'done' | 'current' | 'todo' {
  if (i < props.current) return 'done';
  return i === props.current ? 'current' : 'todo';
}
</script>

<style lang="scss" scoped>
.card-phases {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  list-style: none;
  margin: 0;
  padding: 0;
}

.card-phases__item {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  font-size: 14px;
  color: var(--g-text-3);
}

.card-phases__mark {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  flex: none;
  border-radius: var(--g-r-pill);
  border: 1px solid var(--g-hairline-3);
}

.is-done {
  color: var(--g-text-2);

  .card-phases__mark {
    border-color: transparent;

    .v-icon {
      color: var(--g-success);
    }
  }
}

.is-current {
  color: var(--g-text-1);

  .card-phases__mark {
    border-color: transparent;
  }
}
</style>
