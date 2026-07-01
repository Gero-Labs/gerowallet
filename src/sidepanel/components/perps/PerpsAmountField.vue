<template>
  <div class="af" :class="{ 'af--focus': focused }" :style="{ '--af-accent': accent }">
    <input
      ref="inputEl"
      :value="value"
      inputmode="decimal"
      type="text"
      spellcheck="false"
      autocomplete="off"
      :placeholder="placeholder"
      class="af__input"
      @input="onInput"
      @focus="focused = true"
      @blur="focused = false"
      @keydown.enter="$emit('submit')"
    />
    <span class="af__ccy">{{ currency }}</span>
    <button v-if="showMax" type="button" class="af__max" @click="$emit('max')">MAX</button>
  </div>
</template>

<script setup lang="ts">
/**
 * PerpsAmountField — the shared amount input used by every Strike deposit /
 * withdraw sheet (account + vault). A custom text input (NOT type=number) so
 * there are no native up/down spinner buttons, with a large monospace figure,
 * an inline currency label and a MAX chip. The accent colour is themeable via
 * the `accent` prop (a hex like #00c7f3 or a CSS var like var(--chain-primary)).
 *
 * v-model is the cleaned decimal string. Emits `max` when the chip is tapped
 * and `submit` on Enter. Call the exposed `focus()` to focus the field on open.
 */
import { ref } from 'vue';

withDefaults(defineProps<{
  value: string;
  currency: string;
  placeholder?: string;
  accent?: string;
  showMax?: boolean;
}>(), {
  placeholder: '0',
  accent: '#00c7f3',
  showMax: true,
});

const emit = defineEmits<{
  (e: 'input', value: string): void;
  (e: 'max'): void;
  (e: 'submit'): void;
}>();

const focused = ref(false);
const inputEl = ref<HTMLInputElement | null>(null);

/** Keep digits + a single decimal point; strip everything else. */
function onInput(e: Event): void {
  const raw = (e.target as HTMLInputElement).value;
  let cleaned = raw.replace(/[^0-9.]/g, '');
  const dot = cleaned.indexOf('.');
  if (dot !== -1) {
    cleaned = cleaned.slice(0, dot + 1) + cleaned.slice(dot + 1).replace(/\./g, '');
  }
  emit('input', cleaned);
}

function focus(): void {
  inputEl.value?.focus();
}

defineExpose({ focus });
</script>

<style scoped>
.af {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 8px 0 16px;
  height: 66px;
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 14px;
  transition: border-color 0.18s ease, background 0.18s ease, box-shadow 0.18s ease;
}
.af--focus {
  border-color: var(--af-accent);
  background: color-mix(in srgb, var(--af-accent) 4%, transparent);
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--af-accent) 8%, transparent);
}
.af__input {
  flex: 1;
  min-width: 0;
  background: none;
  border: none;
  outline: none;
  color: #ffffff;
  font-family: 'JetBrains Mono', 'Fira Code', monospace;
  font-size: 30px;
  font-weight: 600;
  letter-spacing: -0.01em;
  caret-color: var(--af-accent);
  padding: 0;
}
.af__input::placeholder { color: rgba(255, 255, 255, 0.22); }
/* Belt-and-braces: hide native number spinners if a number type ever sneaks in */
.af__input::-webkit-outer-spin-button,
.af__input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0; }
.af__ccy {
  font-size: 13px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.4);
  letter-spacing: 0.04em;
  flex-shrink: 0;
}
.af__max {
  flex-shrink: 0;
  padding: 7px 13px;
  border-radius: 9px;
  font-size: 11px;
  font-weight: 800;
  letter-spacing: 0.06em;
  color: var(--af-accent);
  background: color-mix(in srgb, var(--af-accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--af-accent) 25%, transparent);
  cursor: pointer;
  transition: background 0.15s ease;
}
.af__max:hover { background: color-mix(in srgb, var(--af-accent) 20%, transparent); }
</style>
