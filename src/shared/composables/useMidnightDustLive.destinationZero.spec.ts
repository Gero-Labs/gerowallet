import Vue, { nextTick, reactive } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A zero `dust/destination` answer is a generation status, not proof of zero spendable DUST, so the
 * send guard must warn on it and never refuse.
 *
 * The indexer reports only generation that is live NOW. DUST generated earlier keeps decaying (ledger
 * `DustOutput::updated_value`) and stays spendable after the generation row is gone. Two ways to a
 * zero answer with DUST still in hand:
 *  - a registration removed externally: Nexus answers unregistered, no active stakes, zero figures;
 *  - every backing cNIGHT moved away while the registration stays active: Nexus answers
 *    `registered:true` with an active stake and all four figures zero (the indexer reads
 *    registrations separately from generation rows, and drops rows with a set `dtime`).
 * Either way the Path-A poll is the hollow all-zero shape, so nothing else says the wallet is empty.
 *
 * Runs the REAL `useMidnightDustLive`, the REAL `useDustPathB` and the REAL guards
 * `blocksMidnightSendLive` / `mayLackDustLive`, fed the way `MidnightSendDialog` and
 * `MidnightSendSheet` feed them. Only the network and the stores are mocked. This spec does not
 * import the ledger, so the decay of the leftover output is stated in the comments, not computed.
 */
const mocks = vi.hoisted(() => ({
  destination: vi.fn(),
  accountState: vi.fn(),
  batch: vi.fn(),
  registrations: vi.fn(),
  enumerate: vi.fn(),
}));

vi.mock('@/api/midnight-api', async (importOriginal) => ({
  // Keep the real `DustDestinationUnsupportedError`: the composable branches on `instanceof`.
  ...(await importOriginal<typeof import('@/api/midnight-api')>()),
  getMidnightApi: () => ({
    getDustAccountState: mocks.accountState,
    getDustDestination: mocks.destination,
    getDustStatusBatch: mocks.batch,
    getDustRegistrations: mocks.registrations,
  }),
}));
vi.mock('@/shared/composables/useCardanoStakeEnumeration', () => ({
  enumerateCardanoStakeIdentities: mocks.enumerate,
}));
vi.mock('@/chains/midnight/midnightKeyManager', () => ({ dustAddressToHex: () => 'aabb' }));
vi.mock('@/utils/debug', () => ({ debugLog: vi.fn() }));
vi.mock('@/stores/walletStore', () => ({ walletStore: reactive({ loggedWallet: { network: 'Mainnet' } }) }));
vi.mock('@/stores/midnightStore', () => ({
  midnightStore: reactive({
    addresses: { unshielded: 'mn_addr1start', dust: 'mn_dust1start' },
    dustState: null,
    balances: {},
  }),
}));

import { midnightStore } from '@/stores/midnightStore';
import { DustDestinationUnsupportedError, type MidnightDustDestinationDto } from '@/api/midnight-api';
import { blocksMidnightSendLive, mayLackDustLive } from '@/chains/midnight/midnightFeeCapacity';
import { useMidnightDustLive, type MidnightDustLive } from './useMidnightDustLive';

/** What Nexus answers for a dust address with no live registration (e.g. one that was removed). */
const unregisteredZero = (): MidnightDustDestinationDto => ({
  dustAddress: 'mn_dust1test',
  registered: false,
  nightBalance: '0',
  generationRate: '0',
  maxCapacity: '0',
  currentCapacity: '0',
  stakes: [],
});
const registered = (currentCapacity: string): MidnightDustDestinationDto => ({
  dustAddress: 'mn_dust1test',
  registered: true,
  nightBalance: currentCapacity === '0' ? '0' : '935253826',
  generationRate: '0',
  maxCapacity: currentCapacity,
  currentCapacity,
  stakes: [
    { cardanoRewardAddress: 'stake1a', state: 'active', registrationUtxoTxHash: 'aa', registrationUtxoOutputIndex: 0 },
  ],
});
/** The hollow all-zero shape the sidecar returns for a wallet with no native NIGHT. */
const hollowPathA = () => ({
  dust_balance: '0', dust_generating: '0', dust_cap: '0', night_registered: '0',
  dust_registration_status: 'Unregistered',
});

let counter = 0;
/** Fresh identities per test: both composables key their module state on them, so this resets everything. */
function switchToNewWallet() {
  counter += 1;
  midnightStore.addresses.unshielded = `mn_addr1wallet${counter}`;
  midnightStore.addresses.dust = `mn_dust1wallet${counter}`;
}

let views: Vue[] = [];
function mount(): MidnightDustLive {
  let live!: MidnightDustLive;
  const view = new Vue({ setup() { live = useMidnightDustLive(); return {}; }, render: (h) => h('div') });
  view.$mount();
  views.push(view);
  return live;
}
async function settle() {
  await vi.advanceTimersByTimeAsync(0);
  await nextTick();
  await vi.advanceTimersByTimeAsync(0);
}
/** What both send screens feed the guards. */
const feeInputs = (live: MidnightDustLive) => ({
  dustBalance: live.dustBalance.value,
  settled: live.settled.value,
});
/** The send screens' refusal, fed exactly as `MidnightSendDialog` / `MidnightSendSheet` feed it. */
const blocked = (live: MidnightDustLive) => blocksMidnightSendLive(feeInputs(live));
/** The send screens' notice and sponsor picker. */
const mayLack = (live: MidnightDustLive) => mayLackDustLive(feeInputs(live));

