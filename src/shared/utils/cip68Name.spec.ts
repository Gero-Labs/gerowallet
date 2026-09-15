// Regression: a CIP-68 token whose metadata is not resolvable must still show its
// name. resolveAsset() entered the label branch, found no metadata, and because the
// name-decoding fallback was an `else if`, left the row labelled with truncated hex.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const assets: Record<string, unknown> = {};
vi.mock('@/stores/networkStore', () => ({ default: { state: { get assets() { return assets; } } } }));
vi.mock('@/stores/tokenMetadataStore', () => ({
  default: { state: { tokens: {}, blacklistPolicies: [] } },
}));

import { resolveAsset } from './resolver';

const POLICY = '67cf09ead50179b591c94247415a0aae8de3650c311364385210f1f2';
const LABEL_333 = '0014df10';
const NAME_HEX = '5257412d43495036382d33'; // "RWA-CIP68-3"
const UNIT = `${POLICY}${LABEL_333}${NAME_HEX}`;

beforeEach(() => {
  for (const k of Object.keys(assets)) delete assets[k];
});

describe('resolveAsset — CIP-68 token without resolvable metadata', () => {
  it('shows the asset name, not truncated hex', () => {
    // Exactly what the backend returns today: a row exists, but every metadata
    // field is empty and onchain_metadata_extra is the STRING "null".
    assets[UNIT] = {
      asset: UNIT,
      policy_id: POLICY,
      asset_name: `${LABEL_333}${NAME_HEX}`,
      onchain_metadata: null,
      onchain_metadata_extra: 'null',
      metadata: null,
    };

    const resolved = resolveAsset({ unit: UNIT, quantity: '10' });
    expect(resolved.name).toBe('RWA-CIP68-3');
  });

  it('still decodes a plain unlabelled asset name', () => {
    const plainUnit = `${POLICY}${NAME_HEX}`;
    assets[plainUnit] = { asset: plainUnit, policy_id: POLICY, asset_name: NAME_HEX };
    expect(resolveAsset({ unit: plainUnit, quantity: '1' }).name).toBe('RWA-CIP68-3');
  });
});
