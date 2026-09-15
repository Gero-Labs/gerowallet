<template>
  <!-- COMPACT (side panel): one `.mfee` row — label, state, mini track,
       percent, chevron — sitting under the mini battery. -->
  <button
    v-if="compact"
    type="button"
    class="mfee"
    @click="$emit('choose')"
  >
    <span class="av" :class="{ gone: removed }">{{ incoming ? initials(incoming.sponsorName) : '·' }}</span>
    <span class="l">
      <template v-if="incoming">
        {{ t('midnight.sponsor.feesPrefix') }}
        <b :class="{ gone: removed }">{{ incoming.sponsorName }}</b>
      </template>
      <template v-else>{{ t('midnight.sponsor.feesSelfOnly') }}</template>
    </span>
    <span class="st" :class="stateTone">{{ compactState }}</span>
    <span v-if="incoming && !removed" class="tb">
      <MidnightBattery small :pct="percent" :unknown="isUnknown" />
    </span>
    <span v-if="incoming" class="fw-num" :class="{ dim: isUnknown || networkMismatch }">{{ compactCharge }}</span>
    <span class="chev"><v-icon x-small>mdi-chevron-right</v-icon></span>
  </button>

  <!-- FULL (dashboard): the inset card that lives inside the DUST battery
       widget, using the same recipe as the proof-server card so the two read
       as one family. -->
  <div v-else class="fw" :class="{ warn: tone === 'warn', err: tone === 'err' }">
    <div class="fw-row">
      <span class="t-label">{{ t('midnight.sponsor.feeWallet') }}</span>
      <span v-if="incoming && !removed" class="fw-auth">
        <v-icon x-small class="mr-1">mdi-key-outline</v-icon>{{ authLine }}
      </span>
      <span class="grow"></span>
      <v-tooltip v-if="incoming" top max-width="260" content-class="custom-tooltip">
        <template #activator="{ on, attrs }">
          <span class="fw-state on" v-bind="attrs" v-on="on">
            {{ t('midnight.sponsor.preSelected') }}
          </span>
        </template>
        <span>{{ preSelectedTip }}</span>
      </v-tooltip>
      <span v-else class="fw-state">{{ t('midnight.sponsor.off') }}</span>
      <button
        type="button"
        class="sw"
        :class="{ on: !!incoming }"
        role="switch"
        :aria-checked="!!incoming ? 'true' : 'false'"
        :aria-label="t('midnight.sponsor.feeWallet')"
        @click="onToggle"
      ><i></i></button>
    </div>

    <!-- OFF -->
    <template v-if="!incoming">
      <button type="button" class="btn-xs" @click="$emit('choose')">
        {{ t('midnight.sponsor.title') }}<v-icon x-small>mdi-chevron-right</v-icon>
      </button>
      <div v-if="!hasOwnDust" class="fw-sub">{{ t('midnight.sponsor.offNote') }}</div>
    </template>

    <!-- STOPPING — inline confirm, so one stray click never silently unpairs -->
    <template v-else-if="confirmingStop">
      <div class="fw-row">
        <span class="fw-state">{{ t('midnight.sponsor.stopConfirm', { name: incoming.sponsorName }) }}</span>
        <span class="grow"></span>
        <button type="button" class="btn-xs-out err" @click="$emit('turn-off')">
          {{ t('midnight.sponsor.stop') }}
        </button>
        <button type="button" class="btn-xs quiet" @click="confirmingStop = false">
          {{ t('midnight.sponsor.keep') }}
        </button>
      </div>
      <div class="fw-sub">{{ t('midnight.sponsor.stopNote', { name: incoming.sponsorName }) }}</div>
    </template>

    <!-- REMOVED — the sponsor wallet is gone from this extension -->
    <template v-else-if="removed">
      <div class="fw-row">
        <span class="av gone">{{ initials(incoming.sponsorName) }}</span>
        <span class="fw-name gone">{{ incoming.sponsorName }}</span>
        <span class="spill e"><i></i>{{ t('midnight.sponsor.walletRemoved') }}</span>
        <span class="grow"></span>
        <button type="button" class="btn-xs-out" @click="$emit('choose')">
          {{ t('midnight.sponsor.chooseAnother') }}
        </button>
        <button type="button" class="btn-xs quiet" @click="$emit('turn-off')">
          {{ t('midnight.sponsor.turnOff') }}
        </button>
      </div>
      <div class="fw-sub err">{{ t('midnight.sponsor.noteRemoved', { name: incoming.sponsorName }) }}</div>
    </template>

    <!-- PRE-SELECTED -->
    <template v-else>
      <div class="fw-row">
        <span class="av">{{ initials(incoming.sponsorName) }}</span>
        <span class="fw-name">{{ incoming.sponsorName }}</span>
        <span v-if="chip" class="spill" :class="chip.tone"><i></i>{{ chip.label }}</span>
        <span class="grow"></span>
        <span class="fw-batt">
          <MidnightBattery
            small
            :pct="percent"
            :unknown="isUnknown"
            :dead="networkMismatch"
            :aria-label="chargeLabel"
          />
        </span>
        <span class="fw-num" :class="{ dim: isUnknown || networkMismatch }">{{ chargeLabel }}</span>
        <button type="button" class="btn-xs" @click="$emit('choose')">
          {{ t('midnight.sponsor.change') }}
        </button>
      </div>
      <div v-if="stateNote" class="fw-sub" :class="tone">
        {{ stateNote }}
        <a v-if="isUnknown" href="#" class="fw-link" @click.prevent="$emit('check-now')">
          {{ t('midnight.sponsor.checkNow') }}
        </a>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * The "Fee wallet" strip inside the DUST battery card.
 *
 * "Pre-selected" is the on-state's name everywhere, and it promises exactly one
 * thing: the picker is skipped. The sponsor still unlocks with its own password
 * or PassKey on every send, and nothing is stored between sends — the sub-line
 * repeats that on every variant, because a switch reading "on" otherwise looks
 * like standing permission to spend another wallet's DUST.
 *
 * A configured-but-unusable pairing keeps the switch ON and says why it cannot
 * pay right now; switching it off on the user's behalf would discard a choice
 * they made. The states, each with its own chip and panel tint:
 *
 *   ready     — charge + percentage
 *   unknown   — "Not checked yet" chip, em dash, hatched track (never 0)
 *   relaying  — "Charging" chip, warn tint
 *   mismatch  — the foreign network named in a chip, err tint, battery drawn dead
 *   removed   — sponsor wallet deleted: struck name, dashed avatar, two exits
 */
