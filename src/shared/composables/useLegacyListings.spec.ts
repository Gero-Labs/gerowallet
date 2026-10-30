// Discovery of the logged wallet's stuck legacy marketplace items: when it asks Nexus, whom it asks
// about, what it keeps when an answer is late or fails, and how the NFTs get a name and an image.
// Nexus, the metadata API, the stores and the debug logger are stubbed; the real resolver turns
// the asset rows into names and images, so the mapping is the one the rest of the wallet shows.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';

const { walletState, flags, fetchListings, getAssetsInfo, debugLog } = await vi.hoisted(async () => {
  const { reactive } = await import('vue');
  return {
    walletState: reactive({
      loggedWallet: null as { id: number; chain: string; network: string } | null,
      keys: null as Record<string, { cred: string; path: string; address?: string }[]> | null,
    }),
    flags: reactive({ isNftMarketEnabled: false }),
    fetchListings: vi.fn(),
    getAssetsInfo: vi.fn(),
    debugLog: vi.fn(),
  };
});

// resolver.ts pulls in the static-asset barrel purely for placeholder avatars.
vi.mock('@/utils/assets', () => ({
  default: new Proxy({}, { get: (_t, key) => `asset:${String(key)}` }),
}));
vi.mock('@/stores/tokenMetadataStore', () => ({ default: { state: { tokens: {}, blacklistPolicies: [] } } }));
vi.mock('@/stores/networkStore', () => ({ default: { state: { assets: {} } } }));
vi.mock('@/utils/debug', () => ({
  debugLog: (...args: unknown[]) => debugLog(...args),
  debugWarn: vi.fn(),
  isDebugMode: () => false,
}));
vi.mock('@/utils/networks', () => ({ default: { resolveDefaultProvider: () => 2 } }));
vi.mock('@/stores/walletStore', () => ({ walletStore: walletState }));
vi.mock('@/stores/featureFlagsStore', () => ({
  featureFlagsStore: { isNftMarketEnabled: () => flags.isNftMarketEnabled },
}));
vi.mock('@/api/api', () => ({
  Api: class {
    getAssetsInfo(units: string[]) {
      return getAssetsInfo(units);
    }
  },
}));
vi.mock('@/api/legacy-listings-api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/api/legacy-listings-api')>()),
  fetchLegacyListings: (...args: unknown[]) => fetchListings(...args),
}));

import { FORGET_HIDE_MS, resetLegacyListings, useLegacyListings } from './useLegacyListings';
import type { LegacyListingItem } from '@/api/legacy-listings-api';

const PAYMENT = 'a1'.repeat(28);
const CHANGE = 'b2'.repeat(28);
const STAKE = 'c3'.repeat(28);
const OTHER_PAYMENT = 'd4'.repeat(28);
const POLICY = 'e5'.repeat(28);
const CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

const hex = (text: string) => Buffer.from(text, 'utf8').toString('hex');
const unitOf = (name: string) => POLICY + hex(name);
const txHash = (n: number) => n.toString(16).padStart(2, '0').repeat(32);

function listing(n: number, name = `Squid ${n}`, overrides: Partial<LegacyListingItem> = {}): LegacyListingItem {
  return {
    txHash: txHash(n),
    outputIndex: 0,
    contract: 'legacy_v3',
    kind: 'listing',
    ownerPkh: PAYMENT,
    lovelace: '1361960',
    assets: [{ unit: unitOf(name), quantity: '1' }],
    ...overrides,
  };
}

function offer(n: number): LegacyListingItem {
  return { ...listing(n), kind: 'offer', lovelace: '25000000', assets: [] };
}

const refOf = (item: LegacyListingItem) => `${item.txHash}#${item.outputIndex}`;

/** A CIP-25 asset row as `POST /api/assets/info` returns it. */
function assetRow(name: string, display: string, image = `ipfs://${CID}`) {
  return {
    asset: unitOf(name),
    policy_id: POLICY,
    asset_name: hex(name),
    onchain_metadata: { '721': { [POLICY]: { [name]: { name: display, image } } } },
  };
}

