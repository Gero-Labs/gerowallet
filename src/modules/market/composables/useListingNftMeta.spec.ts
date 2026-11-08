// Names, pictures and collection fields for the NFTs of a collection's listings. They are not in
// the wallet, so the wallet store has no metadata for them: they come from the same asset-info
// call the sync makes, through the resolver every other NFT goes through. A unit with no metadata,
// or whose lookup failed, still has a name (decoded from its hex asset name).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { effectScope, nextTick, ref, type EffectScope } from 'vue';

const getAssetsInfo = vi.hoisted(() => vi.fn());

// resolver.ts pulls in the static-asset barrel purely for placeholder avatars.
vi.mock('@/utils/assets', () => ({ default: new Proxy({}, { get: (_t, key) => `asset:${String(key)}` }) }));
vi.mock('@/stores/tokenMetadataStore', () => ({ default: { state: { tokens: {}, blacklistPolicies: [] } } }));
vi.mock('@/stores/networkStore', () => ({ default: { state: { assets: {} } } }));
vi.mock('@/utils/networks', () => ({ default: { resolveDefaultProvider: () => 2 } }));
vi.mock('@/api/api', () => ({
  Api: class {
    getAssetsInfo(units: string[]) {
      return getAssetsInfo(units);
    }
  },
}));

import { Blockchain, Network, WalletType } from '@/models/types';
import { walletStore } from '@/stores/walletStore';
import { resetListingNftMeta, useListingNftMeta } from './useListingNftMeta';

const POLICY = 'e5'.repeat(28);
const CID = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';
const hex = (text: string) => Buffer.from(text, 'utf8').toString('hex');
const unitOf = (name: string) => POLICY + hex(name);

function assetRow(name: string, display: string, extra: Record<string, unknown> = {}, image = `ipfs://${CID}`) {
  return {
    asset: unitOf(name),
    policy_id: POLICY,
    asset_name: hex(name),
    onchain_metadata: { '721': { [POLICY]: { [name]: { name: display, image, ...extra } } } },
  };
}

const settle = async () => {
  for (let i = 0; i < 6; i += 1) {
    await nextTick();
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

let scope: EffectScope;
const units = ref<string[]>([]);
const mountMeta = () => {
  scope = effectScope();
  return scope.run(() => useListingNftMeta(() => units.value))!;
};

beforeEach(() => {
  resetListingNftMeta();
  getAssetsInfo.mockReset();
  units.value = [];
  walletStore.loggedWallet = { id: 1, chain: Blockchain.CARDANO, network: Network.PREPROD, type: WalletType.Normal } as never;
});
afterEach(() => {
  scope?.stop();
  walletStore.loggedWallet = null;
});

describe('useListingNftMeta', () => {
  it('has a name from the asset name the moment a unit is asked about, before any lookup answers', async () => {
    getAssetsInfo.mockReturnValue(new Promise(() => {}));
    units.value = [unitOf('Cat7')];
    const { meta } = mountMeta();
    await settle();
    expect(meta.value.get(unitOf('Cat7'))?.name).toBe('Cat7');
  });

  it('then gives each its display name, its picture through the IPFS proxy, and its collection field', async () => {
    getAssetsInfo.mockResolvedValue({
      status: 200,
      data: [assetRow('Cat7', 'Cool Cat #7', { collection: 'Cool Cats' }), assetRow('Cat8', 'Cool Cat #8', {}, 'https://example.org/8.png')],
    });
    units.value = [unitOf('Cat7'), unitOf('Cat8')];
    const { meta } = mountMeta();
    await settle();

    expect(getAssetsInfo).toHaveBeenCalledTimes(1);
    const seven = meta.value.get(unitOf('Cat7'));
    expect(seven?.name).toBe('Cool Cat #7');
    expect(seven?.image).toContain(`/api/ipfs?path=${CID}`);
    expect(seven?.collection).toBe('Cool Cats');
    expect(meta.value.get(unitOf('Cat8'))).toMatchObject({ name: 'Cool Cat #8', image: 'https://example.org/8.png' });
    expect(meta.value.get(unitOf('Cat8'))?.collection).toBeUndefined();
  });

  it('asks only about units it has not resolved, and picks up units that arrive later', async () => {
    getAssetsInfo.mockResolvedValue({ status: 200, data: [assetRow('Cat7', 'Cool Cat #7')] });
    units.value = [unitOf('Cat7')];
    mountMeta();
    await settle();

    getAssetsInfo.mockResolvedValue({ status: 200, data: [assetRow('Cat8', 'Cool Cat #8')] });
    units.value = [unitOf('Cat7'), unitOf('Cat8')];
    await settle();

    expect(getAssetsInfo).toHaveBeenCalledTimes(2);
    expect(getAssetsInfo.mock.calls[1][0]).toEqual([unitOf('Cat8')]);
  });

  it('keeps the decoded name when the lookup fails, and asks again for it next time', async () => {
    getAssetsInfo.mockRejectedValueOnce(new Error('502'));
    units.value = [unitOf('Cat7')];
    const { meta } = mountMeta();
    await settle();
    expect(meta.value.get(unitOf('Cat7'))?.name).toBe('Cat7');

    getAssetsInfo.mockResolvedValue({ status: 200, data: [assetRow('Cat7', 'Cool Cat #7')] });
    units.value = [unitOf('Cat7'), unitOf('Cat9')];
    await settle();
    expect(getAssetsInfo.mock.calls[1][0]).toEqual(expect.arrayContaining([unitOf('Cat7')]));
    expect(meta.value.get(unitOf('Cat7'))?.name).toBe('Cool Cat #7');
  });

  it('keeps the decoded name for a body that is not a list', async () => {
    getAssetsInfo.mockResolvedValue({ status: 200, data: { error: 'nope' } });
    units.value = [unitOf('Cat7')];
    const { meta } = mountMeta();
    await settle();
    expect(meta.value.get(unitOf('Cat7'))?.name).toBe('Cat7');
  });

  it('asks nothing with no wallet logged in: the lookup needs a network', async () => {
    walletStore.loggedWallet = null;
    units.value = [unitOf('Cat7')];
    mountMeta();
    await settle();
    expect(getAssetsInfo).not.toHaveBeenCalled();
  });
});
