// What the logged wallet's private (shielded) sync holds right now, by
// nullifier and commitment: enough for the swap records to tell whether a
// private offer's coins are still there (open), were spent (cancelled), or
// whether the coins it asked for arrived (taken). midnightPrivateSync.ts
// publishes it after each verified complete state and clears it when its
// wallet stops; the swap handlers read it.
//
// Worker memory only, never persisted: nullifiers and commitments link the
// wallet's private coins to transactions.

export interface MidnightPrivateCoinView {
  /** The active wallet key (unshielded address) the sync ran for. */
  readonly walletKey: string;
  /** Nullifiers of every coin the wallet holds (spendable or booked), lower-case hex. */
  readonly nullifiers: ReadonlySet<string>;
  /** Commitments of every coin the wallet holds or expects, lower-case hex. */
  readonly commitments: ReadonlySet<string>;
  /** When the state was published, epoch ms. */
  readonly at: number;
}

let current: MidnightPrivateCoinView | undefined;

export function publishMidnightPrivateCoins(view: MidnightPrivateCoinView | undefined): void {
  current = view;
}

/** The coins of `walletKey`'s private sync, or `undefined` when it has no complete state for that wallet. */
export function midnightPrivateCoins(walletKey: string | null | undefined): MidnightPrivateCoinView | undefined {
  return walletKey && current?.walletKey === walletKey ? current : undefined;
}
