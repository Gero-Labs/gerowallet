// src/sidepanel/composables/useAgentSwap.spec.ts
import { describe, it, expect, vi } from 'vitest';
import { createAgentSwap } from './useAgentSwap';
import type { SwapIntent } from '@/services/agent/swapIntent';

function deps(over: Record<string, unknown> = {}) {
  return {
    resolveSymbol: vi.fn(async (s: string) => (s === 'ADA' ? 'lovelace' : 'policy1234567890abcdef1234567890abcdef1234567890abcdef12345678904745524f')),
    getDecimals: vi.fn(async () => 6),
    getHeldAmount: vi.fn(async () => 1_000_000_000n),
    quote: vi.fn(async () => ({
      routes: [
        {
          dex: 'MINSWAP',
          tokenIn: 'lovelace',
          tokenOut: 'policy1234567890abcdef1234567890abcdef1234567890abcdef12345678904745524f',
          amountIn: '100000000',
          expectedOutput: '900',
          minimumOutput: '880',
        },
      ],
      bestRouteIndex: 0,
    })),
    build: vi.fn(async () => ({ unsignedTxCbor: 'deadbeef' })),
    decodeAndVerify: vi.fn(
      () =>
        ({
          ok: true,
          reasons: [],
          derived: { youReceive: 900n, lovelaceToForeign: 100_000000n, sellToForeign: 0n },
        }) as const,
    ),
    ...over,
  };
}

const intent: SwapIntent = {
  type: 'swap',
  sellSymbol: 'ADA',
  buySymbol: 'GERO',
  mode: 'amount',
  amount: '100',
};

describe('useAgentSwap.prepare', () => {
  it('resolves symbols, quotes, builds, and verifies into a ready proposal', async () => {
    const d = deps();
    const swap = createAgentSwap(d as never);
    await swap.prepare(intent);
    expect(d.resolveSymbol).toHaveBeenCalledWith('GERO');
    expect(d.quote).toHaveBeenCalled();
    expect(swap.proposal.value?.status).toBe('ready');
    expect(swap.proposal.value?.unsignedTxCbor).toBe('deadbeef');
    expect(swap.proposal.value?.youReceive).toBe(900n);
  });

  it('blocks (status=blocked) when the Guardrail fails - never ready to sign', async () => {
    const d = deps({
      decodeAndVerify: vi.fn(() => ({
        ok: false,
        reasons: ['You did not receive the expected token from this swap.'],
        derived: { youReceive: 0n, lovelaceToForeign: 0n, sellToForeign: 0n },
      })),
    });
    const swap = createAgentSwap(d as never);
    await swap.prepare(intent);
    expect(swap.proposal.value?.status).toBe('blocked');
    expect(swap.proposal.value?.reasons[0]).toMatch(/did not receive/i);
  });

  it('does not auto-sign during prepare', async () => {
    const sign = vi.fn();
    const d = deps({ sign });
    const swap = createAgentSwap(d as never);
    await swap.prepare(intent);
    expect(sign).not.toHaveBeenCalled();
  });

  it('for a token-sell percent intent, calls quote with the resolved unit and amountIn derived from getHeldAmount * percent / 100', async () => {
    const percentIntent: SwapIntent = {
      type: 'swap',
      sellSymbol: 'GERO',
      buySymbol: 'ADA',
      mode: 'percent',
      percent: 30,
    };
    // resolveSymbol: GERO -> unit, ADA -> 'lovelace'
    const resolveSymbol = vi.fn(async (s: string) =>
      s === 'ADA'
        ? 'lovelace'
        : 'policy1234567890abcdef1234567890abcdef1234567890abcdef12345678904745524f',
    );
    // 1_000_000_000n * 30 / 100 = 300_000_000n
    const getHeldAmount = vi.fn(async () => 1_000_000_000n);
    const quote = vi.fn(async () => ({
      routes: [
        {
          dex: 'MINSWAP',
          tokenIn: 'policy1234567890abcdef1234567890abcdef1234567890abcdef12345678904745524f',
          tokenOut: 'lovelace',
          amountIn: '300000000',
          expectedOutput: '5000000',
          minimumOutput: '4900000',
        },
      ],
      bestRouteIndex: 0,
    }));
    const d = deps({ resolveSymbol, getHeldAmount, quote });
    const swap = createAgentSwap(d as never);
    await swap.prepare(percentIntent);
    expect(quote).toHaveBeenCalledWith(
      expect.objectContaining({
        tokenIn: 'policy1234567890abcdef1234567890abcdef1234567890abcdef12345678904745524f',
        amountIn: '300000000',
      }),
    );
  });
});
