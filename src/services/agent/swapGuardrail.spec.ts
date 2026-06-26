// src/services/agent/swapGuardrail.spec.ts
import { describe, it, expect } from 'vitest';
import { verifySwapTx, type DecodedTx, type SwapExpectation } from './swapGuardrail';

const OWN = 'addr_own';
const FOREIGN = 'addr_foreign';

const expectation: SwapExpectation = {
  ownAddresses: [OWN],
  outputAssetId: 'policyGERO.4745524f', // resolved by the WALLET, not the agent
  minOutput: 880n,
  sellAssetId: 'lovelace', // selling ADA
  amountIn: 100_000000n, // 100 ADA in lovelace
  maxSpendLovelace: 105_000000n, // amountIn + fees + batcher cap
};

// A decoded tx where the user receives 900 GERO to their own address (passes)
const goodTx: DecodedTx = {
  outputs: [
    { address: OWN, lovelace: 2_000000n, assets: { 'policyGERO.4745524f': 900n } },
    { address: FOREIGN, lovelace: 100_000000n, assets: {} }, // the swap deposit to the DEX
  ],
};

describe('verifySwapTx', () => {
  it('passes when the user receives >= minOutput of the resolved asset to an own address', () => {
    const v = verifySwapTx(goodTx, expectation);
    expect(v.ok).toBe(true);
    expect(v.derived.youReceive).toBe(900n);
  });

  it('FAILS when the received output asset is below minOutput', () => {
    const tx: DecodedTx = { outputs: [{ address: OWN, lovelace: 2_000000n, assets: { 'policyGERO.4745524f': 800n } }] };
    const v = verifySwapTx(tx, expectation);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/below the quoted minimum/i);
  });

  it('FAILS when the output asset is a DIFFERENT token than expected (injected/wrong asset)', () => {
    const tx: DecodedTx = { outputs: [{ address: OWN, lovelace: 2_000000n, assets: { 'policyEVIL.00': 5000n } }] };
    const v = verifySwapTx(tx, expectation);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/did not receive the expected token/i);
  });

  it('FAILS when the expected token is sent to a FOREIGN address (not the user)', () => {
    const tx: DecodedTx = { outputs: [{ address: FOREIGN, lovelace: 2_000000n, assets: { 'policyGERO.4745524f': 900n } }] };
    const v = verifySwapTx(tx, expectation);
    expect(v.ok).toBe(false);
  });

  it('FAILS when total lovelace leaving to foreign addresses exceeds the max spend', () => {
    const tx: DecodedTx = {
      outputs: [
        { address: OWN, lovelace: 2_000000n, assets: { 'policyGERO.4745524f': 900n } },
        { address: FOREIGN, lovelace: 200_000000n, assets: {} }, // way over maxSpend
      ],
    };
    const v = verifySwapTx(tx, expectation);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/exceeds the maximum/i);
  });

  it('FAILS on a partial buy-token drain even when the own output meets the minimum', () => {
    const exp: SwapExpectation = { ...expectation, minOutput: 400n };
    const tx: DecodedTx = {
      outputs: [
        { address: OWN, lovelace: 2_000000n, assets: { 'policyGERO.4745524f': 500n } }, // own >= min
        { address: FOREIGN, lovelace: 2_000000n, assets: { 'policyGERO.4745524f': 900n } }, // buy token siphoned out
      ],
    };
    const v = verifySwapTx(tx, exp);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/not yours/i);
  });

  it('FAILS when an unexpected (other) token would leave the wallet to a foreign address', () => {
    const tx: DecodedTx = {
      outputs: [
        { address: OWN, lovelace: 2_000000n, assets: { 'policyGERO.4745524f': 900n } }, // good buy output
        { address: FOREIGN, lovelace: 2_000000n, assets: { 'policyOTHER.00': 5000n } }, // unexpected drain
      ],
    };
    const v = verifySwapTx(tx, expectation);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/unexpected token/i);
  });

  it('FAILS when more of the SELL token leaves than the amount being swapped (token sell)', () => {
    const exp: SwapExpectation = {
      ownAddresses: [OWN],
      outputAssetId: 'lovelace', // buying ADA
      minOutput: 1_000000n,
      sellAssetId: 'policySNEK.534e454b', // selling SNEK
      amountIn: 100n,
      maxSpendLovelace: 105_000000n,
    };
    const tx: DecodedTx = {
      outputs: [
        { address: OWN, lovelace: 2_000000n, assets: { lovelace: 2_000000n } }, // receives enough buy token (ADA)
        { address: FOREIGN, lovelace: 2_000000n, assets: { 'policySNEK.534e454b': 250n } }, // over the 100 swapped
      ],
    };
    const v = verifySwapTx(tx, exp);
    expect(v.ok).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/selling would leave/i);
  });
});
