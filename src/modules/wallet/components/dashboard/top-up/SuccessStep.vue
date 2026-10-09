<template>
  <div class="topup-done">
    <div class="topup-done__status" role="status" aria-live="polite">
      <template v-if="credited">
        <v-icon small class="topup-done__ok">mdi-check-circle-outline</v-icon>
        <span class="t-body">{{ t('card.topUpCredited') }}</span>
      </template>
      <template v-else-if="watching">
        <v-progress-circular indeterminate size="16" width="2" color="primary" />
        <span class="t-body">{{ t('card.waitingForBalance') }}</span>
      </template>
      <template v-else>
        <v-icon small>mdi-clock-outline</v-icon>
        <span class="t-body">{{ t('card.topUpSubmittedDesc') }}</span>
      </template>
    </div>

    <div class="topup-done__tx">
      <span class="t-label">{{ t('card.transactionId') }}</span>
      <span class="topup-done__tx-row">
        <span class="g-mono" :title="transactionId">{{ shortId }}</span>
        <CopyButton x-small :value="transactionId" />
      </span>
      <a :href="explorerUrl" target="_blank" rel="noopener noreferrer" class="topup-done__link">
        {{ t('market.viewOnExplorer') }}
        <v-icon x-small>mdi-open-in-new</v-icon>
      </a>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { Blockchain } from '@/models/types';
import { useExplorer } from '@/shared/composables/useExplorer';
import CopyButton from '@/shared/components/CopyButton.vue';

const props = defineProps<{
  transactionId: string;
  /** The card balance went up after this top-up. */
  credited: boolean;
  /** Still checking the balance. */
  watching: boolean;
}>();

const { t } = useTranslation();

const shortId = computed(() =>
  props.transactionId.length > 20 ? `${props.transactionId.slice(0, 10)}…${props.transactionId.slice(-8)}` : props.transactionId,
);
const { explorerUrl: explorerLink } = useExplorer();
const explorerUrl = computed(() => explorerLink('tx', props.transactionId, { chain: Blockchain.CARDANO }));
</script>

<style lang="scss" scoped>
.topup-done {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-4);
}

.topup-done__status {
  display: flex;
  align-items: center;
  gap: var(--g-s-2);
}

.topup-done__ok {
  color: var(--g-success);
}

.topup-done__tx {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: var(--g-s-2);
}

.topup-done__tx-row {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);

  .g-mono {
    word-break: normal;
  }
}

.topup-done__link {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  color: var(--g-accent);
  font-size: 13px;
}
</style>
