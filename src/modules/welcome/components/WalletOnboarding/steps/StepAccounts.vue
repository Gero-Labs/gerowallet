<template>
  <div class="step-accounts">
    <div class="step-scroll">
      <p class="accounts-summary" role="status">
        {{ probing ? t('accounts.checking') : tc('accounts.found', usedCount, { count: usedCount }) }}
      </p>
      <ul class="accounts-list">
        <li v-for="row in rows" :key="row.accountIndex">
          <button
            type="button"
            role="checkbox"
            class="account-row glass-tier"
            :class="{ 'account-row--selected': isSelected(row.accountIndex) }"
            :aria-checked="isSelected(row.accountIndex) || !!row.existing"
            :disabled="!selectable(row)"
            @click="toggle(row.accountIndex)"
          >
            <v-icon size="20" class="account-row__check">{{ checkIcon(row) }}</v-icon>
            <span class="account-row__text">
              <span class="account-row__name">{{ t('accounts.label', { index: row.accountIndex }) }}</span>
              <span v-if="row.address" class="account-row__address" :title="row.address">{{ shortAddress(row.address) }}</span>
            </span>
            <span class="account-row__meta">
              <span v-if="row.balance" class="account-row__balance g-num">{{ row.balance }}</span>
              <span class="account-row__status">{{ statusLabel(row) }}</span>
            </span>
          </button>
        </li>
      </ul>
      <p v-if="firstAccountRequired" class="accounts-hint">{{ t('accounts.firstAccountIncluded') }}</p>
      <GButton tier="tertiary" compact :disabled="probing" @click="$emit('scan-more')">
        {{ t('accounts.scanMore', { count: ACCOUNTS_PER_SCAN }) }}
      </GButton>
    </div>

    <div class="onboarding-actions d-flex" style="gap: 12px;">
      <v-btn variant="text" @click="$emit('back')">{{ $t('common.back') }}</v-btn>
      <v-spacer />
      <v-btn class="onb-continue" color="primary" :disabled="probing || !selectedAccounts.length" @click="$emit('next', selectedAccounts)">
        {{ $t('common.continue') }}
      </v-btn>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import GButton from '@/shared/components/GButton/GButton.vue';
import { findExistingWallet } from '@/db/gero-db';
import { ACCOUNTS_PER_SCAN, discoverAccounts, type DiscoveredAccount } from '@/shared/utils/accountDiscovery';
import { formatBalance } from '@/shared/utils/format';
import { toLovelace } from '@/shared/utils/lovelace';
import type { HardwareAccount } from '@/shared/utils/walletAccount';
import type { NetworkInfo } from '@/utils/networks';

const props = defineProps<{
  network: NetworkInfo;
  /** Every account scanned from the device so far. */
  accounts: HardwareAccount[];
}>();

defineEmits<{
  (e: 'next', accounts: HardwareAccount[]): void;
  (e: 'back'): void;
  (e: 'scan-more'): void;
}>();

const { t, tc } = useTranslation();

const discovered = ref<Record<number, DiscoveredAccount>>({});
/** Name of the wallet already holding each account, or null when it is new. */
const existing = ref<Record<number, string | null>>({});
const selected = ref<number[]>([]);
const pending = ref(0);
const probing = computed(() => pending.value > 0);

watch(() => props.accounts, async (accounts) => {
  const fresh = accounts.filter((account) => !(account.accountIndex in discovered.value));
  if (!fresh.length) return;
  pending.value++;
  try {
    const { blockchain: chain, network } = props.network;
    const [found, stored] = await Promise.all([
      discoverAccounts(chain, network, fresh),
      Promise.all(fresh.map((account) => findExistingWallet({ chain, network, publicKey: account.publicKey }))),
    ]);
    found.forEach((account, i) => {
      discovered.value = { ...discovered.value, [account.accountIndex]: account };
      existing.value = { ...existing.value, [account.accountIndex]: stored[i]?.name ?? null };
      // Account #0 heads the group, so it is always added when it is new; the
      // others are offered pre-selected when they have been used.
      if (!stored[i] && (account.accountIndex === 0 || account.activity === 'used')) select(account.accountIndex);
    });
  } finally {
    pending.value--;
  }
}, { immediate: true });

