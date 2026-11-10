<template>
  <!-- Sends kept through a chain reset that the indexer didn't find once the
       rebuild had ended (midnightPendingSends.ts): they never went through.
       Newest two first, the rest behind "Show N more"; each with Send again
       (fills Send in, never sends) and Dismiss. Renders nothing otherwise. -->
  <section v-if="sends.length" ref="card" class="not-included" data-test="midnight-not-included">
    <div class="not-included__head">
      <v-icon size="20" color="warning" class="not-included__icon" aria-hidden="true">mdi-alert-circle-outline</v-icon>
      <!-- The text alone is announced, not the list and its buttons. Focus lands
           here when the last send is dismissed. -->
      <p class="not-included__text t-body-sm" role="status" tabindex="-1" data-test="midnight-not-included-text">{{ sentence }}</p>
    </div>
    <ul class="not-included__list">
      <li v-for="tx in visible" :key="midnightTxRowKey(tx)" class="not-included__item" data-test="midnight-not-included-item">
        <div class="not-included__send glass-tier">
          <div class="not-included__line">
            <span class="not-included__amount t-body-sm g-num">{{ amountLabel(tx) }}</span>
            <span class="t-caption">{{ ageLabel(tx) }}</span>
          </div>
          <span v-if="tx.counterparty" class="not-included__to g-mono">{{ t('midnight.pending.toAddress', { address: shortAddress(tx.counterparty) }) }}</span>
        </div>
        <div class="not-included__actions">
          <!-- The side panel's Send takes unshielded addresses only. -->
          <GButton
            v-if="!(layout === 'panel' && tx.isShielded)"
            tier="secondary"
            compact
            data-test="midnight-send-again"
            @click="sendAgain(tx, () => emit('send-again'))"
          >
            {{ t('midnight.pending.sendAgain') }}
          </GButton>
          <GButton tier="tertiary" compact data-test="midnight-dismiss-not-included" @click="onDismiss(tx)">
            {{ t('midnight.pending.dismiss') }}
          </GButton>
        </div>
      </li>
    </ul>
    <div v-if="hidden > 0 || sends.length > 1" class="not-included__more">
      <GButton v-if="hidden > 0" tier="tertiary" compact data-test="midnight-not-included-more" @click="expanded = true">
        {{ t('midnight.pending.showMore', { count: hidden }) }}
      </GButton>
      <GButton v-if="sends.length > 1" tier="tertiary" compact data-test="midnight-dismiss-all" @click="onDismissAll()">
        {{ t('midnight.pending.dismissAll') }}
      </GButton>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { useMidnightPendingActions, usePendingClock } from '@/shared/composables/useMidnightPendingActions';
import { midnightStore } from '@/stores/midnightStore';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { notIncludedAfterReset } from '@/chains/midnight/midnightPendingSends';
import { formatTokenAmount } from '@/chains/midnight/midnightAmount';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import type { MidnightTransaction } from '@/chains/midnight/midnightTypes';
import { midnightTokenMeta } from '@/chains/midnight/midnightTokenRegistry';
import { midnightTxRowKey } from '@/chains/midnight/midnightTxHash';
import { formatRelativeTime } from '@/shared/utils/relativeTime';

withDefaults(defineProps<{
  /** `panel`: the side panel, whose Send takes unshielded addresses only. */
  layout?: 'page' | 'panel';
}>(), { layout: 'page' });

/** Send again: the parent opens its Send screen, which takes the filled-in send. */
const emit = defineEmits<{ (e: 'send-again'): void }>();

/** Shown before "Show N more". */
const FIRST_SHOWN = 2;

const { t, tc } = useTranslation();
const now = usePendingClock();
const { sendAgain, dismiss } = useMidnightPendingActions();
const card = ref<HTMLElement | null>(null);
const expanded = ref(false);

const sends = computed(() => notIncludedAfterReset(midnightStore.transactions ?? [])
  .sort((a, b) => b.timestamp - a.timestamp));
