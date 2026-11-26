<template>
  <!-- Addresses, ids and hashes in full: one mono face, groups of four, the ends emphasised so two
       values that differ only in the middle still read differently. Never shortened. -->
  <span class="chunked-value g-mono" :data-test="testid">
    <template v-for="(part, i) in parts" :key="i">
      <b v-if="i === 0 || i === parts.length - 1">{{ part }}</b><span v-else>{{ part }}</span>{{ i < parts.length - 1 ? ' ' : '' }}
    </template>
    <CopyButton v-if="copy" x-small :value="value" :label="copyLabel" class="chunked-value__copy" />
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import CopyButton from '@/shared/components/CopyButton.vue';
import { chunk } from '@/modules/gerovault/detail/vaultFacts';

defineOptions({ name: 'ChunkedValue' });

const props = withDefaults(defineProps<{
  value: string;
  /** Splits a bech32 value after its human-readable part (`addr_test1`). */
  bech32?: boolean;
  copy?: boolean;
  copyLabel?: string;
  testid?: string;
}>(), { bech32: false, copy: false, copyLabel: undefined, testid: undefined });

const parts = computed(() => {
  if (!props.bech32) return chunk(props.value);
  const at = props.value.lastIndexOf('1');
  if (at <= 0) return chunk(props.value);
  return [props.value.slice(0, at + 1), ...chunk(props.value.slice(at + 1))];
});
</script>

<style scoped>
.chunked-value {
  overflow-wrap: anywhere;
}
.chunked-value__copy {
  margin-left: var(--g-s-1);
  vertical-align: middle;
}
</style>
