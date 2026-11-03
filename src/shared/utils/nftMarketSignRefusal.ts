import { NFT_MARKET_SIGN_REFUSAL_MESSAGE } from '@/chrome/nftMarket/marketAllowance';

/** The i18n key the worker's market signing refusal (its allowance or dApp pass ran out) is shown as. */
export const NFT_MARKET_EXPIRED_KEY = 'nftMarket.error.expired';

/**
 * The i18n key for the worker's market signing refusal, or null for any other text. The worker
 * throws the refusal as a fixed English string; Gero's own market flows reach it as the page
 * failure `EXPIRED`, and the dApp approval screens (side panel and popup) meet the text itself
 * through `friendlyTxError`, which maps it here.
 */
export function marketSignRefusalKey(message: unknown): string | null {
  const text = message instanceof Error ? message.message : message;
  return text === NFT_MARKET_SIGN_REFUSAL_MESSAGE ? NFT_MARKET_EXPIRED_KEY : null;
}
