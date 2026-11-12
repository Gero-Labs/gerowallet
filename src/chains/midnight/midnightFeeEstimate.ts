/**
 * What the send review shows for the DUST fee before the transaction exists.
 *
 * The exact fee is computed in the background during DUST balancing, after
 * authorization. Until ledger 9 the review showed "< 0.000001": fees were a
 * few Specks. Ledger 9 adds a fee floor (`min_block_price`) and a new cost
 * model: measured with Preview's ledger 9 parameters, a 1-input unshielded
 * NIGHT transfer costs about 0.57 DUST and a 2-input one about 0.59 DUST
 * (midnightDustLightLedger9.spends.spec.ts pins that it stays under 1 DUST).
 * So the review says "< 1". A per-send estimate from the chain's current
 * parameters would be better and is left for later.
 */
import { MIDNIGHT_DECIMALS } from './midnightTypes';

export const MIDNIGHT_DUST_FEE_ESTIMATE_DISPLAY = '< 1';

/** What a send can need for its fee, in Specks: 1 DUST, the bound the review shows. */
export const MIDNIGHT_DUST_FEE_CEILING = 10n ** BigInt(MIDNIGHT_DECIMALS.DUST);

/**
 * Whether `balance` (Specks) may not cover a send's fee. Ledger 8 fees were a
 * few Specks; ledger 9's are around 0.6 DUST, so the review warns below 1 DUST,
 * not only at zero.
 */
export function dustShortForFee(balance: bigint): boolean {
  return balance < MIDNIGHT_DUST_FEE_CEILING;
}
