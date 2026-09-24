/**
 * What a TreasuryWithdrawals action pays out, read from its on-chain payload.
 *
 * The detail endpoint passes the ledger payload through as `govAction`, and for
 * this type it carries a MAP of reward address to lovelace. Verified against
 * mainnet through the production proxy on 2026-09-24 (`418df598…#0`):
 *
 *   { "type": "TREASURY_WITHDRAWALS_ACTION",
 *     "withdrawals": { "f1eb0699…e90558": 11787063000000 },
 *     "policyHash": "fa24fb30…" }
 *
 * The key is the raw 29-byte reward address in hex, which nobody can check by
 * eye, so it is re-encoded as the bech32 stake address the rest of the
 * ecosystem shows (Koios lists that same withdrawal as `stake1784sdxt6…`).
 * Amounts arrive as JSON numbers, or as decimal strings once they pass 16
 * digits (see `bigJson`), and are kept exact as BigInt.
 */

import { bech32 } from 'bech32';
import { toLovelace } from '@/shared/utils/lovelace';

export interface TreasuryWithdrawal {
  /** bech32 stake address when the key decodes to one, otherwise the key as sent. */
  rewardAddress: string;
  lovelace: bigint;
}

/** Header byte high nibble of a reward address: 0xE key hash, 0xF script hash. */
const REWARD_ADDRESS_TYPES = new Set([0xe, 0xf]);
const MAINNET = 1;
const TESTNET = 0;
/** bech32's default 90-char limit is for BIP-173; Cardano addresses are longer. */
const BECH32_LIMIT = 1000;

/**
 * A reward address in bech32 (`stake1…` / `stake_test1…`). A value that is
 * already bech32, or hex that is not a 29-byte reward address, comes back
 * unchanged: re-encoding something we did not recognise would be a guess.
 */
export function rewardAddressToBech32(raw: string): string {
  const value = raw.trim();
  if (!/^[0-9a-fA-F]{58}$/.test(value)) return value;
  const bytes: number[] = [];
  for (let i = 0; i < value.length; i += 2) bytes.push(parseInt(value.slice(i, i + 2), 16));
  const header = bytes[0];
  if (!REWARD_ADDRESS_TYPES.has(header >> 4)) return value;
  const network = header & 0x0f;
  if (network !== MAINNET && network !== TESTNET) return value;
  return bech32.encode(network === MAINNET ? 'stake' : 'stake_test', bech32.toWords(bytes), BECH32_LIMIT);
}

function isAmount(value: unknown): boolean {
  if (typeof value === 'bigint') return value >= 0n;
  if (typeof value === 'number') return Number.isInteger(value) && value >= 0;
  return typeof value === 'string' && /^\d+$/.test(value.trim());
}

/**
 * Each withdrawal, in payload order. Anything that is not the map shape above,
 * and any entry whose amount is not a whole lovelace count, is left out rather
 * than rendered as ₳0.
 */
export function treasuryWithdrawalsOf(govAction: unknown): TreasuryWithdrawal[] {
  if (!govAction || typeof govAction !== 'object') return [];
  const withdrawals = (govAction as Record<string, unknown>)['withdrawals'];
  if (!withdrawals || typeof withdrawals !== 'object' || Array.isArray(withdrawals)) return [];
  return Object.entries(withdrawals as Record<string, unknown>)
    .filter(([address, amount]) => address.trim() !== '' && isAmount(amount))
    .map(([address, amount]) => ({
      rewardAddress: rewardAddressToBech32(address),
      lovelace: toLovelace(amount as string | number | bigint),
    }));
}
