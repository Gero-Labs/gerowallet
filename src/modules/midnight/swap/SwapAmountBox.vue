<template>
  <div class="glass-tier swap-amount">
    <div class="swap-amount__top t-caption">
      <span>{{ label }}</span>
      <span v-if="hint" class="g-num">{{ hint }}</span>
    </div>
    <div class="swap-amount__main">
      <template v-if="editable">
        <label class="g-sr-only" :for="inputId">{{ inputLabel }}</label>
        <input
          :id="inputId"
          class="swap-amount__num t-title g-num"
          :value="modelValue"
          inputmode="decimal"
          autocomplete="off"
          placeholder="0"
          :aria-invalid="invalid ? 'true' : undefined"
          @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)"
        >
      </template>
      <span v-else class="swap-amount__num t-title g-num">{{ modelValue }}</span>
      <slot name="token">
        <span class="swap-token">
          <span class="swap-token__mark" aria-hidden="true">{{ token.mark }}</span>{{ token.symbol }}
        </span>
      </slot>
    </div>
    <div v-if="$slots['sub']" class="t-caption"><slot name="sub"></slot></div>
  </div>
</template>

<script setup lang="ts">
import { useId } from 'vue';
import type { SwapTokenInfo } from './swapTokens';

withDefaults(defineProps<{
  label: string;
  /** Right of the label: the balance, or the offer's rate. */
  hint?: string;
  modelValue: string;
  token: SwapTokenInfo;
  editable?: boolean;
  /** The input's accessible name. */
  inputLabel?: string;
  invalid?: boolean;
}>(), { hint: '', editable: false, inputLabel: '', invalid: false });

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>();
const inputId = useId();
</script>

<style scoped lang="scss">
.swap-amount {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-3);
  border-radius: var(--g-r-card);
}

.swap-amount__top {
  display: flex;
  justify-content: space-between;
  gap: var(--g-s-2);
}

.swap-amount__main {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.swap-amount__num {
  flex: 1 1 auto;
  min-width: 0;
  background: none;
  border: 0;
  padding: 0;
  font-family: var(--g-font-ui);
  color: var(--g-text-1);
}

.swap-amount__num:focus-visible {
  outline: 2px solid var(--g-accent);
  outline-offset: 2px;
  border-radius: var(--g-r-chip);
}

.swap-amount__num[aria-invalid='true'] {
  color: var(--g-error);
}

/* A control: a justified solid. */
.swap-token {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-2);
  flex: 0 0 auto;
  height: var(--g-btn-h-compact);
  padding: 0 var(--g-s-3) 0 6px;
  border-radius: var(--g-r-pill);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-1);
  font-weight: 600;
}

.swap-token__mark {
  width: 24px;
  height: 24px;
  border-radius: var(--g-r-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-3);
}
</style>
