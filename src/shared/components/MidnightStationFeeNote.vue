<template>
  <!-- Gero's fee station on a send screen: the offer (with a way to decline it and
       a plain account of how it works), or why this wallet cannot use it. -->
  <div v-if="offer || reason" class="station-note t-caption" data-test="station-note">
    <template v-if="offer">
      <v-checkbox
        :model-value="useStation"
        :label="$t('midnight.station.cover')"
        density="compact"
        hide-details
        color="var(--g-accent)"
        @update:model-value="$emit('update:useStation', $event === true)"
      />
      <div class="station-note__sub">
        <span v-if="status && status.remaining > 0">{{ $t('midnight.station.remaining', { n: status.remaining }) }}</span>
        <span v-else-if="status && status.allowance">{{ $t('midnight.station.firstToday', { n: status.allowance }) }}</span>
        <button
          type="button"
          class="station-note__how"
          data-test="station-how"
          :aria-expanded="howOpen ? 'true' : 'false'"
          @click="howOpen = !howOpen"
        >{{ $t('midnight.station.how') }}</button>
      </div>
      <div v-if="howOpen" class="station-note__body" data-test="station-how-body">{{ $t('midnight.station.howBody') }}</div>
    </template>
    <div v-else-if="reason" class="station-note__reason" data-test="station-reason">{{ reason.params ? $t(reason.key, reason.params) : $t(reason.key) }}</div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import type { StationStatus } from '@/chains/midnight/midnightStationConfig';

const props = defineProps<{
  /** What the worker said (`useMidnightStationFee`). */
  status: StationStatus | null | undefined;
  /** The station pays this send unless the user turns it off. */
  useStation: boolean;
}>();
defineEmits<{ (event: 'update:useStation', value: boolean): void }>();

const howOpen = ref(false);
const offer = computed(() => props.status?.available === true);

/** Whole ADA of a lovelace amount, for a threshold (never a balance). */
function wholeAda(lovelace: string | undefined): string {
  return lovelace && /^\d+$/.test(lovelace) ? (BigInt(lovelace) / 1_000_000n).toString() : '';
}

/** Why this wallet cannot use the station, as a key the template translates. Null: say nothing. */
const reason = computed<{ key: string; params?: Record<string, unknown> } | null>(() => {
  switch (props.status?.reason) {
    case 'NOT_REGISTERED':
    case 'NOT_DELEGATED':
      return { key: 'midnight.station.reason.notStaking' };
    case 'BELOW_THRESHOLD':
      return { key: 'midnight.station.reason.belowThreshold', params: { amount: wholeAda(props.status.thresholdLovelace) } };
    case 'ALREADY_ISSUED':
      return { key: 'midnight.station.reason.usedUp' };
    default:
      return null;
  }
});
</script>

<style scoped lang="scss">
.station-note {
  margin-top: var(--g-s-2);
  color: var(--g-text-2);
  text-align: left;
}

.station-note__sub {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: var(--g-s-2);
  color: var(--g-text-3);
}

.station-note__how {
  padding: 0;
  border: 0;
  background: none;
  color: var(--g-accent);
  font: inherit;
  cursor: pointer;
  text-decoration: underline;
}

.station-note__body,
.station-note__reason {
  margin-top: var(--g-s-1);
  color: var(--g-text-2);
}
</style>
