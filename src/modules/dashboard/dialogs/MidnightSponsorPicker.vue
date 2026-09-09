<template>
  <div class="sponsor-picker">
    <div class="sponsor-picker__head">
      <v-icon x-small color="var(--g-accent)" class="mr-1">mdi-lightning-bolt-outline</v-icon>
      <span class="t-label">{{ t('midnight.sponsor.title') }}</span>
    </div>
    <p class="t-caption sponsor-picker__lede">{{ t('midnight.sponsor.lede') }}</p>

    <div v-if="loading" class="sponsor-picker__state t-caption">
      {{ t('midnight.sponsor.checking') }}
    </div>

    <div v-else-if="candidates.length === 0" class="sponsor-picker__state t-caption">
      {{ t('midnight.sponsor.noneFound') }}
    </div>

    <template v-else>
      <button
        v-for="candidate in candidates"
        :key="candidate.walletId"
        type="button"
        class="sponsor-row"
        :class="{ 'sponsor-row--active': value === candidate.walletId }"
        :disabled="candidate.state !== 'ready'"
        @click="select(candidate)"
      >
        <span class="av">{{ initials(candidate.name) }}</span>
        <span class="sponsor-row__id">
          <span class="sponsor-row__name">{{ candidate.name }}</span>
          <span class="sponsor-row__net">{{ network }}</span>
        </span>
        <span class="grow"></span>
        <span class="sponsor-row__meta">
          <template v-if="candidate.state === 'ready'">
            <span class="sponsor-row__num g-num">
              {{ formatCapacity(candidate.capacity) }} {{ dustCurrency }}
            </span>
            <!-- Charge bar: a bare number gives no sense of headroom. -->
            <span class="wdust-t">
              <i :style="{ width: (pctOf(candidate) ?? 0) + '%' }"></i>
            </span>
          </template>
          <span v-else class="sponsor-row__unknown">
            {{ candidate.state === 'relaying'
              ? t('midnight.sponsor.relaying')
              : t('midnight.sponsor.notChecked') }}
          </span>
        </span>
        <!-- Which credential this wallet will ask for, up front. -->
        <v-icon x-small class="sponsor-row__auth">
          {{ unlockOf(candidate.walletId) === 'prf' ? 'mdi-fingerprint' : 'mdi-key-outline' }}
        </v-icon>
        <!-- Explicit selection control: a border change alone reads as nothing
             having happened. -->
        <span class="radio" :class="{ on: value === candidate.walletId }"><i></i></span>
      </button>

      <p v-if="lookupIncomplete" class="t-caption sponsor-picker__note">
        {{ t('midnight.sponsor.lookupIncomplete') }}
      </p>

    </template>
  </div>
</template>

<script setup lang="ts">
/**
 * Choose another wallet to pay this send's DUST fee.
 *
 * Eligibility is NOT a balance reading. It comes from
 * `midnightSponsorEligibility`, which matches live cNIGHT registrations to the
 * dust address a wallet stores — because the dashboard's DUST battery can show
 * a figure belonging to a previously-viewed wallet, and did exactly that on
 * mainnet while the only usable sponsor looked empty.
 *
 * Three states, deliberately distinct:
 *  - ready       selectable, shows real capacity
 *  - relaying    a registration exists but the Midnight indexer hasn't relayed
 *                it yet (~2.5h) — not selectable, but NOT "no DUST"
 *  - not checked no row mentioned this wallet; absence of evidence only
 */
import { computed, onMounted, ref, watch } from 'vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { formatTokenAmount } from '@/chains/midnight/midnightAmount';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { loadSponsorCandidates } from '@/chains/midnight/midnightSponsorLookup';
import { geroStore } from '@/stores/geroStore';
import { chargePercent, type SponsorCandidate } from '@/chains/midnight/midnightSponsorEligibility';

// Optional with an explicit default: a required `number | null` type-only prop
// compiles to a runtime type array containing `null`, which Vue cannot use as a
// constructor (it warns on every render). Same shape as TxDetailSheet.
const props = withDefaults(defineProps<{
  /** Currently selected sponsor wallet id, or null. */
  value?: number | null;
  senderWalletId: number;
  network: string;
}>(), { value: null });

const emit = defineEmits<{
  (e: 'input', walletId: number | null): void;
}>();

const { t } = useTranslation();

const loading = ref(false);
const candidates = ref<SponsorCandidate[]>([]);
const lookupIncomplete = ref(false);