interface Row {
  accountIndex: number;
  address?: string;
  balance?: string;
  activity?: DiscoveredAccount['activity'];
  /** undefined while the check runs, null for an account Gero does not have yet. */
  existing: string | null | undefined;
}

const rows = computed<Row[]>(() => [...props.accounts]
  .sort((a, b) => a.accountIndex - b.accountIndex)
  .map(({ accountIndex }) => {
    const found = discovered.value[accountIndex];
    return {
      accountIndex,
      address: found?.address,
      balance: found?.balance != null && found.activity === 'used'
        ? `${formatBalance(Number(toLovelace(found.balance)) / 1_000_000)} ${props.network.currencySymbol}`
        : undefined,
      activity: found?.activity,
      existing: accountIndex in existing.value ? existing.value[accountIndex] : undefined,
    };
  }));

const usedCount = computed(() => rows.value.filter((row) => row.activity === 'used').length);
/** Account #0 is new, so it has to come along with any other account. */
const firstAccountRequired = computed(() => existing.value[0] === null);
const isSelected = (index: number) => selected.value.includes(index);
const selectable = (row: Row) => row.existing === null && !(row.accountIndex === 0 && firstAccountRequired.value);
const select = (index: number) => {
  if (!isSelected(index)) selected.value = [...selected.value, index].sort((a, b) => a - b);
};
const toggle = (index: number) => {
  selected.value = isSelected(index) ? selected.value.filter((i) => i !== index) : [...selected.value, index].sort((a, b) => a - b);
};
const selectedAccounts = computed(() => props.accounts
  .filter((account) => isSelected(account.accountIndex) && existing.value[account.accountIndex] === null)
  .sort((a, b) => a.accountIndex - b.accountIndex));

const checkIcon = (row: Row) => (row.existing || isSelected(row.accountIndex) ? 'mdi-check-circle' : 'mdi-circle-outline');
const statusLabel = (row: Row): string => {
  if (row.existing) return t('accounts.alreadyAdded', { name: row.existing });
  if (row.activity === 'used') return t('accounts.used');
  if (row.activity === 'unused') return t('miniGero.new');
  if (row.activity === 'unknown') return t('common.unknown');
  return '';
};
const shortAddress = (address: string) => (address.length > 30 ? `${address.slice(0, 15)}…${address.slice(-8)}` : address);
</script>

<style scoped>
.accounts-summary { color: var(--g-text-2); font-size: 13px; margin: 0 0 var(--g-s-3); text-align: left; }
.accounts-list { list-style: none; padding: 0; margin: 0 0 var(--g-s-2); display: flex; flex-direction: column; gap: var(--g-s-2); }
.account-row { display: flex; align-items: center; gap: var(--g-s-3); width: 100%; padding: var(--g-s-3); text-align: left; color: var(--g-text-1); border-radius: var(--g-r-control); transition: border-color var(--g-dur-fast) ease; }
.account-row:not(:disabled):hover, .account-row--selected { border-color: var(--g-accent); }
.account-row:disabled { cursor: default; }
.account-row__check { color: var(--g-text-3); flex: none; }
.account-row--selected .account-row__check { color: var(--g-accent); }
.account-row__text { display: flex; flex-direction: column; gap: var(--g-s-1); flex: 1; min-width: 0; }
.account-row__name { font-size: 14px; font-weight: 600; }
.account-row__address { color: var(--g-text-2); font: 11px var(--g-font-mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.account-row__meta { display: flex; flex-direction: column; align-items: flex-end; gap: var(--g-s-1); flex: none; }
.account-row__balance { font-size: 13px; }
.account-row__status { color: var(--g-text-2); font-size: 12px; }
.accounts-hint { color: var(--g-text-2); font-size: 12px; margin: 0 0 var(--g-s-2); text-align: left; }
.account-row:focus-visible { outline: 2px solid var(--g-accent); outline-offset: 2px; }
</style>
