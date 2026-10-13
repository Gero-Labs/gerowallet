import { beforeEach, describe, expect, it, vi } from 'vitest';
import { isProxy, reactive, toRaw } from 'vue';

vi.mock('@/stores/networkStore', async () => {
  const { reactive } = await import('vue');
  return { default: { state: reactive({ assets: {} as Record<string, unknown> }) } };
});
vi.mock('@/stores/tokenMetadataStore', async () => {
  const { reactive } = await import('vue');
  return { default: { state: reactive({ tokens: {} as Record<string, unknown>, blacklistPolicies: [] }) } };
});

import NetworkStore from '@/stores/networkStore';
import TokenMetadataStore from '@/stores/tokenMetadataStore';
import { resolveAsset } from './resolver';

const POLICY = '10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b6';
const NAME_HEX = '4745524f';
const UNIT = `${POLICY}${NAME_HEX}`;

beforeEach(() => {
  NetworkStore.state.assets = {};
  TokenMetadataStore.state.tokens = {};
});

describe('resolveAsset with Vue reactive stores', () => {
  it('resolves a registered native token and detaches metadata from the store', () => {
    NetworkStore.state.assets[UNIT] = {
      asset: UNIT, policy_id: POLICY, asset_name: NAME_HEX,
      metadata: { ticker: 'GERO', decimals: 6 },
    };
    expect(isProxy(NetworkStore.state.assets[UNIT])).toBe(true);
    expect(() => structuredClone(NetworkStore.state.assets[UNIT])).toThrow();

    const resolved = resolveAsset({ unit: `${POLICY}.${NAME_HEX}`, quantity: 1n });
    expect(resolved).toMatchObject({ unit: UNIT, name: 'GERO', quantity: '1', metadata: { decimals: 6 } });
    expect(isProxy(resolved.metadata)).toBe(false);
    resolved.metadata.decimals = 2;
    expect(NetworkStore.state.assets[UNIT].metadata.decimals).toBe(6);
  });

  it('unwraps proxies nested inside raw asset objects instead of only calling toRaw', () => {
    const properties = reactive({ traits: ['original'], count: 3n, updated: new Date('2026-10-13T00:00:00Z') });
    NetworkStore.state.assets[UNIT] = {
      asset: UNIT, policy_id: POLICY, asset_name: NAME_HEX,
      metadata: { name: 'Nested token', properties },
    };
    expect(() => structuredClone(toRaw(NetworkStore.state.assets[UNIT]))).toThrow();

    const resolved = resolveAsset({ unit: UNIT, quantity: 2n });
    expect(resolved.metadata.properties.count).toBe(3n);
    expect(resolved.metadata.properties.updated).toEqual(properties.updated);
    resolved.metadata.properties.traits.push('local change');
    expect(properties.traits).toEqual(['original']);
  });

  it('resolves nested NFT image metadata without changing the reactive asset', () => {
    const image = reactive(['https://example.com/', 'collectible.png']);
    NetworkStore.state.assets[UNIT] = {
      asset: UNIT, policy_id: POLICY, asset_name: NAME_HEX,
      onchain_metadata: { '721': { [POLICY]: { GERO: { name: 'Collectible', image } } } },
    };
    const resolved = resolveAsset({ unit: UNIT, quantity: 1n });
    expect(resolved.name).toBe('Collectible');
    expect(resolved.img).toBe('https://example.com/collectible.png');
    resolved.onchain_metadata.image.push('local change');
    expect(image).toHaveLength(2);
  });

  it('reads CIP-68 decimals from a token registry containing nested proxies', () => {
    const assetName = `0014df10${NAME_HEX}`; // CIP-67 label 333
    const unit = `${POLICY}${assetName}`;
    const bytes = (text: string) => ({ bytes: Buffer.from(text).toString('hex') });
    const datum = {
      constructor: 0,
      fields: [{ map: [
        { k: bytes('name'), v: bytes('Registered token') },
        { k: bytes('ticker'), v: bytes('GERO') },
        { k: bytes('logo'), v: bytes('https://example.com/token-logo.png') },
        { k: bytes('description'), v: bytes('Fungible token metadata with registry decimals') },
      ] }, { int: 1 }],
    };
    NetworkStore.state.assets[unit] = {
      asset: unit, policy_id: POLICY, asset_name: assetName,
      onchain_metadata_extra: JSON.stringify({ 333: datum }),
    };
    TokenMetadataStore.state.tokens[unit] = { decimals: 6, verified: true, registry: reactive({ name: 'GERO' }) };
    expect(() => structuredClone(toRaw(TokenMetadataStore.state.tokens[unit]))).toThrow();

    const resolved = resolveAsset({ unit, quantity: 1000000n });
    expect(resolved.metadata.decimals).toBe(6);
    expect(resolved.verified).toBe(true);
    expect(NetworkStore.state.assets[unit].metadata).toBeUndefined();
    expect(TokenMetadataStore.state.tokens[unit].decimals).toBe(6);
  });
});
