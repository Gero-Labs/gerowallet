<template>
  <section class="glass-panel approval-sheet" :aria-label="$t('gerovault.spend.sheet.title')" data-test="approval-sheet">
    <h2 class="t-heading approval-sheet__title">{{ $t('gerovault.spend.sheet.title') }}</h2>

    <template v-if="review.status === 'refused'">
      <GNote tone="error" icon="mdi-alert-outline" role="alert" data-test="sheet-refused">
        <p class="approval-sheet__note-lead">{{ $t('gerovault.spend.sheet.refused') }}</p>
        <ul class="approval-sheet__reasons">
          <li v-for="(refusal, i) in review.refusals" :key="i">
            {{ $t(refusalKey(refusal.code), { code: refusal.code }) }}
            <span v-if="details" class="g-mono approval-sheet__path">{{ refusal.path }}{{ refusal.detail ? ` ${refusal.detail}` : '' }}</span>
          </li>
        </ul>
      </GNote>
    </template>

    <template v-else>
      <div class="approval-sheet__proven t-caption" role="status" data-test="sheet-proven">
        <v-icon size="14" aria-hidden="true">mdi-check</v-icon>
        <span>{{ $t('gerovault.spend.sheet.proven', { count: review.inputCount }) }}</span>
      </div>

      <!-- A stake or DUST operation: what it does, by name; it pays nothing out of the vault. -->
      <OperationSheetRows
        v-if="review.operation"
        :operation="review.operation"
        :fee="review.fee"
        :own-collateral-key-hash="ownCollateralKeyHash"
        :collateral-provider="collateralProvider"
        :details="details"
      />

      <dl class="approval-sheet__rows">
        <div v-if="!review.operation" class="approval-sheet__row approval-sheet__row--lead">
          <dt class="t-body">{{ $t('gerovault.spend.sheet.leaves') }}</dt>
          <dd><VaultValue :value="review.leaves" emphasis negative :details="details" align-end /></dd>
        </div>

        <div v-for="output in outgoing" :key="output.index" class="approval-sheet__row approval-sheet__row--stack" data-test="sheet-output">
          <dt class="t-body">
            {{ output.kind === 'other_vault'
              ? $t('gerovault.spend.sheet.toVault', { name: vaultName(output) })
              : output.kind === 'vault_script_other_stake'
                ? $t('gerovault.spend.sheet.toVaultScriptOtherStake')
                : $t('gerovault.spend.sheet.to') }}
          </dt>
          <dd class="approval-sheet__destination">
            <ChunkedAddress :address="output.address" />
            <VaultValue :value="output.value" :details="details" align-end />
            <GNote v-for="warning in warningsFor(output.index)" :key="warning.code" icon="mdi-alert-outline">
              {{ $t(warningKey(warning.code)) }}
            </GNote>
          </dd>
        </div>

        <div class="approval-sheet__row">
          <dt class="t-body">{{ $t('gerovault.spend.sheet.fee') }}</dt>
          <dd class="t-body g-num approval-sheet__value">{{ $t('gerovault.spend.ada', { amount: adaText(review.fee) }) }}</dd>
        </div>

        <div class="approval-sheet__row">
          <dt class="t-body">{{ $t('gerovault.spend.sheet.change') }}</dt>
          <dd>
            <VaultValue v-if="hasChange" :value="review.change" :details="details" align-end />
            <span v-else class="t-body approval-sheet__value">{{ $t('common.none') }}</span>
          </dd>
        </div>

        <div v-if="review.invalidBefore !== null" class="approval-sheet__row" data-test="sheet-valid-from">
          <dt class="t-body">{{ $t('gerovault.spend.sheet.validFrom') }}</dt>
          <dd class="t-body approval-sheet__value">
            {{ slotText(review.invalidBefore) }}
            <span v-if="details" class="g-mono t-caption approval-sheet__detail">{{ $t('gerovault.spend.sheet.slot', { slot: review.invalidBefore }) }}</span>
          </dd>
        </div>

        <div class="approval-sheet__row">
          <dt class="t-body">{{ $t('gerovault.spend.sheet.expires') }}</dt>
          <dd class="t-body approval-sheet__value">
            {{ expiresText }}
            <span v-if="details" class="g-mono t-caption approval-sheet__detail">{{ $t('gerovault.spend.sheet.slot', { slot: review.invalidHereafter }) }}</span>
          </dd>
        </div>
      </dl>

      <GNote v-for="warning in generalWarnings" :key="warning.code" icon="mdi-alert-outline" data-test="sheet-warning">
        {{ $t(warningKey(warning.code)) }}
      </GNote>
    </template>

    <!-- Technical layer: what the signature commits to. -->
    <dl v-if="details" class="approval-sheet__technical t-caption" data-test="sheet-details">
      <div v-if="txId">
        <dt>{{ $t('gerovault.spend.sheet.txId') }}</dt>
        <dd class="g-mono">{{ txId }}</dd>
      </div>
      <div v-if="review.status === 'ready'">
        <dt>{{ $t('gerovault.spend.sheet.inputs') }}</dt>
        <dd v-for="input in review.summary.inputs" :key="`${input.txId}#${input.index}`" class="g-mono">{{ input.txId }}#{{ input.index }}</dd>
      </div>
      <div>
        <dt>{{ $t('gerovault.spend.sheet.script') }}</dt>
        <dd class="g-mono">{{ paymentScriptHash }}</dd>
      </div>
    </dl>
  </section>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import GNote from '@/shared/components/GNote.vue';