const dustCurrency = computed(() => (props.network === 'Mainnet' ? 'DUST' : 'tDUST'));

function formatCapacity(capacity: bigint | null): string {
  // null is "unknown", and never reaches here — a ready candidate with an
  // unparseable capacity shows a dash rather than a confident zero.
  if (capacity == null) return '—';
  return formatTokenAmount(capacity, MIDNIGHT_DECIMALS.DUST, 4);
}

function initials(name: string): string {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '??';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

/** Charge as a percentage, or null when the cap is unknown. */
function pctOf(candidate: SponsorCandidate): number | null {
  return chargePercent(candidate);
}

/** How this wallet unlocks, so the row can show the right glyph. */
function unlockOf(walletId: number): string {
  return geroStore.wallets?.[walletId]?.encryptionMethod ?? 'password';
}

function select(candidate: SponsorCandidate): void {
  if (candidate.state !== 'ready') return;
  emit('input', props.value === candidate.walletId ? null : candidate.walletId);
}

async function refresh(): Promise<void> {
  loading.value = true;
  try {
    const result = await loadSponsorCandidates(props.senderWalletId, props.network);
    candidates.value = result.candidates;
    lookupIncomplete.value = result.lookupIncomplete;
    // Drop a selection that is no longer payable, so a stale pick can't be
    // carried into the send.
    const chosen = result.candidates.find((c) => c.walletId === props.value);
    if (props.value != null && (!chosen || chosen.state !== 'ready')) emit('input', null);
  } finally {
    loading.value = false;
  }
}

onMounted(refresh);
// Scalar key: a getter returning a new array would re-fire every tick and
// turn this into a polling loop against Nexus.
watch(() => `${props.senderWalletId}|${props.network}`, refresh);
</script>

<style lang="scss" scoped>
.sponsor-picker {
  margin-top: var(--g-s-3);
  padding: var(--g-s-3);
  background: var(--g-raised);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-card);
}

.sponsor-picker__head {
  display: flex;
  align-items: center;
  color: var(--g-text-1);
}

.sponsor-picker__lede {
  margin: var(--g-s-1) 0 var(--g-s-2);
  color: var(--g-text-3);
}

.sponsor-picker__state {
  padding: var(--g-s-2) 0;
  color: var(--g-text-3);
}

.sponsor-picker__note {
  margin: var(--g-s-2) 0 0;
  color: var(--g-text-3);
}

.sponsor-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  width: 100%;
  padding: var(--g-s-2);
  background: var(--g-surface);
  border: 1px solid var(--g-hairline-1);
  border-radius: var(--g-r-control);
  color: var(--g-text-1);
  text-align: left;
  transition: border-color var(--g-dur-fast) ease, background-color var(--g-dur-fast) ease;

  & + & {
    margin-top: var(--g-s-1);
  }

  &:hover:not(:disabled) {
    border-color: var(--g-hairline-3);
  }

  &:disabled {
    color: var(--g-text-3);
    cursor: not-allowed;
  }
}

.sponsor-row--active {
  border-color: var(--g-accent);
  background: var(--g-overlay);
}

.sponsor-row__unknown {
  color: var(--g-text-3);
}

.grow { flex: 1 1 auto; }

.av {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 26px;
  border-radius: 50%;
  background: var(--g-overlay);
  border: 1px solid var(--g-hairline-2);
  color: var(--g-text-1);
  font-size: 9px;
  font-weight: 600;
  flex-shrink: 0;
}

.sponsor-row__id {
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.sponsor-row__name {
  font-size: 13px;
  font-weight: 600;
  color: var(--g-text-1);
}

.sponsor-row__net,
.sponsor-row__unknown {
  font-size: 11px;
  color: var(--g-text-3);
}

.sponsor-row__meta {
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.sponsor-row__num {
  font-size: 12px;
  color: var(--g-text-1);
}

.wdust-t {
  display: block;
  width: 56px;
  height: 4px;
  border-radius: var(--g-r-chip);
  background: var(--g-hairline-2);
  overflow: hidden;
}

.wdust-t i {
  display: block;
  height: 100%;
  border-radius: var(--g-r-chip);
  background: var(--g-accent);
}

.sponsor-row__auth {
  color: var(--g-text-3) !important;
}

.radio {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  border: 1.5px solid var(--g-hairline-3);
  flex-shrink: 0;
}

.radio.on {
  border-color: var(--g-accent);
}

.radio.on i {
  display: block;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: var(--g-accent);
}
</style>
