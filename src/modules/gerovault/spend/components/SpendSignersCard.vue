<template>
  <section class="glass-panel signers-card" :aria-labelledby="headingId" data-test="signers-card">
    <header class="signers-card__header">
      <h2 :id="headingId" class="t-label signers-card__title">{{ $t('gerovault.spend.signers.title') }}</h2>
      <span class="t-body-sm g-num signers-card__count" data-test="signers-progress">
        {{ $t('gerovault.spend.signers.progress', { collected: progress.collected, threshold: progress.threshold }) }}
      </span>
    </header>
    <v-progress-linear
      :model-value="Math.min(progress.collected, progress.threshold)"
      :max="progress.threshold"
      color="primary"
      bg-color="surface"
      rounded
      height="4"
      :aria-label="$t('gerovault.spend.signers.progress', { collected: progress.collected, threshold: progress.threshold })"
    />
    <ul class="signers-card__list">
      <li v-for="(owner, i) in progress.owners" :key="owner.participant.credential" class="signers-card__row" data-test="signer-row">
        <span class="t-body signers-card__name">
          {{ owner.participant.self
            ? $t('gerovault.spend.signers.you', { name: name(owner.participant, i) })
            : name(owner.participant, i) }}
        </span>
        <span v-if="details" class="g-mono t-caption signers-card__key">{{ owner.participant.credential }}</span>
        <span
          class="t-caption signers-card__status"
          :class="owner.signed ? 'signers-card__status--signed' : owner.participant.self ? 'signers-card__status--turn' : ''"
        >
          {{ owner.signed
            ? $t('gerovault.spend.signers.signed')
            : owner.participant.self
              ? $t('gerovault.spend.signers.yourTurn')
              : $t('gerovault.spend.signers.waiting') }}
        </span>
      </li>
      <li v-if="progress.collateralSigned !== null" class="signers-card__row" data-test="signer-collateral">
        <span class="t-body signers-card__name">{{ $t('gerovault.dust.signers.collateral') }}</span>
        <span class="t-caption signers-card__status" :class="progress.collateralSigned ? 'signers-card__status--signed' : ''">
          {{ progress.collateralSigned ? $t('gerovault.spend.signers.signed') : $t('gerovault.spend.signers.waiting') }}
        </span>
      </li>
    </ul>
  </section>
</template>

<script setup lang="ts">
import { useId } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import type { SigningProgress } from '../witnesses';
import type { VaultSpendParticipant } from '../vaultSpendContext';
import { participantName } from '../display';

withDefaults(defineProps<{
  progress: SigningProgress;
  /** The Details layer is on: show each owner's key hash. */
  details?: boolean;
}>(), { details: false });

const { t } = useTranslation();
const headingId = useId();
const name = (participant: VaultSpendParticipant, i: number) => participantName(participant, t('gerovault.spend.signers.owner', { n: i + 1 }));
</script>

<style scoped>
.signers-card {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
  padding: var(--g-s-4);
}
.signers-card__header {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: var(--g-s-3);
}
.signers-card__title {
  margin: 0;
}
.signers-card__count {
  color: var(--g-text-2);
}
.signers-card__list {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0;
  list-style: none;
}
.signers-card__row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--g-s-2) var(--g-s-3);
  padding: var(--g-s-2) 0;
}
.signers-card__row + .signers-card__row {
  border-top: 1px solid var(--g-hairline-1);
}
.signers-card__name {
  flex: 1;
  min-width: 0;
  color: var(--g-text-1);
  overflow-wrap: anywhere;
}
.signers-card__key {
  flex-basis: 100%;
  order: 3;
  overflow-wrap: anywhere;
}
.signers-card__status {
  padding: 0 var(--g-s-2);
  color: var(--g-text-2);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-pill);
}
.signers-card__status--signed {
  color: var(--g-success);
  background: var(--g-success-fill);
  border-color: var(--g-success-line);
}
.signers-card__status--turn {
  color: var(--g-warning);
  background: var(--g-warning-fill);
  border-color: var(--g-warning-line);
}
</style>