const visible = computed(() => (expanded.value ? sends.value : sends.value.slice(0, FIRST_SHOWN)));
const hidden = computed(() => sends.value.length - visible.value.length);
/**
 * "Network upgrade" (and "No funds moved", which the lookup supports there)
 * only when the server said that was the reset's cause; otherwise wording that
 * claims neither. Singular or plural by how many sends are listed.
 */
const sentence = computed(() => {
  const n = sends.value.length;
  return sends.value.every((tx) => tx.beforeReset?.upgrade)
    ? tc('midnight.pending.notIncludedUpgrade', n)
    : tc('midnight.pending.notIncluded', n);
});

const isMainnet = computed(() => walletStore.loggedWallet?.network === Network.MAINNET);

function amountLabel(tx: MidnightTransaction): string {
  if (tx.token === 'NIGHT' || tx.token === 'DUST') {
    const ticker = isMainnet.value ? tx.token : `t${tx.token}`;
    return `${formatTokenAmount(tx.amount, MIDNIGHT_DECIMALS[tx.token], tx.token === 'DUST' ? 4 : 2)} ${ticker}`;
  }
  const meta = midnightTokenMeta(tx.token);
  return `${formatTokenAmount(tx.amount, meta?.decimals ?? null)} ${meta?.symbol ?? `${tx.token.slice(0, 8)}…`}`;
}

/** "mn_addr 9fk2 x7qa … 77cd": the prefix, then the data part's head and tail in groups of four. */
function shortAddress(address: string): string {
  const sep = address.lastIndexOf('1');
  const prefix = sep > 0 ? address.slice(0, sep) : '';
  const data = sep > 0 ? address.slice(sep + 1) : address;
  if (data.length <= 16) return `${prefix} ${data}`.trim();
  return `${prefix} ${data.slice(0, 4)} ${data.slice(4, 8)} … ${data.slice(-4)}`.trim();
}

function ageLabel(tx: MidnightTransaction): string {
  void now.value; // follow the clock
  return formatRelativeTime(tx.timestamp);
}

/** Dismiss one, then keep focus in the card: the next send's first action, or the text. */
async function onDismiss(tx: MidnightTransaction): Promise<void> {
  const index = visible.value.findIndex((row) => midnightTxRowKey(row) === midnightTxRowKey(tx));
  await dismiss(tx);
  await nextTick();
  const items: HTMLElement[] = card.value ? Array.from(card.value.querySelectorAll<HTMLElement>('[data-test="midnight-not-included-item"]')) : [];
  const next: HTMLElement | null = items[Math.min(index, items.length - 1)]?.querySelector('button') ?? null;
  (next ?? card.value?.querySelector<HTMLElement>('[data-test="midnight-not-included-text"]'))?.focus();
}

async function onDismissAll(): Promise<void> {
  for (const tx of [...sends.value]) await dismiss(tx);
}
</script>

<style scoped lang="scss">
/* A banner: the warning glyph on the muted warning pair, one tier per send. */
.not-included {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-3) var(--g-s-4);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
  border-radius: var(--g-r-card);
}

.not-included__head {
  display: flex;
  align-items: flex-start;
  gap: var(--g-s-3);
}

/* Same offset as the sibling banners in the notice slot. */
.not-included__icon {
  flex: none;
  margin-top: 2px;
}

.not-included__text {
  flex: 1;
  min-width: 0;
  max-width: 72ch;
  margin: 0;
  color: var(--g-text-1);
}

.not-included__list {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  margin: 0 0 0 calc(20px + var(--g-s-3));
  padding: 0;
  list-style: none;
}

.not-included__item {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}

.not-included__send {
  display: flex;
  flex-direction: column;
  padding: var(--g-s-2) var(--g-s-3);
  border-radius: var(--g-r-card);
}

.not-included__line {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
}

.not-included__amount {
  color: var(--g-text-1);
  font-weight: 550;
}

.not-included__to {
  overflow: hidden;
  font-size: 12px;
  line-height: 1.5;
  color: var(--g-text-2);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.not-included__actions,
.not-included__more {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}

.not-included__more {
  margin-left: calc(20px + var(--g-s-3));
}
</style>
