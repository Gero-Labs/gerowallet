// gero-sync's live-block push relayed a token's unit the way yaci writes it,
// `<policy id>.<hex name>`, until gero-sync PR 100, and records stored from those
// pushes keep it. Every lookup in resolveAsset() is keyed on the two concatenated,
// so such a row rendered as the first 16 characters of the unit with an undivided
// quantity until the wallet's CBOR backfill rebuilt the record.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const assets: Record<string, unknown> = {};
vi.mock('@/stores/networkStore', () => ({ default: { state: { get assets() { return assets; } } } }));
vi.mock('@/stores/tokenMetadataStore', () => ({
  default: { state: { tokens: {}, blacklistPolicies: [] } },
}));

import { resolveAsset, normalizeAssetUnit } from './resolver';

const POLICY = '10a49b996e2402269af553a8a96fb8eb90d79e9eca79e2b4223057b6';
const NAME_HEX = '4745524f'; // "GERO"
const UNIT = `${POLICY}${NAME_HEX}`;
const DOTTED = `${POLICY}.${NAME_HEX}`;

beforeEach(() => {
  for (const k of Object.keys(assets)) delete assets[k];
});

describe('normalizeAssetUnit', () => {
  it("strips the dot from yaci's unit", () => {
    expect(normalizeAssetUnit(DOTTED)).toBe(UNIT);
    // a token minted without a name: policy id, dot, nothing
    expect(normalizeAssetUnit(`${POLICY}.`)).toBe(POLICY);
  });

  it('leaves lovelace, a concatenated unit and anything else alone', () => {
    expect(normalizeAssetUnit('lovelace')).toBe('lovelace');
    expect(normalizeAssetUnit(UNIT)).toBe(UNIT);
    expect(normalizeAssetUnit('not.a.unit')).toBe('not.a.unit');
    expect(normalizeAssetUnit(`${POLICY}.xyz`)).toBe(`${POLICY}.xyz`);
  });
});

describe("resolveAsset — unit in yaci's dotted form", () => {
  it('finds the registered token and reports the concatenated unit', () => {
    assets[UNIT] = {
      asset: UNIT,
      policy_id: POLICY,
      asset_name: NAME_HEX,
      metadata: { ticker: 'GERO', name: 'GeroWallet', decimals: 6 },
    };

    const resolved = resolveAsset({ unit: DOTTED, quantity: '1717071508' });
    expect(resolved.unit).toBe(UNIT);
    expect(resolved.name).toBe('GERO');
    expect(resolved.metadata.decimals).toBe(6);
    expect(resolved.policy_id).toBe(POLICY);
    expect(resolved.asset_name).toBe(NAME_HEX);
    expect(resolved.quantity).toBe('1717071508');
  });

  it('still decodes the asset name when the token is not registered', () => {
    const resolved = resolveAsset({ unit: DOTTED, quantity: '1' });
    expect(resolved.unit).toBe(UNIT);
    expect(resolved.name).toBe('GERO');
    expect(resolved.policy_id).toBe(POLICY);
  });
});