import { computed, ref } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatTokenAmount } from '@/chains/midnight/midnightAmount';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import MidnightBattery from '@/modules/dashboard/components/MidnightBattery.vue';
import { chargePercent, type SponsorCandidate } from '@/chains/midnight/midnightSponsorEligibility';
import type { SponsorLink } from '@/chains/midnight/midnightSponsorLinks';

const props = withDefaults(defineProps<{
  /** One-line `.mfee` layout for the side panel. */
  compact?: boolean;
  /** The stored pairing, or null when nothing is configured. */
  incoming?: SponsorLink | null;
  /** Live state for that sponsor, or null while it is still being resolved. */
  candidate?: SponsorCandidate | null;
  /** True when the stored sponsor is not on this wallet's network. */
  networkMismatch: boolean;
  /** True when the sponsor wallet no longer exists in this extension. */
  removed?: boolean;
  /** The sponsor's network, named in the mismatch chip. */
  sponsorNetwork?: string;
  /**
   * Whether THIS wallet has DUST of its own. The off-state copy otherwise
   * claims "it has no DUST" on a wallet whose battery is visibly filling —
   * that sentence is written for the sponsored side, not the paying side.
   */
  hasOwnDust?: boolean;
  /** 'prf' renders PassKey wording, anything else renders password wording. */
  sponsorUnlock: string;
  network: string;
}>(), { compact: false, incoming: null, candidate: null, removed: false, sponsorNetwork: '', hasOwnDust: false });

const emit = defineEmits<{
  (e: 'choose'): void;
  (e: 'turn-off'): void;
  (e: 'check-now'): void;
}>();

const { t } = useTranslation();

const confirmingStop = ref(false);

const dustTicker = computed(() => (props.network === 'Mainnet' ? 'DUST' : 'tDUST'));