beforeEach(() => {
  vi.useFakeTimers();
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.accountState.mockResolvedValue(hollowPathA());
  midnightStore.dustState = null;
  switchToNewWallet();
});
afterEach(() => {
  for (const view of views) view.$destroy();
  views = [];
  midnightStore.dustState = null;
  vi.useRealTimers();
});

describe('send guard on a zero destination answer', () => {
  it('warns but does not refuse a wallet whose destination answers unregistered/zero and whose Path-A poll is hollow', async () => {
    mocks.destination.mockResolvedValue(unregisteredZero());

    const live = mount();
    await settle();

    // Both paths have reported and the battery reads zero, but nothing verified that no DUST is spendable.
    // A token-only wallet with no registration at all must still settle, or it would never see the notice.
    expect(live.hasData.value).toBe(true);
    expect(live.dustBalance.value).toBe(0n);
    expect(live.registrationStatus.value).toBe('Unregistered');
    expect(live.settled.value).toBe(true);
    expect(blocked(live)).toBe(false);
    expect(mayLack(live)).toBe(true);
  });

  it('neither warns nor refuses while the destination has not answered yet', async () => {
    // A Path-B wallet reads zero for the length of one poll. The notice must not flash on every open.
    mocks.destination.mockReturnValue(new Promise(() => {}));

    const live = mount();
    await settle();

    expect(live.hasData.value).toBe(true); // Path A has answered, and read zero
    expect(live.dustBalance.value).toBe(0n);
    expect(live.settled.value).toBe(false);
    expect(blocked(live)).toBe(false);
    expect(mayLack(live)).toBe(false);
  });

  it('the unsupported-endpoint fallback with no enumerable stakes has not reported, so it neither warns nor refuses', async () => {
    mocks.destination.mockRejectedValue(new DustDestinationUnsupportedError(404));
    mocks.enumerate.mockResolvedValue([]);

    const live = mount();
    await settle();

    expect(mocks.enumerate).toHaveBeenCalled(); // the fallback really ran
    expect(live.settled.value).toBe(false); // nothing was asked, so Path B has not reported
    expect(blocked(live)).toBe(false);
    expect(mayLack(live)).toBe(false);
  });

  it('does not refuse once a registered wallet has its registration removed between two polls', async () => {
    mocks.destination.mockResolvedValueOnce(registered('500'));
    const live = mount();
    await settle();
    expect(live.dustBalance.value).toBe(500n);
    expect(live.settled.value).toBe(true);
    expect(blocked(live)).toBe(false);
    expect(mayLack(live)).toBe(false); // positive: nothing to warn about

    mocks.destination.mockResolvedValueOnce(unregisteredZero());
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.destination).toHaveBeenCalledTimes(2);
    expect(live.dustBalance.value).toBe(0n);
    expect(live.settled.value).toBe(true); // Path B answered again
    expect(blocked(live)).toBe(false);
    expect(mayLack(live)).toBe(true); // warn: the answer no longer shows any DUST
  });

  it('keeps showing the decaying output that remains after the registration was removed', async () => {
    // The snapshot from gero-sync still carries the output the ledger is decaying. The empty
    // destination answer must not zero it, so the wallet reads positive and is not warned about.
    midnightStore.dustState = { current: 12_345n } as never;
    mocks.destination.mockResolvedValue(unregisteredZero());

    const live = mount();
    await settle();

    expect(live.dustBalance.value).toBe(12_345n);
    expect(live.settled.value).toBe(true);
    expect(blocked(live)).toBe(false);
    expect(mayLack(live)).toBe(false);
  });

  it('does not refuse an ACTIVE registration that answers all zeros after its cNIGHT moved away', async () => {
    // The reviewer's case. A cNIGHT-only wallet generated DUST through a registration made from an
    // external Cardano wallet, and its owner then transferred away every backing cNIGHT WITHOUT
    // removing the registration (midnight-node emits the generation Destroy action and leaves the
    // mapping in place). The indexer reads registrations separately from generation rows and drops
    // rows with a set `dtime`, so Nexus answers registered:true, an active stake, and four zeros.
    // The old outputs are still decaying (ledger `DustOutput::updated_value` stays above zero) and
    // still spendable, and the Path-A poll is hollow. A registration is not proof of a zero balance.
    mocks.destination.mockResolvedValue(registered('0'));

    const live = mount();
    await settle();

    // The answer really is the registered/active/all-zero shape, and the store took it as such.
    const answer = await (mocks.destination.mock.results[0].value as Promise<MidnightDustDestinationDto>);
    expect(answer.registered).toBe(true);
    expect(answer.stakes.map((stake) => stake.state)).toEqual(['active']);
    expect([answer.nightBalance, answer.generationRate, answer.maxCapacity, answer.currentCapacity])
      .toEqual(['0', '0', '0', '0']);

    expect(live.registrationStatus.value).toBe('Registered');
    expect(live.dustBalance.value).toBe(0n);
    expect(live.settled.value).toBe(true);
    expect(blocked(live)).toBe(false); // never refused
    expect(mayLack(live)).toBe(true); // warned, with a sponsor on offer
  });

  it('refuses only when a caller asserts the zero is verified, which nothing does today', async () => {
    // The hook for a future balance source that counts existing DUST outputs: the same reading
    // as above blocks once `verifiedZero` is set, so the guard is not disabled, just unfed.
    mocks.destination.mockResolvedValue(registered('0'));

    const live = mount();
    await settle();

    expect(blocksMidnightSendLive(feeInputs(live))).toBe(false);
    expect(blocksMidnightSendLive({ ...feeInputs(live), verifiedZero: true })).toBe(true);
  });
});
