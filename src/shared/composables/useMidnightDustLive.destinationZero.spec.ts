import Vue, { nextTick, reactive } from 'vue';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A zero or empty `dust/destination` answer is a generation status, not proof of zero spendable
 * DUST, so the send guard must not refuse on it.
 *
 * A cNIGHT-only wallet whose registration was made externally and has since been removed gets
 * "no active stakes, zero figures" from Nexus, and its Path-A poll is the hollow all-zero shape.
 * DUST generated before the removal is not erased at that moment: the ledger keeps decaying the
 * output (`DustOutput::updated_value`) so it stays spendable, while the indexer stops reporting the
 * generation row. Refusing on that zero would block a wallet that can pay.
 *
 * Runs the REAL `useMidnightDustLive`, the REAL `useDustPathB` and the REAL guard
 * `blocksMidnightSendLive`, fed the way `MidnightSendDialog` feeds it. Only the network and the
 * stores are mocked.
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
import { blocksMidnightSendLive } from '@/chains/midnight/midnightFeeCapacity';
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
/** The send dialog's guard, fed exactly as `MidnightSendDialog` feeds it. */
const blocked = (live: MidnightDustLive) => blocksMidnightSendLive({
  dustBalance: live.dustBalance.value,
  settled: live.settled.value,
});

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
  it('does not refuse a wallet whose destination answers unregistered/zero and whose Path-A poll is hollow', async () => {
    mocks.destination.mockResolvedValue(unregisteredZero());

    const live = mount();
    await settle();

    // Both polls answered and the battery reads zero, but nothing verified that no DUST is spendable.
    expect(live.hasData.value).toBe(true);
    expect(live.dustBalance.value).toBe(0n);
    expect(live.registrationStatus.value).toBe('Unregistered');
    expect(live.settled.value).toBe(false);
    expect(blocked(live)).toBe(false);
  });

  it('gives the same answer as the unsupported-endpoint fallback with no enumerable stakes', async () => {
    mocks.destination.mockRejectedValue(new DustDestinationUnsupportedError(404));
    mocks.enumerate.mockResolvedValue([]);

    const live = mount();
    await settle();

    expect(mocks.enumerate).toHaveBeenCalled(); // the fallback really ran
    expect(live.settled.value).toBe(false);
    expect(blocked(live)).toBe(false);
  });

  it('does not refuse once a registered wallet has its registration removed between two polls', async () => {
    // The earlier registered answer's stamp must not keep vouching for the zero that follows it.
    mocks.destination.mockResolvedValueOnce(registered('500'));
    const live = mount();
    await settle();
    expect(live.dustBalance.value).toBe(500n);
    expect(live.settled.value).toBe(true);
    expect(blocked(live)).toBe(false);

    mocks.destination.mockResolvedValueOnce(unregisteredZero());
    await vi.advanceTimersByTimeAsync(60_000);

    expect(mocks.destination).toHaveBeenCalledTimes(2);
    expect(live.dustBalance.value).toBe(0n);
    expect(live.settled.value).toBe(false);
    expect(blocked(live)).toBe(false);
  });

  it('keeps showing the decaying output that remains after the registration was removed', async () => {
    // The snapshot from gero-sync still carries the output the ledger is decaying. The empty
    // destination answer must neither zero it nor settle Path B over it.
    midnightStore.dustState = { current: 12_345n } as never;
    mocks.destination.mockResolvedValue(unregisteredZero());

    const live = mount();
    await settle();

    expect(live.dustBalance.value).toBe(12_345n);
    expect(live.settled.value).toBe(false);
    expect(blocked(live)).toBe(false);
  });

  it('still refuses when a REGISTERED destination verifies zero DUST', async () => {
    // The guard is not disabled: a registered answer is a verified reading, zero included.
    mocks.destination.mockResolvedValue(registered('0'));

    const live = mount();
    await settle();

    expect(live.settled.value).toBe(true);
    expect(live.dustBalance.value).toBe(0n);
    expect(blocked(live)).toBe(true);
  });
});
