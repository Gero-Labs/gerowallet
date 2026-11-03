import { describe, expect, it } from 'vitest';
import { NFT_MARKET_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import { NFT_MARKET_EXPIRED_KEY, marketSignRefusalKey } from './nftMarketSignRefusal';

describe('marketSignRefusalKey', () => {
  it('maps the worker refusal text, as a string or an Error, to the expired copy', () => {
    expect(NFT_MARKET_EXPIRED_KEY).toBe('nftMarket.error.expired');
    expect(marketSignRefusalKey(NFT_MARKET_SIGN_REFUSAL_MESSAGE)).toBe(NFT_MARKET_EXPIRED_KEY);
    expect(marketSignRefusalKey(new Error(NFT_MARKET_SIGN_REFUSAL_MESSAGE))).toBe(NFT_MARKET_EXPIRED_KEY);
  });

  it('maps no other text', () => {
    expect(marketSignRefusalKey('Gero cannot sign something else')).toBeNull();
    expect(marketSignRefusalKey(`${NFT_MARKET_SIGN_REFUSAL_MESSAGE}.`)).toBeNull();
    expect(marketSignRefusalKey(undefined)).toBeNull();
    expect(marketSignRefusalKey(null)).toBeNull();
  });
});
