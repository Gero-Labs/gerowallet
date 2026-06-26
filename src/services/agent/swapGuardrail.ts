// src/services/agent/swapGuardrail.ts
export interface DecodedOutput {
  address: string;
  lovelace: bigint;
  assets: Record<string, bigint>; // key: `${policyId}.${assetNameHex}`
}
export interface DecodedTx {
  outputs: DecodedOutput[];
}
export interface SwapExpectation {
  ownAddresses: string[];
  outputAssetId: string; // buy token (wallet-resolved)
  minOutput: bigint;
  sellAssetId: string; // sell token (wallet-resolved); 'lovelace' for ADA
  amountIn: bigint; // amount being swapped, in the sell asset's smallest unit
  maxSpendLovelace: bigint; // amountIn + fees + batcher headroom
}
export interface SwapVerdict {
  ok: boolean;
  reasons: string[];
  derived: { youReceive: bigint; lovelaceToForeign: bigint; sellToForeign: bigint };
}

/**
 * Deterministically verify a built (unsigned) swap tx against the wallet's expectation.
 * The agent supplied none of these numbers - the wallet resolved the asset, the minimum
 * came from the quote, and the outputs are decoded from the actual tx. A hallucinated or
 * injected value cannot pass this gate.
 *
 * Unified safety rule: the ONLY token allowed to leave to a foreign (non-own) address is
 * the SELL token (the swap deposit), and no more of it than `amountIn`. Any buy-token or
 * other-token leaving to a foreign address is a drain and blocks signing.
 */
export function verifySwapTx(tx: DecodedTx, exp: SwapExpectation): SwapVerdict {
  if (exp.ownAddresses.length === 0) {
    return {
      ok: false,
      reasons: ['Cannot verify the swap: no wallet address to check against.'],
      derived: { youReceive: 0n, lovelaceToForeign: 0n, sellToForeign: 0n },
    };
  }

  const own = new Set(exp.ownAddresses);
  const reasons: string[] = [];

  let youReceive = 0n;
  for (const o of tx.outputs) {
    if (own.has(o.address)) youReceive += o.assets[exp.outputAssetId] ?? 0n;
  }

  let lovelaceToForeign = 0n;
  let sellToForeign = 0n;
  let foreignGetsBuyToken = false;
  let foreignGetsOtherToken = false;
  for (const o of tx.outputs) {
    if (own.has(o.address)) continue;
    lovelaceToForeign += o.lovelace;
    for (const [assetId, qty] of Object.entries(o.assets)) {
      if (qty <= 0n) continue;
      if (assetId === exp.outputAssetId) foreignGetsBuyToken = true;
      else if (assetId === exp.sellAssetId) sellToForeign += qty;
      else foreignGetsOtherToken = true;
    }
  }

  if (youReceive === 0n) {
    reasons.push('You did not receive the expected token from this swap.');
  } else if (youReceive < exp.minOutput) {
    reasons.push('The amount you would receive is below the quoted minimum.');
  }
  if (foreignGetsBuyToken) {
    reasons.push('The expected token is going to an address that is not yours.');
  }
  if (foreignGetsOtherToken) {
    reasons.push('An unexpected token would leave your wallet.');
  }
  if (sellToForeign > exp.amountIn) {
    reasons.push('More of the token you are selling would leave your wallet than you asked to swap.');
  }
  if (lovelaceToForeign > exp.maxSpendLovelace) {
    reasons.push('The ADA leaving your wallet exceeds the maximum for this swap.');
  }

  return { ok: reasons.length === 0, reasons, derived: { youReceive, lovelaceToForeign, sellToForeign } };
}
