<template>
  <div class="verify-together" :data-test="`verify-together-${role}`">
    <template v-if="phase === 'reading'">
      <p class="t-body-sm gvc-muted">{{ $t('gerovault.invite.verify.howTo', { name: peerName }) }}</p>
      <GNote icon="mdi-alert-outline" role="status">{{ $t('gerovault.invite.verify.notRecoveryWords') }}</GNote>

      <section class="verify-together__part" :aria-labelledby="ids.mine">
        <h3 :id="ids.mine" class="t-label">{{ $t('gerovault.invite.verify.youRead') }}</h3>
        <ol class="verify-together__groups">
          <li v-for="g in mine" :key="g.n" class="verify-together__group">
            <span class="t-caption gvc-faint">{{ g.n }}</span>
            <span class="t-heading g-mono" :aria-label="$t('gerovault.invite.verify.groupLabel', { n: g.n, digits: g.spoken })">{{ g.digits }}</span>
          </li>
        </ol>
      </section>

      <section class="verify-together__part" :aria-labelledby="ids.theirs">
        <h3 :id="ids.theirs" class="t-label">{{ $t('gerovault.invite.verify.theyRead', { name: peerName }) }}</h3>
        <ol class="verify-together__groups">
          <li v-for="g in theirs" :key="g.n">
            <button
              type="button"
              class="verify-together__tick"
              :class="{ 'verify-together__tick--on': ticked[g.i] }"
              :aria-pressed="ticked[g.i] ? 'true' : 'false'"
              :aria-label="$t('gerovault.invite.verify.tickLabel', { n: g.n, digits: g.spoken })"
              :data-test="`verify-tick-${g.n}`"
              @click="toggle(g.i)"
            >
              <span class="t-caption gvc-faint">{{ g.n }}</span>
              <span class="t-heading g-mono">{{ g.digits }}</span>
              <span class="t-caption verify-together__mark">
                <v-icon v-if="ticked[g.i]" size="12" aria-hidden="true">mdi-check</v-icon>
                {{ ticked[g.i] ? $t('gerovault.invite.verify.matches') : $t('gerovault.invite.verify.tapIfMatches') }}
              </span>
            </button>
          </li>
        </ol>
        <p class="t-caption gvc-faint" role="status">{{ $t('gerovault.invite.verify.progress', { count: tickedCount }) }}</p>
      </section>

      <div class="verify-together__actions">
        <GButton tier="tertiary" data-test="verify-mismatch" @click="stop()">{{ $t('gerovault.invite.verify.doesNotMatch') }}</GButton>
        <GButton tier="primary" :disabled="tickedCount !== 4 || busy" :loading="busy" data-test="create-number-yes" @click="confirm()">
          {{ $t('gerovault.invite.verify.confirm', { name: peerName }) }}
        </GButton>
      </div>
    </template>

    <template v-else>
      <GNote tone="error" icon="mdi-hand-back-left-outline" role="alert" data-test="verify-stop">
        <strong>{{ $t('gerovault.invite.verify.stopTitle') }}</strong>
        {{ $t('gerovault.invite.verify.stopText', { name: peerName }) }}
      </GNote>
      <div class="verify-together__actions">
        <GButton tier="secondary" data-test="verify-again" @click="reset()">{{ $t('gerovault.invite.verify.readAgain') }}</GButton>
        <GButton v-if="canCancel" tier="tertiary" data-test="verify-cancel-setup" @click="emit('cancelSetup')">{{ $t('gerovault.invite.verify.cancelSetup') }}</GButton>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed, reactive, ref, useId } from 'vue';
import GButton from '@/shared/components/GButton/GButton.vue';
import GNote from '@/shared/components/GNote.vue';
import { displayLabel } from '@/shared/gerovault';

/**
 * The 40-digit verification number read in turns (GV-61, issue 1729; UX rule 8): the initiator reads
 * groups 1 to 4 and the cosigner reads 5 to 8, and each side ticks the four groups it hears. Neither
 * can confirm by just saying "yes": Confirm opens only once all four are ticked. "Doesn't match"
 * stops the setup: the two screens are not showing the same vault.
 */
const props = withDefaults(defineProps<{
  /** The eight groups of five digits, the same on both screens. */
  groups: readonly string[];
  /** `initiator` reads 1 to 4; `cosigner` reads 5 to 8. */
  role: 'initiator' | 'cosigner';
  /** The other person's label, as they set it (shown isolated). */
  peer: string;
  busy?: boolean;
  /** Offer "Cancel setup" in the stop state (the initiator only). */
  canCancel?: boolean;
}>(), { busy: false, canCancel: false });

const emit = defineEmits<{ (e: 'confirm'): void; (e: 'cancelSetup'): void; (e: 'mismatch'): void }>();

const peerName = computed(() => displayLabel(props.peer));
const spoken = (digits: string) => digits.split('').join(' ');
const all = computed(() => props.groups.map((digits, i) => ({ n: i + 1, i: i % 4, digits, spoken: spoken(digits) })));
const mine = computed(() => (props.role === 'initiator' ? all.value.slice(0, 4) : all.value.slice(4)));
const theirs = computed(() => (props.role === 'initiator' ? all.value.slice(4) : all.value.slice(0, 4)));

const ticked = ref<boolean[]>([false, false, false, false]);
const tickedCount = computed(() => ticked.value.filter(Boolean).length);
const phase = ref<'reading' | 'stop'>('reading');

function toggle(i: number): void {
  const next = ticked.value.slice();
  next[i] = !next[i];
  ticked.value = next;
}

function reset(): void {
  ticked.value = [false, false, false, false];
  phase.value = 'reading';
}

function stop(): void {
  phase.value = 'stop';
  emit('mismatch');
}

function confirm(): void {
  if (tickedCount.value === 4) emit('confirm');
}

defineExpose({ reset });

const base = useId();
const ids = reactive({ mine: `${base}-mine`, theirs: `${base}-theirs` });
</script>

<style scoped>
.verify-together {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-3);
}
.verify-together__part {
  display: flex;
  flex-direction: column;
  gap: var(--g-s-2);
}
.verify-together__part h3 {
  margin: 0;
}
.verify-together__groups {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: var(--g-s-2);
  margin: 0;
  padding: 0;
  list-style: none;
}
.verify-together__group,
.verify-together__tick {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--g-s-1);
  padding: var(--g-s-3) var(--g-s-2);
  border: 1px solid var(--g-hairline-2);
  border-radius: var(--g-r-control);
  color: var(--g-text-1);
}
.verify-together__tick {
  width: 100%;
  background: var(--g-raised); /* a control: solid, as inputs are */
  cursor: pointer;
  transition: border-color var(--g-dur-fast), background-color var(--g-dur-fast);
}
.verify-together__tick--on {
  border-color: var(--g-success-line);
  background: var(--g-success-fill);
}
.verify-together__mark {
  display: inline-flex;
  align-items: center;
  gap: var(--g-s-1);
  color: var(--g-text-3);
}
.verify-together__tick--on .verify-together__mark {
  color: var(--g-success);
}
.verify-together__actions {
  display: flex;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: var(--g-s-2);
}
@media (max-width: 520px) {
  .verify-together__groups {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
