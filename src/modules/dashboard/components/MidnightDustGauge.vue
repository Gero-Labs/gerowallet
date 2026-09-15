<template>
  <div class="dust-gauge glass-panel" :class="{ 'is-charging': isCharging, 'is-full': isFull }">
    <!-- Header: label + live balance -->
    <div class="dust-gauge__head">
      <div class="dust-gauge__title">
        <v-icon x-small class="mr-1" :color="isCharging || isFull ? '#ecc985' : undefined">
          {{ isCharging ? 'mdi-battery-charging-medium' : 'mdi-battery-50' }}
        </v-icon>
        {{ $t('midnight.dustBattery') }}
        <span v-if="isPending" class="dust-gauge__pending ml-3">
          <span class="dust-gauge__pending-dot"></span>
          {{ $t('midnight.dustBatteryPending') }}
        </span>
        <!-- Always reachable. `isRegistered` is derived from two independent
             signals (Path A poll, Path B mapping UTxO), and either can read
             true while the wallet still generates nothing — a Path-B mapping
             whose stake holds no cNIGHT is registered with 0 NIGHT. Hiding
             the CTA on that boolean left the user with no way to register at
             all. The label changes; the door never closes. -->
        <button v-else type="button" class="dust-gauge__cta ml-3" @click="$emit('register')">
          <v-icon x-small left>mdi-shield-star</v-icon>
          {{ isRegistered ? $t('midnight.manageDustRegistration') : $t('midnight.registerForDust') }}
        </button>
      </div>
      <div class="dust-gauge__balance">
        <v-skeleton-loader v-if="midnightLoading" type="text" width="110" />
        <template v-else>
          <span class="dust-gauge__balance-num">{{ dustCurrentFmt }}</span>
          <span class="dust-gauge__balance-unit">{{ dustCurrency }}</span>
        </template>
      </div>
    </div>

    <!-- Battery track. The battery itself is MidnightBattery, shared with the
         fee-wallet strip so the gradient/dividers/nub have one owner; the
         charge animation is slotted in over it. -->
    <MidnightBattery :pct="pct" :full="isFull">
      <!-- Two-zone charge animation: dust drifts right-to-left over the
           empty track and lands on the fill edge; power streaks flow
           through the charged section. See DustParticleCanvas. -->
      <DustParticleCanvas :active="isCharging" :fill-pct="pct" class="battery__dust" />
    </MidnightBattery>

    <!-- Footer stats -->
    <div class="dust-gauge__stats">
      <div class="dust-gauge__stat">
        <span class="k">{{ statusLabel }}</span>
        <span class="v" :class="statusClass">{{ pctLabel }}</span>
      </div>
      <div class="dust-gauge__stat">
        <span class="k">{{ $t('midnight.generationRate') }}</span>
        <span class="v">{{ isRegistered ? `+${dustRateFmt} ${dustCurrency}/s` : '—' }}</span>
      </div>
      <div class="dust-gauge__stat">
        <span class="k">{{ isFull ? $t('midnight.dustCapReached') : $t('midnight.dustTimeToFull') }}</span>
        <span class="v">{{ timeToFullLabel }}</span>
      </div>
    </div>

    <!-- Sponsorship, both directions. Lives on the battery because that is
         where a user looks to answer "can this wallet pay a fee". -->
    <MidnightSponsorStatus :revision="sponsorRevision" @choose="feeWalletOpen = true" />
    <MidnightFeeWalletDialog
      v-if="loggedWallet"
      :is-open="feeWalletOpen"
      :wallet-id="loggedWallet.id"
      :wallet-name="loggedWallet.name"
      :network="loggedWallet.network"
      @close="feeWalletOpen = false"
      @saved="onSponsorSaved"
    />

  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref, toRefs, watch } from 'vue';
import MidnightFeeWalletDialog from '@/modules/dashboard/dialogs/MidnightFeeWalletDialog.vue';
import MidnightSponsorStatus from '@/modules/dashboard/components/MidnightSponsorStatus.vue';
import MidnightBattery from '@/modules/dashboard/components/MidnightBattery.vue';
import { useTranslation } from '@/shared/composables/useTranslation';
import { midnightStore } from '@/stores/midnightStore';
import { getDustPendingForDestination, reconcileDustPendingForDestination } from '@/shared/composables/useDustPending';
import { walletStore } from '@/stores/walletStore';
import { Network } from '@/models/types';
import { MIDNIGHT_DECIMALS } from '@/chains/midnight/midnightTypes';
import { getMidnightApi } from '@/api/midnight-api';
import { useMidnightDustLive } from '@/shared/composables/useMidnightDustLive';
import { useDustPathB } from '@/shared/composables/useDustPathB';
import DustParticleCanvas from '@/shared/components/DustParticleCanvas.vue';
import { useMidnightLoading } from '@/shared/composables/useMidnightLoading';
import { debugLog } from '@/utils/debug';

defineEmits<{ (e: 'register'): void }>();

const { t } = useTranslation();
const { loggedWallet } = toRefs(walletStore);

