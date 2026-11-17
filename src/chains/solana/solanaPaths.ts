/**
 * Solana derivation paths. Dependency-free so hardware-wallet modules can import it.
 *
 * Solana uses ed25519 with SLIP-0010, where every level is hardened. The path every
 * mainstream wallet (Phantom, Solflare, Backpack, Ledger Live) uses for account `n` is
 * `m/44'/501'/n'/0'`, so a phrase restored in Gero shows the same addresses as there.
 * Solana uses the same coin type on every cluster: there is no testnet coin type.
 */

export const SOLANA_COIN_TYPE = 501;

/** BIP-32/SLIP-0010 hardened offset. */
export const HARDENED_OFFSET = 0x80000000;

/** Hardened index list for account `account`: [44', 501', account', 0']. */
export function solanaAccountPathIndexes(account = 0): number[] {
  if (!Number.isInteger(account) || account < 0 || account >= HARDENED_OFFSET) {
    throw new Error(`Invalid Solana account index: ${account}`);
  }
  return [44, SOLANA_COIN_TYPE, account, 0].map((i) => i + HARDENED_OFFSET);
}

/** Human-readable path for account `account`, e.g. `m/44'/501'/0'/0'`. */
export function solanaAccountPath(account = 0): string {
  solanaAccountPathIndexes(account);
  return `m/44'/${SOLANA_COIN_TYPE}'/${account}'/0'`;
}
