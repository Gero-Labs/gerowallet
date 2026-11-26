<template>
  <!-- The exact native script, rule by rule, every key by its full hash. -->
  <div class="script-rule g-mono" data-test="script-rule">
    <div v-for="(line, i) in lines" :key="i" class="script-rule__line" :style="{ paddingLeft: `calc(${line.depth} * var(--g-s-4))` }">
      <template v-if="line.kind === 'open'">
        <span v-if="line.rule === 'atLeast'">{{ $t('gerovault.detail.recovery.script.atLeast', { required: line.required ?? 0, of: line.of ?? 0 }) }} [</span>
        <span v-else-if="line.rule === 'all'">{{ $t('gerovault.detail.recovery.script.all') }} [</span>
        <span v-else>{{ $t('gerovault.detail.recovery.script.any') }} [</span>
      </template>
      <span v-else-if="line.kind === 'close'">]</span>
      <span v-else-if="line.kind === 'after'">{{ $t('gerovault.detail.recovery.script.after', { slot: line.slot }) }}</span>
      <span v-else-if="line.kind === 'before'">{{ $t('gerovault.detail.recovery.script.before', { slot: line.slot }) }}</span>
      <template v-else>
        <ChunkedValue :value="line.keyHash" />
        <span v-if="line.own" class="script-rule__own" data-test="script-rule-own">{{ $t('gerovault.detail.recovery.script.yours') }}</span>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { Cardano } from '@cardano-sdk/core';
import ChunkedValue from '@/modules/gerovault/detail/components/ChunkedValue.vue';
import { scriptLines } from './scriptView';

defineOptions({ name: 'ScriptRule' });

const props = defineProps<{ script: Cardano.NativeScript; ownKeyHashes: readonly string[] }>();
const lines = computed(() => scriptLines(props.script, new Set(props.ownKeyHashes)));
</script>

<style scoped>
.script-rule {
  display: flex;
  flex-direction: column;
  padding: var(--g-s-3);
  border-radius: var(--g-r-control);
  border: 1px solid var(--g-hairline-1);
}
.script-rule__own {
  margin-left: var(--g-s-2);
  color: var(--g-success);
}
</style>