import { displayLabel, type VaultNetwork } from '@/shared/gerovault';
import type { ReviewOutput, SpendReview, SpendWarning } from '../review';
import { adaText, refusalKey, slotTimeMs, warningKey } from '../display';
import OperationSheetRows from '@/modules/gerovault/dust/components/OperationSheetRows.vue';
import ChunkedAddress from './ChunkedAddress.vue';
import VaultValue from './VaultValue.vue';

const props = withDefaults(defineProps<{
  review: SpendReview;
  network: VaultNetwork;
  paymentScriptHash: string;
  /** The Details layer is on. */
  details?: boolean;
  /** This wallet's own first address key hash: a DUST operation's collateral from it is this wallet's own. */
  ownCollateralKeyHash?: string | null;
  /** The owner whose wallet gives a DUST operation's collateral, when a signature file has shown it. */
  collateralProvider?: string | null;
}>(), { details: false, ownCollateralKeyHash: null, collateralProvider: null });

const txId = computed(() => props.review.txId);
const outgoing = computed<ReviewOutput[]>(() => (props.review.status === 'ready' && !props.review.operation ? props.review.outputs.filter(o => o.kind !== 'change') : []));
const hasChange = computed(() => props.review.status === 'ready' && (props.review.change.lovelace > 0n || props.review.change.tokens.length > 0));
const warnings = computed<readonly SpendWarning[]>(() => (props.review.status === 'ready' ? props.review.warnings : []));
const generalWarnings = computed(() => warnings.value.filter(w => w.output === undefined));
const warningsFor = (index: number) => warnings.value.filter(w => w.output === index);
const vaultName = (output: ReviewOutput) => (output.vault?.name !== undefined ? displayLabel(output.vault.name) : output.vault?.vaultId.slice(0, 8) ?? '');

const slotText = (slot: number): string => {
  const ms = slotTimeMs(props.network, slot);
  return ms === undefined ? String(slot) : new Date(ms).toLocaleString();
};
const expiresText = computed(() => (props.review.status === 'ready' ? slotText(props.review.invalidHereafter) : ''));
</script>

<style scoped>
.approval-sheet {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}
.approval-sheet__title {
  margin: 0;
}
.approval-sheet__note-lead {
  margin: 0 0 var(--g-s-1);
}
.approval-sheet__reasons {
  margin: 0;
  padding-left: var(--g-s-4);
}
.approval-sheet__path {
  display: block;
  overflow-wrap: anywhere;
}
.approval-sheet__proven {
  display: flex;
  align-items: center;
  gap: var(--g-s-1);
  padding: var(--g-s-2) var(--g-s-3);
  color: var(--g-success);
  background: var(--g-success-fill);
  border: 1px solid var(--g-success-line);
  border-radius: var(--g-r-control);
}
.approval-sheet__rows {
  display: flex;
  flex-direction: column;
  margin: 0;
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
}
.approval-sheet__row {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: var(--g-s-4);
  padding: var(--g-s-3) var(--g-s-4);
}
.approval-sheet__row + .approval-sheet__row {
  border-top: 1px solid var(--g-hairline-1);
}
.approval-sheet__row--lead {
  align-items: center;
}
.approval-sheet__row--stack {
  flex-direction: column;
  align-items: stretch;
  gap: var(--g-s-2);
}
.approval-sheet__row dt {
  flex: none;
}
.approval-sheet__row dd {
  margin: 0;
  min-width: 0;
}
.approval-sheet__destination {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.approval-sheet__value {
  color: var(--g-text-1);
  text-align: right;
}
.approval-sheet__detail {
  display: block;
}
.approval-sheet__technical {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  margin: 0;
}
.approval-sheet__technical dd {
  margin: 0;
  overflow-wrap: anywhere;
  color: var(--g-text-2);
}
</style>
