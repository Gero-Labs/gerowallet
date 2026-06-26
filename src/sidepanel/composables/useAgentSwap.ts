// src/sidepanel/composables/useAgentSwap.ts
import { ref, type Ref } from 'vue';
import type { SwapIntent } from '@/services/agent/swapIntent';
import type { SwapVerdict } from '@/services/agent/swapGuardrail';

// ---------------------------------------------------------------------------
// Adaptation A: two asset-id formats
//
// Nexus quote/build use UNIT format:  'lovelace' | policyId+assetNameHex (no dot)
// Guardrail decodeAndVerify uses DOT-key format: 'lovelace' | policyId.assetNameHex
// ---------------------------------------------------------------------------

/** Convert a UNIT-format asset id to the dot-key format the Guardrail expects. */
function unitToAssetKey(unit: string): string {
  if (unit === 'lovelace') return 'lovelace';
  return `${unit.slice(0, 56)}.${unit.slice(56)}`;
}

/** Convert a human-readable decimal amount string to the smallest unit as bigint. */
function toSmallest(amount: string, decimals: number): bigint {
  const [whole, frac = ''] = amount.split('.');
  const padded = (frac + '0'.repeat(decimals)).slice(0, decimals);
  return BigInt(whole || '0') * 10n ** BigInt(decimals) + BigInt(padded || '0');
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface SwapProposal {
  status: 'ready' | 'blocked';
  sellSymbol: string;
  buySymbol: string;
  /** amountIn in the sell asset's smallest unit, as a decimal string */
  amountIn: string;
  /** The opaque unsigned tx CBOR - pass verbatim to sign and submit */
  unsignedTxCbor: string;
  youReceive: bigint;
  minOutput: bigint;
  reasons: string[];
}

// Adaptation B: decodeAndVerify receives both outputAssetKey and sellAssetKey (DOT-keys).
export interface AgentSwapDeps {
  /** Resolve a ticker symbol to a UNIT-format asset id. 'ADA' must map to 'lovelace'. */
  resolveSymbol: (symbol: string) => Promise<string>;
  /** Return the number of decimals for a UNIT-format asset id ('lovelace' -> 6). */
  getDecimals: (unitAssetId: string) => Promise<number>;
  /** Return the held balance in smallest units for a UNIT-format asset id. */
  getHeldAmount: (unitAssetId: string) => Promise<bigint>;
  /** Call the Nexus aggregator /api/aggregator/quote endpoint. */
  quote: (req: {
    tokenIn: string;
    tokenOut: string;
    amountIn: string;
  }) => Promise<{
    routes: Array<{
      amountIn: string;
      minimumOutput: string;
      expectedOutput: string;
      [key: string]: unknown;
    }>;
    bestRouteIndex: number;
  }>;
  /** Call the Nexus aggregator /api/aggregator/build-tx endpoint. */
  build: (route: unknown) => Promise<{ unsignedTxCbor: string }>;
  /**
   * Decode the unsigned tx CBOR and run the Guardrail, returning a SwapVerdict.
   *
   * Adaptation B signature - both DOT-key asset ids are required:
   *   outputAssetKey - the buy token in dot-key format ('lovelace' | 'policy.assetName')
   *   sellAssetKey   - the sell token in dot-key format ('lovelace' | 'policy.assetName')
   *   minOutput      - minimum acceptable received amount (from quote)
   *   maxSpendLovelace - ADA outflow ceiling (Adaptation C)
   *   amountIn       - sell amount in smallest units
   */
  decodeAndVerify: (
    unsignedTxCbor: string,
    outputAssetKey: string,
    sellAssetKey: string,
    minOutput: bigint,
    maxSpendLovelace: bigint,
    amountIn: bigint,
  ) => SwapVerdict;
}

// ---------------------------------------------------------------------------
// Composable factory
// ---------------------------------------------------------------------------

export function createAgentSwap(deps: AgentSwapDeps) {
  const busy: Ref<boolean> = ref(false);
  const error: Ref<string> = ref('');
  const proposal: Ref<SwapProposal | null> = ref(null);

  async function prepare(intent: SwapIntent): Promise<void> {
    if (busy.value) return;
    busy.value = true;
    error.value = '';
    proposal.value = null;

    try {
      // 1. Resolve symbols to UNIT-format asset ids.
      const tokenInUnit = await deps.resolveSymbol(intent.sellSymbol);
      const tokenOutUnit = await deps.resolveSymbol(intent.buySymbol);

      // 2. Compute amountIn in the sell asset's smallest units.
      let amountIn: bigint;
      if (intent.mode === 'percent') {
        const held = await deps.getHeldAmount(tokenInUnit);
        amountIn = (held * BigInt(intent.percent ?? 0)) / 100n;
      } else {
        const decimals = await deps.getDecimals(tokenInUnit);
        amountIn = toSmallest(intent.amount ?? '0', decimals);
      }

      // 3. Get a quote (UNIT format for tokenIn/tokenOut).
      const quoteResp = await deps.quote({
        tokenIn: tokenInUnit,
        tokenOut: tokenOutUnit,
        amountIn: amountIn.toString(),
      });
      const route = quoteResp.routes[quoteResp.bestRouteIndex];
      const minOutput = BigInt(route.minimumOutput);

      // 4. Build the unsigned tx.
      const built = await deps.build(route);

      // 5. Adaptation A: convert UNIT -> DOT-key for the Guardrail.
      const outputAssetKey = unitToAssetKey(tokenOutUnit);
      const sellAssetKey = unitToAssetKey(tokenInUnit);

      // 6. Adaptation C: compute maxSpendLovelace based on sell-token type.
      //    ADA sell: amountIn (lovelace) + 5 ADA headroom for fees/batcher.
      //    Token sell: only the 5 ADA headroom (sell-token outflow is bounded by amountIn inside the Guardrail).
      const maxSpendLovelace =
        tokenInUnit === 'lovelace' ? amountIn + 5_000000n : 5_000000n;

      // 7. Adaptation B: call decodeAndVerify with both asset keys.
      const verdict = deps.decodeAndVerify(
        built.unsignedTxCbor,
        outputAssetKey,
        sellAssetKey,
        minOutput,
        maxSpendLovelace,
        amountIn,
      );

      proposal.value = {
        status: verdict.ok ? 'ready' : 'blocked',
        sellSymbol: intent.sellSymbol,
        buySymbol: intent.buySymbol,
        amountIn: amountIn.toString(),
        unsignedTxCbor: built.unsignedTxCbor,
        youReceive: verdict.derived.youReceive,
        minOutput,
        reasons: verdict.reasons,
      };
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Could not prepare the swap.';
    } finally {
      busy.value = false;
    }
  }

  return { busy, error, proposal, prepare };
}
