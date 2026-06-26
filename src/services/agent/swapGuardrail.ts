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
  outputAssetId: string; // resolved by the wallet (NOT asserted by the agent)
  minOutput: bigint;
  maxSpendLovelace: bigint; // amountIn + fees + batcher headroom
}
export interface SwapVerdict {
  ok: boolean;
  reasons: string[];
  derived: { youReceive: bigint; lovelaceToForeign: bigint };
}

/**
 * Deterministically verify a built (unsigned) swap tx against the wallet's expectation.
 * The agent supplied none of these numbers - the wallet resolved the asset, the minimum
 * came from the quote, and the outputs are decoded from the actual tx. A hallucinated or
 * injected value cannot pass this gate.
 */
export function verifySwapTx(tx: DecodedTx, exp: SwapExpectation): SwapVerdict {
  const own = new Set(exp.ownAddresses);
  const reasons: string[] = [];

  let youReceive = 0n;
  for (const o of tx.outputs) {
    if (own.has(o.address)) youReceive += o.assets[exp.outputAssetId] ?? 0n;
  }

  let lovelaceToForeign = 0n;
  let foreignHasExpectedToken = false;
  for (const o of tx.outputs) {
    if (own.has(o.address)) continue;
    lovelaceToForeign += o.lovelace;
    if ((o.assets[exp.outputAssetId] ?? 0n) > 0n) foreignHasExpectedToken = true;
  }

  if (youReceive === 0n) {
    reasons.push('You did not receive the expected token from this swap.');
  } else if (youReceive < exp.minOutput) {
    reasons.push('The amount you would receive is below the quoted minimum.');
  }
  if (foreignHasExpectedToken && youReceive < exp.minOutput) {
    reasons.push('The expected token is going to an address that is not yours.');
  }
  if (lovelaceToForeign > exp.maxSpendLovelace) {
    reasons.push('The ADA leaving your wallet exceeds the maximum for this swap.');
  }

  return { ok: reasons.length === 0, reasons, derived: { youReceive, lovelaceToForeign } };
}