/** Two-letter monogram, matching the design's avatar. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const authLine = computed(() => t(
  props.sponsorUnlock === 'prf' ? 'midnight.sponsor.authPasskey' : 'midnight.sponsor.authPassword',
  { name: props.incoming?.sponsorName ?? '' },
));

const isUnknown = computed(() => (
  !props.networkMismatch && !props.removed
  && (!props.candidate || props.candidate.capacity == null)
));

const isCharging = computed(() => (
  !props.networkMismatch && !props.removed && props.candidate?.state === 'relaying'
));

const percent = computed<number | null>(() => {
  if (props.networkMismatch || props.removed) return null;
  return props.candidate ? chargePercent(props.candidate) : null;
});

const chargeLabel = computed(() => {
  const c = props.candidate;
  // An unread balance renders as an em dash, never as zero.
  if (props.removed || !c || c.capacity == null) return `— ${dustTicker.value}`;
  const amount = formatTokenAmount(c.capacity, MIDNIGHT_DECIMALS.DUST, 4);
  // On a network mismatch the real balance is still shown, only dimmed: the
  // DUST exists, it just cannot reach this network.
  if (props.networkMismatch) return `${amount} ${dustTicker.value}`;
  const pct = percent.value;
  return pct === null ? `${amount} ${dustTicker.value}` : `${amount} ${dustTicker.value} · ${pct}%`;
});

/** Status chip beside the name — the state is never carried by prose alone. */
const chip = computed<{ tone: string; label: string } | null>(() => {
  if (props.networkMismatch) {
    return { tone: 'e', label: props.sponsorNetwork || (t('midnight.sponsor.otherNetwork') as string) };
  }
  if (isUnknown.value) return { tone: 'n', label: t('midnight.sponsor.notChecked') as string };
  if (isCharging.value) return { tone: 'w', label: t('midnight.sponsor.charging') as string };
  return null;
});

/** Panel tint: the whole card carries the state, not just the sub-line. */
const tone = computed<'' | 'warn' | 'err'>(() => {
  if (props.networkMismatch || props.removed) return 'err';
  if (isCharging.value) return 'warn';
  return '';
});

const stateTone = computed(() => (tone.value === 'err' ? 'err' : (tone.value === 'warn' ? 'warn' : '')));

const compactState = computed(() => {
  if (!props.incoming) return t('midnight.sponsor.payFromAnother');
  if (props.removed) return t('midnight.sponsor.walletRemoved');
  if (props.networkMismatch) return props.sponsorNetwork || t('midnight.sponsor.otherNetwork');
  if (isUnknown.value) return t('midnight.sponsor.notChecked');
  if (isCharging.value) return t('midnight.sponsor.charging');
  return t('midnight.sponsor.preSelected');
});

const compactCharge = computed(() => {
  if (props.networkMismatch) return t('midnight.sponsor.cantPayHere') as string;
  const pct = percent.value;
  return pct === null ? '—' : `${pct}%`;
});

const stateNote = computed(() => {
  const name = props.incoming?.sponsorName ?? '';
  if (props.removed) return t('midnight.sponsor.noteRemoved', { name });
  if (props.networkMismatch) {
    return t('midnight.sponsor.noteOtherNetwork', {
      name, sponsorNetwork: props.sponsorNetwork, network: props.network,
    });
  }
  if (isUnknown.value) return t('midnight.sponsor.noteNotChecked', { name });
  if (isCharging.value) return t('midnight.sponsor.noteCharging', { name });
  // Healthy and pre-selected: row 1 already says who pays and what it asks for.
  // Repeating it underneath was the redundancy; the chip's tooltip holds the
  // nuance for anyone who wants it.
  return '';
});

const preSelectedTip = computed(() => t(
  props.sponsorUnlock === 'prf'
    ? 'midnight.sponsor.tipPreSelectedPasskey'
    : 'midnight.sponsor.tipPreSelected',
  { name: props.incoming?.sponsorName ?? '' },
));

/** On → off asks first; off → on opens the picker. */
function onToggle(): void {
  if (props.incoming) confirmingStop.value = true;
  else emit('choose');
}
</script>

<style lang="scss" scoped>
/* ── full (dashboard) ─────────────────────────────────────────────────────
   Inset card, same recipe as the proof-server widget so the two read as one
   family — not a bare divider. */
.fw {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 8px 10px;
  background: rgba(2, 6, 18, 0.35);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
}

.fw.warn { border-color: var(--g-warning-line); }
.fw.err { border-color: var(--g-error-line); }

.fw-row {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 24px;
}

.grow { flex: 1 1 auto; }