function loginTo(id: number, creds: { payment?: string[]; change?: string[]; stake?: string[] }, network = 'Mainnet', chain = 'Cardano') {
  const keysOf = (list: string[] = []) => list.map((cred) => ({ cred, path: "m/1852'/1815'/0'/0/0", address: `addr_${cred.slice(0, 4)}` }));
  walletState.loggedWallet = { id, chain, network };
  walletState.keys = { payment: keysOf(creds.payment), change: keysOf(creds.change), stake: keysOf(creds.stake) };
}

const settle = async () => {
  for (let i = 0; i < 10; i += 1) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useLegacyListings', () => {
  beforeEach(() => {
    fetchListings.mockReset().mockResolvedValue([]);
    getAssetsInfo.mockReset().mockResolvedValue({ status: 200, data: [] });
    debugLog.mockReset();
    walletState.loggedWallet = null;
    walletState.keys = null;
    flags.isNftMarketEnabled = true;
  });

  afterEach(() => {
    resetLegacyListings();
  });

  it('does nothing with the flag off', async () => {
    flags.isNftMarketEnabled = false;
    loginTo(1, { payment: [PAYMENT] });
    const { items, loading, refresh } = useLegacyListings();
    await settle();
    await refresh();

    expect(fetchListings).not.toHaveBeenCalled();
    expect(getAssetsInfo).not.toHaveBeenCalled();
    expect(items.value).toEqual([]);
    expect(loading.value).toBe(false);
  });

  it('starts asking when the flag is turned on', async () => {
    flags.isNftMarketEnabled = false;
    loginTo(1, { payment: [PAYMENT] });
    const { items } = useLegacyListings();
    await settle();
    expect(fetchListings).not.toHaveBeenCalled();

    fetchListings.mockResolvedValue([listing(1)]);
    flags.isNftMarketEnabled = true;
    await settle();

    expect(fetchListings).toHaveBeenCalledTimes(1);
    expect(items.value).toHaveLength(1);
  });

  it.each([
    ['a Cardano preprod wallet', 'Preprod', 'Cardano'],
    ['a Cardano preview wallet', 'Preview', 'Cardano'],
    ['a Bitcoin wallet', 'Mainnet', 'Bitcoin'],
    ['a Midnight wallet', 'Mainnet', 'Midnight'],
    ['an Apex Fusion Prime wallet', 'Mainnet', 'Apex Fusion Prime'],
  ])('does nothing on %s', async (_label, network, chain) => {
    loginTo(1, { payment: [PAYMENT], change: [CHANGE] }, network, chain);
    const { items, refresh } = useLegacyListings();
    await settle();
    await refresh();

    expect(fetchListings).not.toHaveBeenCalled();
    expect(getAssetsInfo).not.toHaveBeenCalled();
    expect(items.value).toEqual([]);
  });

  it('does nothing while no wallet is logged in or the keys are not loaded yet', async () => {
    const { refresh } = useLegacyListings();
    await settle();
    await refresh();
    expect(fetchListings).not.toHaveBeenCalled();

    walletState.loggedWallet = { id: 1, chain: 'Cardano', network: 'Mainnet' };
    await settle();
    await refresh();
    expect(fetchListings).not.toHaveBeenCalled();
  });

  it('asks as soon as the keys arrive after the login', async () => {
    fetchListings.mockResolvedValue([listing(1)]);
    walletState.loggedWallet = { id: 1, chain: 'Cardano', network: 'Mainnet' };
    const { items } = useLegacyListings();
    await settle();
    expect(fetchListings).not.toHaveBeenCalled();

    loginTo(1, { payment: [PAYMENT] });
    await settle();

    expect(fetchListings).toHaveBeenCalledTimes(1);
    expect(items.value).toHaveLength(1);
  });

  it('asks with payment and change key hashes only', async () => {
    loginTo(1, {
      payment: [PAYMENT, OTHER_PAYMENT, PAYMENT],
      change: [CHANGE, PAYMENT],
      stake: [STAKE],
    });
    walletState.keys!['payment'].push({ cred: 'not-a-key-hash', path: 'm' }, { cred: '', path: 'm' });
    useLegacyListings();
    await settle();

    expect(fetchListings).toHaveBeenCalledTimes(1);
    const [owners, network] = fetchListings.mock.calls[0] as [string[], string];
    expect([...owners].sort()).toEqual([PAYMENT, CHANGE, OTHER_PAYMENT].sort());
    expect(owners).not.toContain(STAKE);
    expect(network).toBe('Mainnet');
  });

  it('shares one fetch between callers and coalesces concurrent refreshes', async () => {
    const answer = deferred<LegacyListingItem[]>();
    fetchListings.mockReturnValue(answer.promise);
    loginTo(1, { payment: [PAYMENT] });
    const card = useLegacyListings();
    const inbox = useLegacyListings();
    await settle();

    const first = card.refresh();
    const second = inbox.refresh();
    expect(card.loading.value).toBe(true);
    expect(fetchListings).toHaveBeenCalledTimes(1);

    answer.resolve([listing(1), offer(2)]);
    await Promise.all([first, second]);

    expect(fetchListings).toHaveBeenCalledTimes(1);
    expect(card.loading.value).toBe(false);
    expect(card.items).toBe(inbox.items);
    expect(card.meta).toBe(inbox.meta);
    expect(inbox.count.value).toBe(2);
  });

  it('refetches when the logged wallet changes, clearing the old wallet\'s items at once', async () => {
    const walletA = listing(1, 'Squid A');
    const walletB = listing(2, 'Squid B', { ownerPkh: OTHER_PAYMENT });
    fetchListings.mockImplementation(async (owners: string[]) => (owners.includes(PAYMENT) ? [walletA] : [walletB]));
    loginTo(1, { payment: [PAYMENT] });
    const { items, count } = useLegacyListings();
    await settle();
    expect(items.value.map(refOf)).toEqual([refOf(walletA)]);

    // The account switch clears the keys before the next wallet's arrive.
    walletState.keys = null;
    walletState.loggedWallet = { id: 2, chain: 'Cardano', network: 'Mainnet' };
    expect(items.value).toEqual([]);
    expect(count.value).toBe(0);

    loginTo(2, { payment: [OTHER_PAYMENT] });
    await settle();

    expect(fetchListings).toHaveBeenCalledTimes(2);
    expect(fetchListings.mock.calls[1][0]).toEqual([OTHER_PAYMENT]);
    expect(items.value.map(refOf)).toEqual([refOf(walletB)]);
  });

  it('clears the items when the wallet logs out or moves off mainnet', async () => {
    fetchListings.mockResolvedValue([listing(1)]);
    loginTo(1, { payment: [PAYMENT] });
    const { items } = useLegacyListings();
    await settle();
    expect(items.value).toHaveLength(1);

    loginTo(1, { payment: [PAYMENT] }, 'Preprod');
    await settle();
    expect(items.value).toEqual([]);
    expect(fetchListings).toHaveBeenCalledTimes(1);
  });

  it('drops a slow answer for the wallet the user has already left', async () => {
    const slowForA = deferred<LegacyListingItem[]>();
    const walletB = listing(2, 'Squid B', { ownerPkh: OTHER_PAYMENT });
    fetchListings.mockImplementation((owners: string[]) => (owners.includes(PAYMENT) ? slowForA.promise : Promise.resolve([walletB])));
    loginTo(1, { payment: [PAYMENT] });
    const { items, loading } = useLegacyListings();
    await settle();
    expect(loading.value).toBe(true);

    walletState.keys = null;
    loginTo(2, { payment: [OTHER_PAYMENT] });
    await settle();
    expect(items.value.map(refOf)).toEqual([refOf(walletB)]);

    slowForA.resolve([listing(1, 'Squid A')]);
    await settle();

    expect(items.value.map(refOf)).toEqual([refOf(walletB)]);
    expect(getAssetsInfo.mock.calls.flat(2)).not.toContain(unitOf('Squid A'));
    expect(loading.value).toBe(false);
  });

  it('drops an answer that lands after leaving a wallet and coming back to it', async () => {
    const firstAsk = deferred<LegacyListingItem[]>();
    const secondAsk = deferred<LegacyListingItem[]>();
    fetchListings.mockReturnValueOnce(firstAsk.promise).mockReturnValueOnce(secondAsk.promise);
    loginTo(1, { payment: [PAYMENT] });
    const { items } = useLegacyListings();
    await settle();

    walletState.loggedWallet = { id: 2, chain: 'Cardano', network: 'Mainnet' };
    walletState.keys = null;
    await settle();
    loginTo(1, { payment: [PAYMENT] });
    await settle();
    expect(fetchListings).toHaveBeenCalledTimes(2);

    firstAsk.resolve([listing(1, 'Old answer')]);
    await settle();
    expect(items.value).toEqual([]);

    secondAsk.resolve([listing(2, 'New answer')]);
    await settle();
    expect(items.value.map(refOf)).toEqual([refOf(listing(2))]);
  });

  it('keeps the previous items when a refresh fails', async () => {
    const stuck = listing(1);
    fetchListings.mockResolvedValueOnce([stuck]);
    loginTo(1, { payment: [PAYMENT] });
    const { items, loading, refresh } = useLegacyListings();
    await settle();
    expect(items.value).toHaveLength(1);

    const failure = new Error('Nexus is down');
    fetchListings.mockRejectedValueOnce(failure);
    await expect(refresh()).resolves.toBeUndefined();

    expect(items.value.map(refOf)).toEqual([refOf(stuck)]);
    expect(loading.value).toBe(false);
    expect(debugLog).toHaveBeenCalledWith(expect.stringContaining('legacy'), failure);
  });

  it('has no items and is not loading after a first lookup that fails', async () => {
    fetchListings.mockRejectedValue(new Error('Nexus is down'));
    loginTo(1, { payment: [PAYMENT] });
    const { items, loading } = useLegacyListings();
    await settle();

    expect(items.value).toEqual([]);
    expect(loading.value).toBe(false);
  });

  it('replaces the items with an empty answer', async () => {
    fetchListings.mockResolvedValueOnce([listing(1)]);
    loginTo(1, { payment: [PAYMENT] });
    const { items, refresh } = useLegacyListings();
    await settle();
    expect(items.value).toHaveLength(1);

    fetchListings.mockResolvedValueOnce([]);
    await refresh();
    expect(items.value).toEqual([]);
  });

  it('forget removes items immediately', async () => {
    const [one, two, three] = [listing(1), listing(2), offer(3)];
    fetchListings.mockResolvedValue([one, two, three]);
    loginTo(1, { payment: [PAYMENT] });
    const { items, count, forget } = useLegacyListings();
    await settle();
    expect(count.value).toBe(3);

    forget([refOf(one), refOf(three)]);

    expect(items.value.map(refOf)).toEqual([refOf(two)]);
    expect(count.value).toBe(1);
  });

  it('does not bring a forgotten item back when the index still lists it', async () => {
    const [one, two] = [listing(1), listing(2)];
    fetchListings.mockResolvedValue([one, two]);
    loginTo(1, { payment: [PAYMENT] });
    const { items, forget, refresh } = useLegacyListings();
    await settle();

    forget([refOf(one)]);
    await refresh();

    expect(items.value.map(refOf)).toEqual([refOf(two)]);
  });

  it('keeps an item forgotten while its lookup was in flight out of the answer', async () => {
    const [one, two] = [listing(1), listing(2)];
    const answer = deferred<LegacyListingItem[]>();
    fetchListings.mockReturnValue(answer.promise);
    loginTo(1, { payment: [PAYMENT] });
    const { items, forget } = useLegacyListings();
    await settle();

    forget([refOf(one)]);
    answer.resolve([one, two]);
    await settle();

    expect(items.value.map(refOf)).toEqual([refOf(two)]);
  });

  describe('how long a forgotten item stays hidden', () => {
    // Only the clock is faked: the settle() helper and the stubbed lookups need real timers.
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('hides it right after forget while the server still lists it', async () => {
      const [one, two] = [listing(1), listing(2)];
      fetchListings.mockResolvedValue([one, two]);
      loginTo(1, { payment: [PAYMENT] });
      const { items, forget, refresh } = useLegacyListings();
      await settle();

      forget([refOf(one)]);
      expect(items.value.map(refOf)).toEqual([refOf(two)]);

      vi.advanceTimersByTime(FORGET_HIDE_MS - 1);
      await refresh();
      expect(items.value.map(refOf)).toEqual([refOf(two)]);
    });

    it('shows it again after 15 minutes if the server still returns it', async () => {
      expect(FORGET_HIDE_MS).toBe(15 * 60 * 1000);
      const [one, two] = [listing(1), listing(2)];
      fetchListings.mockResolvedValue([one, two]);
      loginTo(1, { payment: [PAYMENT] });
      const { items, forget, refresh } = useLegacyListings();
      await settle();

      forget([refOf(one)]);
      await refresh();
      expect(items.value.map(refOf)).toEqual([refOf(two)]);

      // The cancel never confirmed: the item is still stuck and must be retryable.
      vi.advanceTimersByTime(FORGET_HIDE_MS);
      await refresh();
      expect(items.value.map(refOf)).toEqual([refOf(one), refOf(two)]);
    });

    it('stops hiding it once an answer omits it, so a rollback shows it again', async () => {
      const [one, two] = [listing(1), listing(2)];
      fetchListings.mockResolvedValue([one, two]);
      loginTo(1, { payment: [PAYMENT] });
      const { items, forget, refresh } = useLegacyListings();
      await settle();

      forget([refOf(one)]);
      // The cancel confirmed: the server no longer returns the output.
      fetchListings.mockResolvedValue([two]);
      await refresh();
      expect(items.value.map(refOf)).toEqual([refOf(two)]);

      // The cancel was rolled back, well inside the 15 minutes.
      fetchListings.mockResolvedValue([one, two]);
      vi.advanceTimersByTime(60_000);
      await refresh();
      expect(items.value.map(refOf)).toEqual([refOf(one), refOf(two)]);
    });

    it('leaves a ref hidden when a lookup fails, since a failure says nothing about it', async () => {
      const [one, two] = [listing(1), listing(2)];
      fetchListings.mockResolvedValue([one, two]);
      loginTo(1, { payment: [PAYMENT] });
      const { items, forget, refresh } = useLegacyListings();
      await settle();

      forget([refOf(one)]);
      fetchListings.mockRejectedValueOnce(new Error('Nexus is down'));
      await refresh();
      await refresh();

      expect(items.value.map(refOf)).toEqual([refOf(two)]);
    });
  });

  it('resolves names and images for listed units through getAssetsInfo', async () => {
    const pioneer = listing(1, 'Squid Pioneer 1');
    const bud = listing(2, 'Bud 2');
    fetchListings.mockResolvedValue([pioneer, bud, offer(3)]);
    getAssetsInfo.mockResolvedValue({
      status: 200,
      data: [assetRow('Squid Pioneer 1', 'Squid Pioneer #1'), assetRow('Bud 2', 'Bud #2', 'https://example.org/bud.png')],
    });
    loginTo(1, { payment: [PAYMENT] });
    const { meta } = useLegacyListings();
    await settle();

    expect(getAssetsInfo).toHaveBeenCalledTimes(1);
    expect([...getAssetsInfo.mock.calls[0][0] as string[]].sort()).toEqual([unitOf('Squid Pioneer 1'), unitOf('Bud 2')].sort());
    const squid = meta.value.get(unitOf('Squid Pioneer 1'));
    expect(squid?.name).toBe('Squid Pioneer #1');
    // The same IPFS-to-proxy rewrite every other NFT image goes through.
    expect(squid?.image).toContain(`/api/ipfs?path=${CID}`);
    expect(meta.value.get(unitOf('Bud 2'))).toEqual({ name: 'Bud #2', image: 'https://example.org/bud.png' });
  });

  it('asks nothing about offers, which hold only ADA', async () => {
    fetchListings.mockResolvedValue([offer(1), offer(2)]);
    loginTo(1, { payment: [PAYMENT] });
    const { items, meta } = useLegacyListings();
    await settle();

    expect(items.value).toHaveLength(2);
    expect(getAssetsInfo).not.toHaveBeenCalled();
    expect(meta.value.size).toBe(0);
  });

  it('asks once for a unit that several items hold and not again on the next refresh', async () => {
    const same = [listing(1, 'Squid Pioneer 1'), listing(2, 'Squid Pioneer 1'), listing(3, 'Bud 2')];
    fetchListings.mockResolvedValue(same);
    getAssetsInfo.mockResolvedValue({ status: 200, data: [assetRow('Squid Pioneer 1', 'Squid Pioneer #1')] });
    loginTo(1, { payment: [PAYMENT] });
    const { refresh } = useLegacyListings();
    await settle();

    expect(getAssetsInfo).toHaveBeenCalledTimes(1);
    expect(getAssetsInfo.mock.calls[0][0]).toHaveLength(2);

    await refresh();
    expect(getAssetsInfo).toHaveBeenCalledTimes(1);
  });

  it('asks for the units in batches, the way the asset sync does', async () => {
    const many = Array.from({ length: 120 }, (_, i) => listing(i + 1, `Squid Number ${i + 1}`));
    fetchListings.mockResolvedValue(many);
    loginTo(1, { payment: [PAYMENT] });
    const { meta } = useLegacyListings();
    await settle();

    expect(getAssetsInfo.mock.calls.length).toBeGreaterThan(1);
    const asked = getAssetsInfo.mock.calls.flatMap(([units]) => units as string[]);
    expect(asked).toHaveLength(120);
    expect(new Set(asked).size).toBe(120);
    expect(meta.value.size).toBe(120);
  });

  it('falls back to the decoded hex asset name when metadata is missing', async () => {
    fetchListings.mockResolvedValue([listing(1, 'Squid Pioneer 1'), listing(2, 'No Row Here')]);
    getAssetsInfo.mockResolvedValue({ status: 200, data: [assetRow('Squid Pioneer 1', 'Squid Pioneer #1')] });
    loginTo(1, { payment: [PAYMENT] });
    const { meta } = useLegacyListings();
    await settle();

    expect(meta.value.get(unitOf('No Row Here'))).toEqual({ name: 'No Row Here' });
    expect(meta.value.get(unitOf('No Row Here'))?.image).toBeUndefined();
  });

  it('strips a CIP-67 label from a fallback name', async () => {
    // 000de140 is the CIP-67 label 222, the CIP-68 NFT.
    const labelled = POLICY + '000de140' + hex('Cip68 Thing');
    fetchListings.mockResolvedValue([listing(1, 'x', { assets: [{ unit: labelled, quantity: '1' }] })]);
    loginTo(1, { payment: [PAYMENT] });
    const { meta } = useLegacyListings();
    await settle();

    expect(meta.value.get(labelled)?.name).toBe('Cip68 Thing');
  });

  it('reads a row it cannot make sense of as a missing one', async () => {
    const labelled = POLICY + '000de140' + hex('Cip68 Thing');
    fetchListings.mockResolvedValue([listing(1, 'x', { assets: [{ unit: labelled, quantity: '1' }] })]);
    getAssetsInfo.mockResolvedValue({
      status: 200,
      // resolveAsset() indexes this string by the label before parsing it, so it must be long enough to get that far.
      data: [{ asset: labelled, policy_id: POLICY, onchain_metadata_extra: 'not json '.repeat(40) }],
    });
    loginTo(1, { payment: [PAYMENT] });
    const { items, meta } = useLegacyListings();
    await settle();

    expect(items.value).toHaveLength(1);
    expect(meta.value.get(labelled)).toEqual({ name: 'Cip68 Thing' });
  });

  it('shows the items with fallback names when the metadata lookup fails, and asks again next time', async () => {
    const stuck = listing(1, 'Squid Pioneer 1');
    fetchListings.mockResolvedValue([stuck]);
    getAssetsInfo.mockRejectedValueOnce(new Error('assets API is down'));
    loginTo(1, { payment: [PAYMENT] });
    const { items, meta, loading, refresh } = useLegacyListings();
    await settle();

    expect(items.value.map(refOf)).toEqual([refOf(stuck)]);
    expect(meta.value.get(unitOf('Squid Pioneer 1'))).toEqual({ name: 'Squid Pioneer 1' });
    expect(loading.value).toBe(false);

    getAssetsInfo.mockResolvedValue({ status: 200, data: [assetRow('Squid Pioneer 1', 'Squid Pioneer #1')] });
    await refresh();

    expect(getAssetsInfo).toHaveBeenCalledTimes(2);
    expect(meta.value.get(unitOf('Squid Pioneer 1'))?.name).toBe('Squid Pioneer #1');
  });

  it('shows the items with fallback names when the metadata answer is not a list', async () => {
    fetchListings.mockResolvedValue([listing(1, 'Squid Pioneer 1')]);
    getAssetsInfo.mockResolvedValue({ status: 200, data: { error: 'nope' } });
    loginTo(1, { payment: [PAYMENT] });
    const { items, meta } = useLegacyListings();
    await settle();

    expect(items.value).toHaveLength(1);
    expect(meta.value.get(unitOf('Squid Pioneer 1'))?.name).toBe('Squid Pioneer 1');
  });

  it('has the fallback names in place in the same tick as the items', async () => {
    const answer = deferred<{ status: number; data: unknown[] }>();
    fetchListings.mockResolvedValue([listing(1, 'Squid Pioneer 1')]);
    getAssetsInfo.mockReturnValue(answer.promise);
    loginTo(1, { payment: [PAYMENT] });
    const { items, meta, loading } = useLegacyListings();
    await settle();

    expect(items.value).toHaveLength(1);
    expect(meta.value.get(unitOf('Squid Pioneer 1'))).toEqual({ name: 'Squid Pioneer 1' });
    expect(loading.value).toBe(true);

    answer.resolve({ status: 200, data: [assetRow('Squid Pioneer 1', 'Squid Pioneer #1')] });
    await settle();
    expect(meta.value.get(unitOf('Squid Pioneer 1'))?.name).toBe('Squid Pioneer #1');
    expect(loading.value).toBe(false);
  });

  it('keeps resolved names across a wallet switch, since a unit means the same for every wallet', async () => {
    fetchListings.mockResolvedValue([listing(1, 'Squid Pioneer 1')]);
    getAssetsInfo.mockResolvedValue({ status: 200, data: [assetRow('Squid Pioneer 1', 'Squid Pioneer #1')] });
    loginTo(1, { payment: [PAYMENT] });
    const { meta } = useLegacyListings();
    await settle();

    walletState.keys = null;
    loginTo(2, { payment: [OTHER_PAYMENT] });
    await settle();

    expect(getAssetsInfo).toHaveBeenCalledTimes(1);
    expect(meta.value.get(unitOf('Squid Pioneer 1'))?.name).toBe('Squid Pioneer #1');
  });
});
