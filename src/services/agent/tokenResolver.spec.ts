// src/services/agent/tokenResolver.spec.ts
import { describe, it, expect, vi } from 'vitest';
import * as market from '@/api/market-api';
import { resolveSymbolToAssetId } from './tokenResolver';

describe('resolveSymbolToAssetId', () => {
  it('matches a token by case-insensitive ascii name and returns its assetId', async () => {
    vi.spyOn(market.default, 'getTopByVolume').mockResolvedValue([
      { assetId: 'aaa.534e454b', assetNameAscii: 'SNEK' },
      { assetId: 'bbb.4745524f', assetNameAscii: 'GERO' },
    ] as never);

    expect(await resolveSymbolToAssetId('gero')).toBe('bbb.4745524f');
  });

  it('returns null when no token matches', async () => {
    vi.spyOn(market.default, 'getTopByVolume').mockResolvedValue([
      { assetId: 'aaa.534e454b', assetNameAscii: 'SNEK' },
    ] as never);

    expect(await resolveSymbolToAssetId('doesnotexist')).toBeNull();
  });
});