.fw-auth {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11px;
  color: var(--g-text-3);
  white-space: nowrap;
}

.fw-state {
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-2);
  white-space: nowrap;

  &.on { color: var(--g-accent); }
}

.fw-name {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-1);
  white-space: nowrap;

  &.gone {
    color: var(--g-text-3);
    text-decoration: line-through;
    text-decoration-color: var(--g-text-3);
  }
}

.fw-num {
  font-family: var(--g-font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--g-text-1);
  white-space: nowrap;
  font-variant-numeric: tabular-nums;

  &.dim {
    color: var(--g-text-3);
    font-weight: 400;
  }
}

.fw-sub {
  font-size: 11px;
  color: var(--g-text-3);
  line-height: 1.45;

  &.warn { color: var(--g-warning); }
  &.err { color: var(--g-error); }
}

.fw-link {
  color: var(--g-accent);
  text-decoration: underline;
}

.fw-batt {
  width: 150px;
  flex-shrink: 0;
}

/* ── shared vocabulary ───────────────────────────────────────────────────── */
.av {
  position: relative;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  font-size: 9px;
  border-radius: 50%;
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-1);
  font-weight: 600;
  letter-spacing: 0.02em;
  flex-shrink: 0;

  &.gone {
    border-style: dashed;
    color: var(--g-text-3);
    background: transparent;
  }
}

/* Status pill. The state is always visible as a chip, never only as prose. */
.spill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: var(--g-r-pill);
  border: 1px solid;
  white-space: nowrap;

  i {
    display: block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: currentColor;
  }

  &.n {
    color: var(--g-text-2);
    border-color: var(--g-hairline-3);
    background: var(--g-hairline-1);
  }

  &.w {
    color: var(--g-warning);
    border-color: var(--g-warning-line);
    background: var(--g-warning-fill);
  }

  &.e {
    color: var(--g-error);
    border-color: var(--g-error-line);
    background: var(--g-error-fill);
  }
}

.btn-xs {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  height: 22px;
  padding: 0 6px;
  border: 0;
  background: transparent;
  color: var(--g-accent);
  font-size: 11px;
  font-weight: 600;
  border-radius: var(--g-r-control);
  white-space: nowrap;

  &.quiet { color: var(--g-text-2); }
}

.btn-xs-out {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  border: 1px solid var(--g-accent);
  background: transparent;
  color: var(--g-accent);
  font-size: 11px;
  font-weight: 600;
  border-radius: var(--g-r-control);
  white-space: nowrap;

  &.err {
    border-color: var(--g-error);
    color: var(--g-error);
  }
}

.sw {
  position: relative;
  display: block;
  width: 44px;
  height: 24px;
  padding: 0;
  border: 0;
  border-radius: var(--g-r-pill);
  background: rgba(255, 255, 255, 0.2);
  flex-shrink: 0;

  i {
    position: absolute;
    top: 3px;
    left: 3px;
    display: block;
    width: 18px;
    height: 18px;
    border-radius: 50%;
    background: var(--g-text-2);
    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.45);
    transition: left var(--g-dur-fast) ease, background-color var(--g-dur-fast) ease;
  }

  &.on { background: rgba(167, 139, 250, 0.32); }

  &.on i {
    left: 23px;
    background: var(--g-accent);
  }
}

/* ── compact (side panel) ────────────────────────────────────────────────── */
.mfee {
  display: flex;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding-top: 7px;
  border-top: 1px solid var(--g-hairline-1);
  min-height: 26px;
  text-align: left;
  background: none;

  .l {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    min-width: 0;
    font-size: 11px;
    color: var(--g-text-2);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;

    b {
      font-weight: 600;
      color: var(--g-text-1);

      &.gone {
        color: var(--g-text-3);
        text-decoration: line-through;
      }
    }
  }

  .st {
    font-size: 10px;
    font-weight: 600;
    color: var(--g-accent);
    white-space: nowrap;

    &.warn { color: var(--g-warning); }
    &.err { color: var(--g-error); }
  }

  /* Mini track: the real battery, narrowed. */
  .tb {
    display: block;
    width: 44px;
    flex-shrink: 0;
  }

  .chev {
    display: flex;
    margin-left: auto;
    color: var(--g-text-3);
  }
}

@media (prefers-reduced-motion: reduce) {
  .sw i { transition: none; }
}
</style>
