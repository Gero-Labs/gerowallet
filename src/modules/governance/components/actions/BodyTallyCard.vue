<template>
  <div class="body-card glass-panel">
    <div class="body-card__head">
      <span class="t-heading body-card__title">{{ bodyLabel }}</span>
      <span v-if="result.met" class="body-card__verdict body-card__verdict--met t-caption">
        <v-icon x-small color="var(--g-success)" class="mr-1">mdi-check-circle-outline</v-icon>
        {{ $t('governance.thresholdMet') }}
      </span>
      <span v-else-if="canJudge" class="body-card__verdict t-caption">
        {{ $t('governance.belowThreshold') }}
      </span>
    </div>

    <TallyBar
      :yes-pct="composition.yesPct"
      :no-pct="composition.noPct"
      :threshold-pct="result.thresholdPct"
      :available="composition.available"
    />

    <div class="body-card__stats t-caption">
      <template v-if="composition.available">
        <span class="g-num">{{ $t('governance.yesPctLabel', { pct: fmt(composition.yesPct) }) }}</span>
        <span class="g-num">{{ $t('governance.noPctLabel', { pct: fmt(composition.noPct) }) }}</span>
      </template>
      <!-- An unknown threshold gets said out loud — never a marker drawn at 0. -->
      <span v-if="result.thresholdPct !== null" class="g-num">
        {{ $t('governance.thresholdPctLabel', { pct: fmt(result.thresholdPct) }) }}
      </span>
      <span v-else>{{ thresholdNote || $t('common.epochParametersNotAvailable') }}</span>
    </div>

    <div v-if="counts" class="body-card__counts t-caption g-num">
      {{ $t('governance.votesCount', { yes: counts.yes, no: counts.no, abstain: counts.abstain }) }}
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import type { PropType } from 'vue';
import type { BodyResult } from '@/shared/utils/govThresholds';
import type { Composition } from '@/shared/utils/govTally';
import { useTranslation } from '@/shared/composables/useTranslation';
import TallyBar from '@/modules/governance/components/actions/TallyBar.vue';

// Runtime declaration — an `X | null` type literal compiles to a validator
// containing null, which is not a constructor and warns on every render. See
// AsOf.vue.
const props = defineProps({
  result: { type: Object as PropType<BodyResult>, required: true },
  composition: { type: Object as PropType<Composition>, required: true },
  /** Committee member counts — the CC votes by member count, not stake. */
  counts: {
    type: Object as PropType<{ yes: number; no: number; abstain: number } | null>,
    default: null,
  },
  /** Label shown when the threshold is unknown (defaults to the epoch-params message). */
  thresholdNote: { type: String, default: undefined },
});

const { t } = useTranslation();

const bodyLabel = computed(() =>
  String(
    t(
      {
        DRep: 'governance.dReps',
        SPO: 'governance.spos',
        CC: 'governance.constitutionalCommittee',
      }[props.result.body],
    ),
  ),
);

/**
 * "Below threshold" may only be claimed when both the threshold and the tally
 * are known — unknown is never a verdict in either direction.
 */
const canJudge = computed(
  () => props.result.thresholdPct !== null && props.result.yesPct !== null && props.composition.available,
);

function fmt(pct: number | null): string {
  return pct === null ? '—' : pct.toFixed(2);
}
</script>

<style scoped>
/* Surface, border and radius come from `glass-panel` (liquid-glass.css): this
   is a top-level card on the detail page, per the ActionDetail artboard.
   `min-width: 0` because the card's home is a 300px rail: without it the
   longest unbroken run inside (a body name, a percentage) would set the card's
   width and push the whole stack past its track. */
.body-card {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
  padding: var(--g-s-4);
  min-width: 0;
}
/* Wraps rather than squeezing the verdict: a narrow rail would otherwise clip
   the words that ARE the non-colour cue. */
.body-card__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--g-s-1) var(--g-s-2);
}
/* "Constitutional Committee" is the longest of the three and the rail is the
   narrowest place it appears: it wraps onto a second line rather than
   overflowing the card. */
.body-card__title {
  min-width: 0;
  overflow-wrap: anywhere;
}
.body-card__verdict {
  display: inline-flex;
  align-items: center;
  color: var(--g-text-3);
}
.body-card__verdict--met {
  color: var(--g-success);
}
/* Three figures on one line where they fit, and a tight row gap where they
   wrap — in the rail they usually take two lines. */
.body-card__stats {
  display: flex;
  flex-wrap: wrap;
  gap: var(--g-s-1) var(--g-s-3);
  color: var(--g-text-2);
}
/* The counts close the card, under whatever the stats line wrapped to. */
.body-card__counts {
  color: var(--g-text-3);
}
</style>
