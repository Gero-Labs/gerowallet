import { describe, expect, it } from 'vitest';
import { ORDER_LEG_FLOOR_LOVELACE, swapSpendBound } from '../orderSpendBound';

const ADA = 1_000_000n;
const adaLeg = (route: Parameters<typeof swapSpendBound>[0]) => swapSpendBound(route).maxOutflow.get('lovelace')! - BigInt(route.amountIn);

describe('swap spend budget', () => {
  it('never goes below the floor', () => {
    expect(adaLeg({ tokenIn: 'lovelace', amountIn: '1000000', batcherFeeLovelace: '1000000' })).toBe(ORDER_LEG_FLOOR_LOVELACE);
  });

  it('counts the quoted fees and deposit once the leg is above the floor', () => {
    const route = {
      tokenIn: 'lovelace', amountIn: '100000000', dex: 'MINSWAP_V2',
      aggregatorFeeLovelace: '5000000', batcherFeeLovelace: '4000000', partnerFeeLovelace: '1000000',
      orderDepositLovelace: '3000000',
    };
    expect(adaLeg(route)).toBe(5n * ADA + 4n * ADA + ADA + 3n * ADA);
  });

  it('does not let the quote\'s network fee estimate widen the budget', () => {
    // verifySpendBound already allows the transaction's own fee (capped) on top of the budget.
    const route = { tokenIn: 'lovelace', amountIn: '1', aggregatorFeeLovelace: '13000000', estimatedTxFeeLovelace: '900000000' };
    expect(adaLeg(route)).toBe(13n * ADA + 2n * ADA);
  });

  it('uses the widget\'s own deposit and execution defaults when the quote leaves them out', () => {
    const fees = { aggregatorFeeLovelace: '8000000', batcherFeeLovelace: '4000000' };
    const base = 8n * ADA + 4n * ADA;
    expect(adaLeg({ tokenIn: 'lovelace', amountIn: '1', dex: 'SPLASH', ...fees })).toBe(base + 1_500_000n + 2n * ADA);
    expect(adaLeg({ tokenIn: 'lovelace', amountIn: '1', dex: 'MUESLISWAP', ...fees })).toBe(base);
    expect(adaLeg({ tokenIn: 'lovelace', amountIn: '1', dex: 'WINGRIDERS_V2', ...fees })).toBe(base + 2n * ADA);
  });

  it('budgets a token sale as the token amount plus the ADA leg', () => {
    const bound = swapSpendBound({ tokenIn: 'AABB', amountIn: '500' });
    expect(bound.maxOutflow.get('aabb')).toBe(500n);
    expect(bound.maxOutflow.get('lovelace')).toBe(ORDER_LEG_FLOOR_LOVELACE);
  });
});
