<template>
  <span class="status-pill t-caption" :class="`status-pill--${tone}`">{{ label }}</span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PropType } from 'vue';
import { statusTone } from '@/shared/utils/govLifecycle';
import { useTranslation } from '@/shared/composables/useTranslation';

// Runtime declaration — a `string | null` type literal compiles to a
// `[String, null]` validator and warns on every render (null is not a
// constructor). See AsOf.vue.
const props = defineProps({
  status: { type: String as PropType<string | null>, default: null },
});
const { t } = useTranslation();

const tone = computed(() => statusTone(props.status));
const label = computed(() => {
  const key = `governance.status.${String(props.status ?? 'unknown').toLowerCase()}`;
  const translated = String(t(key));
  // vue-i18n returns the key itself for a missing translation, so a status the
  // backend adds later would render as "governance.status.foo" to a user. Fall
  // back to the raw status instead.
  return translated === key ? String(props.status ?? '') : translated;
});
</script>

<style scoped>
.status-pill {
  display: inline-flex;
  align-items: center;
  border-radius: var(--g-r-pill);
  padding: 0 var(--g-s-2);
  font-family: var(--g-font-ui);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-2);
}
.status-pill--success {
  color: var(--g-success);
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}
.status-pill--info {
  color: var(--g-accent);
  border-color: var(--g-hairline-3);
}
.status-pill--warning {
  color: var(--g-warning);
  background: var(--g-warning-fill);
  border-color: var(--g-warning-line);
}
.status-pill--neutral {
  color: var(--g-text-3);
}
</style>
