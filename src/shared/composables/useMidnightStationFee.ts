/**
 * Gero's fee station on a Midnight send screen: whether to offer it, what to
 * say, and whether it pays this send. Shared by the options-page dialog and
 * the side-panel sheet so the two cannot disagree.
 *
 * The station is the THIRD fee source (midnightFeeSource.ts): it is considered
 * only while the wallet may lack DUST and no fee wallet is chosen.
 */
import { computed, ref, watch, type Ref } from 'vue';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { chooseMidnightFeeSource, type MidnightFeeSource } from '@/chains/midnight/midnightFeeSource';
import { isStationNetwork, type StationCode, type StationStatus } from '@/chains/midnight/midnightStationConfig';
import { getMidnightStationStatus } from '@/services/midnightStationSend.service';

export interface MidnightStationFeeInputs {
  /** The wallet may be unable to pay its own fee (`mayLackDustLive`). */
  mayLackDust: Ref<boolean>;
  /** Another of the user's wallets is chosen to pay. */
  feeWalletChosen: Ref<boolean>;
  /** The send is shielded: never station-paid in this version. */
  shielded: Ref<boolean>;
  /** The sending wallet's network. */
  network: Ref<string | undefined>;
}

/** Reasons worth telling the user: they can act on them, or wait. */
const EXPLAINED: readonly StationCode[] = ['NOT_REGISTERED', 'NOT_DELEGATED', 'BELOW_THRESHOLD', 'ALREADY_ISSUED'];

export function useMidnightStationFee(inputs: MidnightStationFeeInputs) {
  const status = ref<StationStatus | null>(null);
  /** The user asked to try with the wallet's own DUST instead. */
  const optedOut = ref(false);
  let asked = 0;

  /** The flag, the build's network list, and a send the station could pay at all. */
  const considered = computed(() => featureFlagsStore.isMidnightSponsoredFeesEnabled()
    && isStationNetwork(inputs.network.value) && inputs.mayLackDust.value && !inputs.shielded.value);

  async function refresh(): Promise<void> {
    const mine = ++asked;
    if (!considered.value) { status.value = null; return; }
    const answer = await getMidnightStationStatus();
    // A newer question was asked while this one was out: its answer is the one to keep.
    if (mine === asked) status.value = considered.value ? answer : null;
  }

  watch(considered, () => { void refresh(); }, { immediate: true });
  // Another wallet, another answer.
  watch(inputs.network, () => { optedOut.value = false; });

  /** The note is drawn: the offer, or a reason the user can do something about. */
  const shown = computed(() => {
    const current = status.value;
    if (!considered.value || inputs.feeWalletChosen.value || !current) return false;
    return current.available || (current.reason !== undefined && EXPLAINED.includes(current.reason));
  });

  const source = computed<MidnightFeeSource>(() => chooseMidnightFeeSource({
    mayLackDust: inputs.mayLackDust.value,
    feeWalletChosen: inputs.feeWalletChosen.value,
    stationAvailable: considered.value && status.value?.available === true,
    stationOptedOut: optedOut.value,
    shielded: inputs.shielded.value,
  }));

  return { status, optedOut, shown, source, refresh };
}
