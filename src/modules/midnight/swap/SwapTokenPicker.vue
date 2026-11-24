<template>
  <v-menu v-model="open" location="bottom end" :close-on-content-click="false" max-height="360">
    <template #activator="{ props: activator }">
      <button
        v-bind="activator"
        type="button"
        class="swap-token swap-token--button"
        :aria-label="t('midnight.swap.tokenAria', { token: current.symbol })"
        :data-test="`swap-token-${side}`"
      >
        <span class="swap-token__mark" aria-hidden="true">{{ current.mark }}</span>{{ current.symbol }}
        <v-icon size="14" aria-hidden="true">mdi-chevron-down</v-icon>
      </button>
    </template>
    <div class="glass-popover swap-picker">
      <v-text-field
        v-model="query"
        density="compact"
        variant="outlined"
        hide-details
        autofocus
        :placeholder="t('midnight.swap.tokenSearch')"
        :aria-label="t('midnight.swap.tokenSearch')"
        @keydown.enter="pickTyped()"
      />
      <ul class="swap-picker__list" role="listbox" :aria-label="t('midnight.swap.chooseToken')">
        <li v-for="row in rows" :key="row.tokenType">
          <button
            type="button"
            role="option"
            class="swap-picker__row"
            :aria-selected="row.tokenType === modelValue ? 'true' : 'false'"
            @click="pick(row.tokenType)"
          >
            <span class="swap-token__mark" aria-hidden="true">{{ row.mark }}</span>
            <span class="swap-picker__name">
              <span class="t-body-sm swap-picker__symbol">{{ row.symbol }}</span>
              <span class="t-caption">{{ row.listed ? row.sub : t('midnight.swap.tokenUnlisted') }}</span>
            </span>
            <span v-if="row.balance" class="t-caption g-num">{{ row.balance }}</span>
          </button>
        </li>
        <li v-if="typedType && !rows.some(row => row.tokenType === typedType)">
          <button type="button" role="option" aria-selected="false" class="swap-picker__row" @click="pick(typedType)">
            <span class="swap-token__mark" aria-hidden="true">?</span>
            <span class="swap-picker__name">
              <span class="t-body-sm g-mono">{{ shortTokenType(typedType) }}</span>
              <span class="t-caption">{{ t('midnight.swap.tokenUnlisted') }}</span>
            </span>
          </button>
        </li>
      </ul>
    </div>
  </v-menu>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { midnightCatalogTokens } from '@/chains/midnight/midnightTokenCatalog';
import { shortTokenType, swapBalanceText, swapTokenInfo, NIGHT_TOKEN_TYPE } from './swapTokens';

const props = defineProps<{
  modelValue: string;
  network: string | null;
  /** `give`: only tokens the wallet holds. `want`: NIGHT, the catalog, held tokens, or a pasted token type. */
  side: 'give' | 'want';
  /** Spendable base units per token type (offered coins excluded). */
  balances: ReadonlyMap<string, bigint>;
}>();
const emit = defineEmits<{ (e: 'update:modelValue', tokenType: string): void }>();
const { t } = useTranslation();

const open = ref(false);
const query = ref('');
const current = computed(() => swapTokenInfo(props.modelValue, props.network));

/** A pasted 64-hex token type (want side only). */
const typedType = computed(() => {
  const value = query.value.trim().toLowerCase();
  return props.side === 'want' && /^[0-9a-f]{64}$/.test(value) ? value : '';
});

const rows = computed(() => {
  const types = new Set<string>();
  if (props.side === 'want') types.add(NIGHT_TOKEN_TYPE);
  for (const [type, value] of props.balances) if (value > 0n) types.add(type);
  if (props.side === 'want') {
    // Listed tokens first; unverified catalog tokens can still be asked for, with the warning.
    for (const token of midnightCatalogTokens.value) if (token.kind === 'UNSHIELDED' && token.verified) types.add(token.tokenType);
    for (const token of midnightCatalogTokens.value) if (token.kind === 'UNSHIELDED' && !token.verified) types.add(token.tokenType);
  }
  const needle = query.value.trim().toLowerCase();
  return [...types].map((type) => {
    const info = swapTokenInfo(type, props.network);
    const held = props.balances.get(type);
    return {
      ...info,
      sub: info.isNight ? t('midnight.swap.nativeToken') : shortTokenType(type),
      balance: held ? swapBalanceText(held, info) : '',
    };
  }).filter(row => !needle || row.symbol.toLowerCase().includes(needle) || row.tokenType.includes(needle));
});

function pick(tokenType: string) {
  emit('update:modelValue', tokenType);
  open.value = false;
  query.value = '';
}

function pickTyped() {
  if (typedType.value) pick(typedType.value);
  else if (rows.value.length === 1) pick(rows.value[0].tokenType);
}
</script>

<style scoped lang="scss">
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
  cursor: pointer;
}

.swap-token--button:focus-visible {
  outline: 2px solid var(--g-accent);
  outline-offset: 2px;
}

.swap-token__mark {
  width: 24px;
  height: 24px;
  flex: 0 0 auto;
  border-radius: var(--g-r-pill);
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-3);
  color: var(--g-text-1);
}

.swap-picker {
  width: 300px;
  padding: var(--g-s-2);
  border-radius: var(--g-r-card);
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.swap-picker__list {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 260px;
  overflow-y: auto;
}

.swap-picker__row {
  width: 100%;
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  padding: var(--g-s-2);
  border: 0;
  border-radius: var(--g-r-control);
  background: none;
  color: var(--g-text-1);
  text-align: left;
  cursor: pointer;
}

.swap-picker__row:hover,
.swap-picker__row[aria-selected='true'] {
  background: var(--g-hairline-1);
}

.swap-picker__row:focus-visible {
  outline: 2px solid var(--g-accent);
  outline-offset: -2px;
}

.swap-picker__name {
  flex: 1 1 auto;
  min-width: 0;
  display: flex;
  flex-direction: column;
}

.swap-picker__symbol {
  color: var(--g-text-1);
}
</style>
