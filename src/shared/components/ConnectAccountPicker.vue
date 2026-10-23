<template>
  <div v-if="accounts.length > 1" class="connect-account">
    <p :id="labelId" class="t-label connect-account__label">{{ t('accounts.connectAccount') }}</p>
    <div class="connect-account__list" role="radiogroup" :aria-labelledby="labelId">
      <button
        v-for="account in accounts"
        :key="account.id"
        type="button"
        role="radio"
        class="connect-account__row glass-tier"
        :class="{ 'connect-account__row--selected': account.id === modelValue }"
        :aria-checked="account.id === modelValue"
        @click="emit('update:modelValue', account.id)"
      >
        <v-icon size="18" class="connect-account__check">
          {{ account.id === modelValue ? 'mdi-radiobox-marked' : 'mdi-radiobox-blank' }}
        </v-icon>
        <span class="connect-account__text">
          <span class="connect-account__name t-body-sm">{{ account.name }}</span>
          <span v-if="addresses[account.id]" class="connect-account__address g-mono t-caption" :title="addresses[account.id]">
            {{ shortAddress(addresses[account.id]) }}
          </span>
        </span>
        <span class="t-caption connect-account__index">{{ t('accounts.label', { index: account.accountIndex ?? 0 }) }}</span>
      </button>
    </div>
    <p v-if="modelValue !== undefined && modelValue !== loggedId" class="t-caption connect-account__note" role="status">
      {{ t('accounts.connectSwitches') }}
    </p>
  </div>
</template>

<script setup lang="ts">
import { ref, useId, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { accountReceiveAddress } from '@/shared/utils/accountDiscovery';
import type { Wallet } from '@/models/types';

// The account a dApp connect prompt connects (#1331). Shown only when the logged
// wallet has more than one account; picking another one switches Gero to it.
const props = defineProps<{
  /** The logged wallet's accounts, account #0 first. */
  accounts: Wallet[];
  /** The chosen account's id. */
  modelValue: number | undefined;
  /** The logged account's id. */
  loggedId: number | undefined;
}>();

const emit = defineEmits<{ (e: 'update:modelValue', id: number): void }>();

const { t } = useTranslation();
const labelId = useId();

/** Each account's first receive address, by record id. */
const addresses = ref<Record<number, string>>({});
let derivation = 0;
watch(() => props.accounts, async (accounts) => {
  const run = ++derivation;
  const entries = await Promise.all(accounts.map(async (account) => [account.id, await accountReceiveAddress(account)] as const));
  // A newer account list may have landed meanwhile; its addresses win.
  if (run === derivation) addresses.value = Object.fromEntries(entries);
}, { immediate: true });

const shortAddress = (address: string) => (address.length > 30 ? `${address.slice(0, 15)}…${address.slice(-8)}` : address);
</script>

<style scoped lang="scss">
// Type comes from the ramp classes in the markup; these rules only lay out.
.connect-account__label { margin: 0 0 var(--g-s-2); }
.connect-account__list { display: flex; flex-direction: column; gap: var(--g-s-2); }

// A choice card nested in the prompt: the glass-tier material, its hover lift
// and its selected tint, never an accent repaint.
.connect-account__row {
  display: flex;
  align-items: center;
  gap: var(--g-s-3);
  width: 100%;
  padding: var(--g-s-2) var(--g-s-3);
  text-align: left;
  color: var(--g-text-1);
  transition: border-color var(--g-dur-fast) var(--g-ease), background-color var(--g-dur-fast) var(--g-ease);

  &:hover { @include g-glass-tier-hover; }
  &--selected,
  &--selected:hover { @include g-glass-tier-active; }
}
.connect-account__check { color: var(--g-text-3); flex: none; }
.connect-account__row--selected .connect-account__check { color: var(--g-accent); }
.connect-account__text { display: flex; flex-direction: column; gap: var(--g-s-1); flex: 1; min-width: 0; }
.connect-account__name { color: var(--g-text-1); font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
// One truncated line, so the mono recipe's break-all wrapping is switched off.
.connect-account__address { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; word-break: normal; }
.connect-account__index { flex: none; }
.connect-account__note { margin: var(--g-s-2) 0 0; }
</style>
