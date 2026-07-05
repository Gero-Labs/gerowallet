import { describe, it, expect } from 'vitest';
import { buildWalletContext } from './walletContext';

const connectedStore = {
  loggedWallet: { network: 'mainnet', name: 'Main', stakeAddress: 'stake1uxyz' },
  isLocked: false,
  tokens: {
    lovelace: { unit: 'lovelace', quantity: 1_234_560000n },
    aaa: { unit: 'aaa534e454b', quantity: 5_000000n, name: 'Snek', metadata: { ticker: 'SNEK', decimals: 6 } },
  },
  account: { controlled_amount: '1234560000', withdrawable_amount: '2500000', pool_id: 'pool1abcdef0000' },
};

describe('buildWalletContext', () => {
  it('reports connected with ADA balance, holdings, and staking', () => {
    const ctx = buildWalletContext(connectedStore as never);
    expect(ctx.connected).toBe(true);
    expect(ctx.adaBalance).toBe('1234.56');
    expect(ctx.tokenCount).toBe(1);
    expect(ctx.topHoldings).toEqual([{ ticker: 'SNEK', amount: '5' }]);
    expect(ctx.delegatedPool).toBe('pool1abcdef0000');
    expect(ctx.withdrawableRewardsAda).toBe('2.5');
    expect(ctx.summary).toMatch(/IS connected and unlocked/i);
    expect(ctx.summary).toMatch(/never ask them to connect/i);
    expect(ctx.summary).toMatch(/SNEK 5/);
  });

  it('reports not-connected when no wallet / locked', () => {
    expect(buildWalletContext({ loggedWallet: null, isLocked: false, tokens: {}, account: null } as never).connected).toBe(false);
    expect(buildWalletContext({ loggedWallet: { network: 'mainnet' }, isLocked: true, tokens: {}, account: null } as never).connected).toBe(false);
  });

  it('handles a wallet with no native tokens', () => {
    const ctx = buildWalletContext({
      loggedWallet: { network: 'preprod' },
      isLocked: false,
      tokens: { lovelace: { unit: 'lovelace', quantity: 0n } },
      account: null,
    } as never);
    expect(ctx.connected).toBe(true);
    expect(ctx.adaBalance).toBe('0');
    expect(ctx.tokenCount).toBe(0);
    expect(ctx.summary).toMatch(/Native tokens \(0\): none/);
    expect(ctx.summary).toMatch(/not delegated/);
  });
});
