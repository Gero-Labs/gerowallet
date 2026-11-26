<template>
  <!-- An amount of ADA and every token with it. Token names are the bytes as text or hex; the
       policy that makes a token what it is shows in the Details layer. -->
  <div class="vault-value" :class="{ 'vault-value--end': alignEnd }">
    <span :class="[emphasis ? 't-heading' : 't-body', 'g-num', 'vault-value__ada']">
      {{ $t('gerovault.spend.ada', { amount: (negative ? '-' : '') + adaText(value.lovelace) }) }}
    </span>
    <span v-for="token in value.tokens" :key="`${token.policyId}.${token.assetNameHex}`" class="t-body-sm g-num vault-value__token">
      {{ $t('gerovault.spend.tokenAmount', { quantity: token.quantity.toString(), name: tokenName(token) || $t('gerovault.spend.tokenNameless') }) }}
      <span v-if="details" class="g-mono t-caption vault-value__policy">{{ token.policyId }}</span>
    </span>
  </div>
</template>

<script setup lang="ts">
import type { ValueView } from '@/shared/gerovault/decode';
import { adaText, tokenName } from '../display';

withDefaults(defineProps<{
  value: ValueView;
  /** The large figure of the sheet. */
  emphasis?: boolean;
  /** Shown as leaving: a minus sign before the ADA figure. */
  negative?: boolean;
  /** The Details layer is on: show each token's policy id. */
  details?: boolean;
  alignEnd?: boolean;
}>(), { emphasis: false, negative: false, details: false, alignEnd: false });
</script>

<style scoped>
.vault-value {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-1);
  min-width: 0;
}
.vault-value--end {
  align-items: flex-end;
  text-align: right;
}
.vault-value__ada {
  color: var(--g-text-1);
}
.vault-value__token {
  display: flex;
  flex-direction: column;
  overflow-wrap: anywhere;
}
.vault-value__policy {
  overflow-wrap: anywhere;
}
</style>