const isMainnet = computed(() => loggedWallet.value?.network === Network.MAINNET);
const dustCurrency = computed(() => (isMainnet.value ? 'DUST' : 'tDUST'));

const DUST_DIVISOR = 10n ** BigInt(MIDNIGHT_DECIMALS.DUST);

const {
  dustBalance,
  dustGenerating,
  dustCap,
  registrationStatus,
  nightRegistered,
} = useMidnightDustLive();
const { pathBRegistered, pathBStakes, pathBIncomingStakes } = useDustPathB();

const midnightLoading = useMidnightLoading();
const isRegistered = computed(() => registrationStatus.value === 'Registered');

// Pending: a cNIGHT registration was submitted that targets this wallet's DUST
// address but hasn't relayed to Midnight yet (~2.5h), so dustState still reads
// unregistered. Surface it so the battery shows "pending" instead of a
// re-registration prompt. localStorage isn't reactive, so refresh on mount and
// whenever the live status changes — and reconcile against chain truth first
// so a stale/failed submission can't sit as "pending" for the full TTL (the
// pill used to only ever expire, never confirm one way or the other).
const incomingPending = ref(0);
// onMounted + watch(registrationStatus) reliably overlap on a Path-B wallet
// (registrationStatus flips right as the Path-B poll lands, moments after
// mount) — without this guard the two overlapping async calls
// read-map/await/write-map out of order and flicker the pill.
//
// A busy call used to just DROP the overlapping one — but the dropped call
// is precisely the one carrying fresh `pathBStakes` for the `isResolved`
// clear, and once `registrationStatus` settles there's no guarantee of a
// later fire to pick it back up, so a real pending record could survive to
// TTL. Trailing-edge re-run instead: if a call comes in while busy, queue
// exactly one follow-up re-run from the `finally`, so the freshest state
// (dust address / network / pathBStakes at that later point) always gets
// one more pass after the in-flight call finishes.
let refreshPendingBusy = false;
let refreshPendingQueued = false;
async function refreshPending() {
  if (refreshPendingBusy) { refreshPendingQueued = true; return; }
  refreshPendingBusy = true;
  try {
    const dust = midnightStore.addresses?.dust ?? '';
    if (!dust) { incomingPending.value = 0; return; }
    const network = loggedWallet.value?.network;
    if (network) {
      await reconcileDustPendingForDestination(
        dust,
        (txHash) => getMidnightApi(network).cardanoTxExists(txHash),
        (stakeAddress) => pathBStakes.value.includes(stakeAddress),
      );
    }
    // The wallet may have switched while the reconcile above was in flight —
    // re-read rather than trust the `dust` captured at entry, so a stale
    // response can never overwrite the count for a DIFFERENT wallet.
    if ((midnightStore.addresses?.dust ?? '') !== dust) return;
    incomingPending.value = getDustPendingForDestination(dust).length;
  } finally {
    refreshPendingBusy = false;
    if (refreshPendingQueued) {
      refreshPendingQueued = false;
      safeRefreshPending();
    }
  }
}
function safeRefreshPending() {
  // Neither onMounted nor watch() awaits or catches its callback's promise,
  // so an uncaught rejection here (e.g. a localStorage quota error) would
  // become an unhandled rejection.
  refreshPending().catch((e) => debugLog('[MidnightDustGauge] refreshPending failed', e));
}
onMounted(safeRefreshPending);
watch(registrationStatus, safeRefreshPending);
// Path B already reporting a live registration to this dust address is
// Registered, not pending — guard directly against it too (not just via
// `isRegistered`) so a stale local record can never outrank chain truth.
//
// `pathBIncomingStakes` is the chain-truth half of "pending": a registration
// confirmed on Cardano and pointed here, which the Midnight indexer hasn't
// relayed yet. `incomingPending` (localStorage) only ever saw registrations
// submitted from THIS browser profile, so a registration made from the Cardano
// wallet's own dialog or the official portal left the battery showing a
// "Register for DUST" prompt for the whole relay window.
const isPending = computed(() => !isRegistered.value
  && !pathBRegistered.value
  && (incomingPending.value > 0
    || pathBIncomingStakes.value.length > 0
    || registrationStatus.value === 'Pending'));

// Percent full (0-100) for the bar width + a11y.
const pct = computed(() => {
  if (dustCap.value <= 0n) return 0;
  const p = Number((dustBalance.value * 10000n) / dustCap.value) / 100;
  return Math.max(0, Math.min(100, p));
});
const isFull = computed(() => isRegistered.value && dustCap.value > 0n && pct.value >= 99.95);
const isCharging = computed(() => isRegistered.value && dustGenerating.value > 0n && !isFull.value);

function fmt(value: bigint, digits: number): string {
  const whole = value / DUST_DIVISOR;
  const frac = value % DUST_DIVISOR;
  const fracStr = frac.toString().padStart(MIDNIGHT_DECIMALS.DUST, '0').slice(0, digits);
  return digits > 0 ? `${whole.toString()}.${fracStr}` : whole.toString();
}

