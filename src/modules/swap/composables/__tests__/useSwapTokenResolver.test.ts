import { describe, it, expect, vi, beforeEach } from 'vitest';

const { tokens, state, resolveAsset } = vi.hoisted(() => {
  const tokens: Record<string, unknown> = {};
  return {
    tokens,
    state: { heldByWallet: false },
    resolveAsset: vi.fn(),
  };
});

vi.mock('@/stores/tokenMetadataStore', () => ({
  default: {
    state: { tokens },
  },
}));

vi.mock('@/stores/networkStore', () => ({
  default: {
    hasAsset: vi.fn((_unit: string) => state.heldByWallet),
  },
}));

vi.mock('@/shared/utils/resolver', () => ({
  resolveAsset: (...args: unknown[]) => resolveAsset(...args),
}));

import { useSwapTokenResolver } from '../useSwapTokenResolver';

describe('useSwapTokenResolver', () => {
  beforeEach(() => {
    for (const key of Object.keys(tokens)) delete tokens[key];
    state.heldByWallet = false;
    resolveAsset.mockReset();
  });

  it('returns null for lovelace (widget seeds ADA itself)', async () => {
    const { resolveToken } = useSwapTokenResolver();
    expect(await resolveToken('lovelace')).toBeNull();
    expect(resolveAsset).not.toHaveBeenCalled();
  });

  it('maps a token in the swap token registry to TokenMeta with real decimals (primary source)', async () => {
    tokens['known'] = { name: 'Snek', ticker: 'SNEK', decimals: 0, unit: 'known', verified: true, price: 0.001 };
    const { resolveToken } = useSwapTokenResolver();
    const m = await resolveToken('known');
    expect(m).toMatchObject({ unit: 'known', decimals: 0, ticker: 'SNEK', name: 'Snek', verified: true, price: 0.001 });
    expect(resolveAsset).not.toHaveBeenCalled();
  });

  it('resolves best-known decimals from resolveAsset for a token the wallet holds but is absent from the swap registry', async () => {
    state.heldByWallet = true;
    resolveAsset.mockResolvedValue({
      unit: 'held-not-registered',
      metadata: { decimals: 8, ticker: 'HELD' },
      img: 'i',
      verified: false,
    });
    const { resolveToken } = useSwapTokenResolver();
    const m = await resolveToken('held-not-registered');
    expect(m).toMatchObject({ unit: 'held-not-registered', decimals: 8, ticker: 'HELD', img: 'i' });
  });

  it('defaults decimals to 0 (never null) for a wallet-known token with no resolvable metadata.decimals', async () => {
    state.heldByWallet = true;
    resolveAsset.mockResolvedValue({ unit: 'held-no-meta', metadata: null, verified: false });
    const { resolveToken } = useSwapTokenResolver();
    const m = await resolveToken('held-no-meta');
    expect(m).toMatchObject({ unit: 'held-no-meta', decimals: 0 });
  });

  it('returns null when the token is genuinely unknown (absent from both the registry and the wallet)', async () => {
    state.heldByWallet = false;
    const { resolveToken } = useSwapTokenResolver();
    expect(await resolveToken('mystery')).toBeNull();
    expect(resolveAsset).not.toHaveBeenCalled();
  });
});
