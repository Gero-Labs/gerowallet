import { NFT_MARKET_SIGN_REFUSAL_MESSAGE } from '@/chrome/config';

/**
 * The i18n key the worker's market signing refusal is shown as where an approval ran out: Gero's
 * own market flows (the page failure `EXPIRED`: the allowance of a prepared transaction was spent
 * or expired) and the dApp approval screens (a dApp's market transaction is signable only under the
 * approval it was previewed with).
 */
export const NFT_MARKET_EXPIRED_KEY = 'nftMarket.error.expired';

/**
 * The i18n key for everywhere else. A plain Gero Send, a staking or a governance transaction that
 * touches a listing script is refused as well, and nothing took too long there: the transaction is
 * not one to sign from that screen.
 */
export const NFT_MARKET_SIGN_FROM_MARKET_KEY = 'nftMarket.error.signFromMarket';

/** Who meets the refusal: a market approval (an allowance or a dApp pass ran out), or any other flow of the wallet. */
export type MarketRefusalCaller = 'market' | 'other';

/**
 * The i18n key for the worker's market signing refusal, or null for any other text. The worker
 * throws the refusal as a fixed English string; Gero's own market flows reach it as the page
 * failure `EXPIRED`, and the dApp approval screens (side panel and popup) and every other signing
 * screen meet the text itself through `friendlyTxError`, which maps it here. `caller` defaults to
 * 'other': a screen that has not said it is a market approval never claims something expired.
 */
export function marketSignRefusalKey(message: unknown, caller: MarketRefusalCaller = 'other'): string | null {
  const text = message instanceof Error ? message.message : message;
  if (text !== NFT_MARKET_SIGN_REFUSAL_MESSAGE) return null;
  return caller === 'market' ? NFT_MARKET_EXPIRED_KEY : NFT_MARKET_SIGN_FROM_MARKET_KEY;
}
