import { describe, it, expect, vi, beforeEach } from 'vitest';

// useMarketData.ts uses module-level auto-imported `ref` (undefined under vitest);
// the resolver only needs its getTokenByUnit for token logos — stub it.
vi.mock('@/modules/market/composables/useMarketData', () => ({
  // Passive module-level readers the swap imports directly (no useMarketData() call).
  getTokenByUnit: () => undefined,
  getTokenImage: () => '',
}));

const { tokens, state, resolveAsset, loadTokens } = vi.hoisted(() => {
  const tokens: Record<string, unknown> = {};
  return {
    tokens,
    state: { heldByWallet: false },
    resolveAsset: vi.fn(),
    loadTokens: vi.fn(),
  };
});

vi.mock('@/stores/tokenMetadataStore', () => ({
  default: {
    state: { tokens },
    loadTokens: (...args: unknown[]) => loadTokens(...args),
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
    loadTokens.mockReset();
    loadTokens.mockImplementation(async () => {});
  });

  it('returns null for lovelace (widget seeds ADA itself)', async () => {
    const { resolveToken } = useSwapTokenResolver();
    expect(await resolveToken('lovelace')).toBeNull();
    expect(resolveAsset).not.toHaveBeenCalled();
  });

  it('maps a token in the swap token registry to TokenMeta with real decimals (primary source), and supplies img via resolveAsset\'s local-cache lookup', async () => {
    tokens['known'] = { name: 'Snek', ticker: 'SNEK', decimals: 0, unit: 'known', verified: true, price: 0.001 };
    resolveAsset.mockReturnValue({ img: 'snek.png' });
    const { resolveToken } = useSwapTokenResolver();
    const m = await resolveToken('known');
    expect(m).toMatchObject({ unit: 'known', decimals: 0, ticker: 'SNEK', name: 'Snek', verified: true, price: 0.001, img: 'snek.png' });
    // resolveAsset is a synchronous local-cache lookup (not a network call), so it's
    // safe (and now expected) to call it on the registry-hit path too, purely for img.
    expect(resolveAsset).toHaveBeenCalledWith({ unit: 'known' });
  });

  it('normalizes a missing img to null (not undefined) for a registry-known token absent from the local asset cache', async () => {
    tokens['no-img'] = { name: 'NoImg', ticker: 'NI', decimals: 0, unit: 'no-img' };
    resolveAsset.mockReturnValue(undefined);
    const { resolveToken } = useSwapTokenResolver();
    const m = await resolveToken('no-img');
    expect(m).toMatchObject({ unit: 'no-img', img: null });
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

  it('hydrates the empty registry once and resolves a token that only appears after loadTokens (hydration race fix)', async () => {
    state.heldByWallet = false;
    loadTokens.mockImplementation(async () => {
      tokens['lazy'] = { name: 'Lazy', ticker: 'LAZY', decimals: 6, unit: 'lazy', verified: true, price: 1 };
    });
    const { resolveToken } = useSwapTokenResolver();
    const m = await resolveToken('lazy');
    expect(loadTokens).toHaveBeenCalledTimes(1);
    expect(m).toMatchObject({ unit: 'lazy', decimals: 6, ticker: 'LAZY', verified: true });
  });

  it('returns null when still unknown after the hydration attempt (registry stays empty)', async () => {
    state.heldByWallet = false;
    const { resolveToken } = useSwapTokenResolver();
    const m = await resolveToken('still-mystery');
    expect(loadTokens).toHaveBeenCalledTimes(1);
    expect(m).toBeNull();
  });

  it('does not re-attempt hydration on a second unknown-resolve after a failed hydration (one-shot guard)', async () => {
    state.heldByWallet = false;
    // loadTokens resolves but leaves the map empty — simulates a "failed" hydration
    // (an actual thrown error is already covered by the try/catch and behaves the same).
    const { resolveToken } = useSwapTokenResolver();

    const first = await resolveToken('unknown-a');
    expect(first).toBeNull();
    expect(loadTokens).toHaveBeenCalledTimes(1);

    const second = await resolveToken('unknown-b');
    expect(second).toBeNull();
    expect(loadTokens).toHaveBeenCalledTimes(1); // NOT re-triggered
  });

  it('does not re-hydrate when the registry is already populated (avoids a redundant fetch)', async () => {
    tokens['known'] = { name: 'Snek', ticker: 'SNEK', decimals: 0, unit: 'known' };
    state.heldByWallet = false;
    const { resolveToken } = useSwapTokenResolver();
    const m = await resolveToken('mystery-with-populated-registry');
    expect(loadTokens).not.toHaveBeenCalled();
    expect(m).toBeNull();
  });

  it('resolves to graceful defaults (decimals 0, verified false), not a crash or null, when resolveAsset rejects for a held-but-unregistered token', async () => {
    state.heldByWallet = true;
    resolveAsset.mockRejectedValue(new Error('network error'));
    const { resolveToken } = useSwapTokenResolver();
    const m = await resolveToken('held-resolve-fails');
    expect(m).not.toBeNull();
    expect(m).toMatchObject({ unit: 'held-resolve-fails', decimals: 0, verified: false });
  });

  it('guards against NaN decimals from the store (Number(token_decimals) can be NaN)', async () => {
    tokens['nan-decimals'] = { name: 'Broken', ticker: 'BRK', decimals: NaN, unit: 'nan-decimals' };
    const { resolveToken } = useSwapTokenResolver();
    const m = await resolveToken('nan-decimals');
    expect(m).toMatchObject({ unit: 'nan-decimals', decimals: 0 });
  });
});
