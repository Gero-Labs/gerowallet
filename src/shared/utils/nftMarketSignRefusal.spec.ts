import { describe, expect, it } from 'vitest';
import { NFT_MARKET_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';
import { NFT_MARKET_EXPIRED_KEY, NFT_MARKET_SIGN_FROM_MARKET_KEY, marketSignRefusalKey } from './nftMarketSignRefusal';

describe('marketSignRefusalKey', () => {
  it('maps the worker refusal text, as a string or an Error, to the expired copy for a market caller', () => {
    expect(NFT_MARKET_EXPIRED_KEY).toBe('nftMarket.error.expired');
    expect(marketSignRefusalKey(NFT_MARKET_SIGN_REFUSAL_MESSAGE, 'market')).toBe(NFT_MARKET_EXPIRED_KEY);
    expect(marketSignRefusalKey(new Error(NFT_MARKET_SIGN_REFUSAL_MESSAGE), 'market')).toBe(NFT_MARKET_EXPIRED_KEY);
  });

  it('maps it to its own copy for any other caller, the default: nothing was started and nothing expired', () => {
    expect(NFT_MARKET_SIGN_FROM_MARKET_KEY).toBe('nftMarket.error.signFromMarket');
    expect(marketSignRefusalKey(NFT_MARKET_SIGN_REFUSAL_MESSAGE)).toBe(NFT_MARKET_SIGN_FROM_MARKET_KEY);
    expect(marketSignRefusalKey(new Error(NFT_MARKET_SIGN_REFUSAL_MESSAGE), 'other')).toBe(NFT_MARKET_SIGN_FROM_MARKET_KEY);
  });

  it('maps no other text', () => {
    expect(marketSignRefusalKey('Gero cannot sign something else')).toBeNull();
    expect(marketSignRefusalKey('Gero cannot sign something else', 'market')).toBeNull();
    expect(marketSignRefusalKey(`${NFT_MARKET_SIGN_REFUSAL_MESSAGE}.`)).toBeNull();
    expect(marketSignRefusalKey(undefined)).toBeNull();
    expect(marketSignRefusalKey(null)).toBeNull();
  });
});