const dustCurrentFmt = computed(() => fmt(dustBalance.value, 4));
const dustRateFmt = computed(() => fmt(dustGenerating.value, 4));

const pctLabel = computed(() => `${pct.value.toFixed(1)}%`);
const statusLabel = computed(() => (isFull.value ? t('midnight.dustFull') : t('midnight.dustCharge')));
const statusClass = computed(() => (isFull.value ? 'v--full' : isCharging.value ? 'v--charging' : ''));

// Seconds to reach cap at the current rate → coarse human label.
const timeToFullLabel = computed(() => {
  if (isFull.value) return t('midnight.dustFullyCharged');
  // Registered but nothing to generate from: a bare dash here reads as "no
  // data" when we actually know the reason. Say it.
  if (isRegistered.value && nightRegistered.value <= 0n) return t('midnight.dustNoNight');
  if (!isRegistered.value || dustGenerating.value <= 0n) return '—';
  const remaining = dustCap.value - dustBalance.value;
  if (remaining <= 0n) return t('midnight.dustFullyCharged');
  const secs = Number(remaining / dustGenerating.value);
  if (!Number.isFinite(secs) || secs <= 0) return '—';
  const d = Math.floor(secs / 86400);
  const h = Math.floor((secs % 86400) / 3600);
  const m = Math.floor((secs % 3600) / 60);
  if (d > 0) return `~${d}d ${h}h`;
  if (h > 0) return `~${h}h ${m}m`;
  if (m > 0) return `~${m}m`;
  return `~${Math.floor(secs)}s`;
});


/** The fee-wallet picker, reachable from the strip under the battery. */
const feeWalletOpen = ref(false);
const sponsorRevision = ref(0);

/**
 * Force the strip to re-read after the dialog writes. The strip owns its own
 * load, so bumping its key is the cheapest way to make it honest immediately
 * rather than on the next wallet switch.
 */
function onSponsorSaved(): void {
  feeWalletOpen.value = false;
  // The dialog has already written the link; bump so the strip re-reads it
  // immediately instead of waiting for a wallet switch.
  sponsorRevision.value += 1;
}
</script>

<style scoped>
/* Standard wallet panel — the gradient lives on the progress bar, not here. */
.dust-gauge {
  padding: 14px 16px;
  border-radius: var(--g-r-card);
  display: flex;
  flex-direction: column;
  gap: 12px;
  /* Fill the equal-height row column so it matches the proof-server widget
     beside it (which already sets height: 100%). */
  height: 100%;
}

.dust-gauge__head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
}

.dust-gauge__title {
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--g-text-3);
  display: flex;
  align-items: center;
}

.dust-gauge__balance {
  display: flex;
  align-items: baseline;
  gap: 4px;
}

.dust-gauge__balance-num {
  font-family: var(--g-font-mono);
  font-size: 16px;
  font-weight: 600;
  color: var(--g-text-1);
  font-variant-numeric: tabular-nums;
}

.is-charging .dust-gauge__balance-num,
.is-full .dust-gauge__balance-num {
  color: #f3ddae;
  text-shadow: 0 0 14px rgba(236, 201, 133, 0.35);
}

.dust-gauge__balance-unit {
  font-size: 11px;
  color: var(--g-text-3);
}

/* Battery track */
/* The dust itself — canvas sits above fill + dividers */
.battery__dust {
  position: absolute;
  inset: 0;
  width: 100%;
  height: 100%;
  pointer-events: none;
}

.dust-gauge__stats {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  /* Pin to the card bottom so this row aligns with the proof-server widget's
     stats row when the card is stretched to equal height. */
  margin-top: auto;
}

.dust-gauge__stat {
  display: flex;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}

.dust-gauge__stat .k {
  font-size: 11px;
  color: var(--g-text-3);
  white-space: nowrap;
}

.dust-gauge__stat .v {
  font-family: var(--g-font-mono);
  font-size: 12px;
  font-weight: 500;
  color: var(--g-text-1);
  white-space: nowrap;
}

.dust-gauge__stat .v--charging { color: #ecc985; }
.dust-gauge__stat .v--full { color: #ffe9b2; }

.dust-gauge__cta {
  display: inline-flex;
  align-items: center;
  padding: 3px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--g-on-grad);
  background: linear-gradient(90deg, var(--g-grad-1), var(--g-grad-2));
  cursor: pointer;
  transition: filter 0.15s ease, transform 0.1s ease;
}

.dust-gauge__cta:hover { filter: brightness(1.08); }
.dust-gauge__cta:active { transform: translateY(1px); }

.dust-gauge__pending {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  color: var(--g-text-1);
  background: var(--g-warning-fill);
  border: 1px solid var(--g-warning-line);
}

.dust-gauge__pending-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--g-warning);
  flex-shrink: 0;
}

@media (prefers-reduced-motion: reduce) {
  .battery__fill { transition: none; }
  .battery__divider { transition: none; }
}
</style>