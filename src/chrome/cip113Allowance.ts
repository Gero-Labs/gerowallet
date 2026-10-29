// The one CIP-113 transfer the wallet may sign: granted by CIP113_PREPARE_TRANSFER after the
// background verified Nexus's transaction (cip113VerifyTransfer.ts), consumed by the one
// signature WalletBg.signTx makes for it.
//
// Keyed on the transaction id (the hash of the body the user reviewed), never on the
// message: Gero's own flows and the dApp approval screens send the same SIGN_TX, so only an
// identical body can use it. One slot, held in the worker's memory: a new prepare replaces
// it, a wallet switch or a worker restart loses it (the user builds again), and it expires
// after CIP113_ALLOWANCE_TTL_MS. Only WalletBg.signTx consumes it; the dApp-facing refusals
// (refusalForProgrammableInputs) never read it.

/** How long a verified transfer may wait for its signature. */
export const CIP113_ALLOWANCE_TTL_MS = 5 * 60_000;

interface Allowance {
  walletId: number;
  txId: string;
  /** `txId#index` of the programmable UTxOs the transfer spends. */
  refs: ReadonlySet<string>;
  expiresAt: number;
}

let allowance: Allowance | null = null;

/** Allow `walletId` to sign `txId` once, spending these programmable UTxOs. Replaces any earlier grant. */
export function grantCip113SignAllowance(walletId: number, txId: string, refs: Iterable<string>, now = Date.now()): void {
  allowance = { walletId, txId, refs: new Set(refs), expiresAt: now + CIP113_ALLOWANCE_TTL_MS };
}

/** Whether signing `txId` with these programmable inputs is allowed, without using it up. */
export function hasCip113SignAllowance(walletId: number, txId: string, hits: readonly string[], now = Date.now()): boolean {
  if (!allowance) return false;
  if (now >= allowance.expiresAt) {
    allowance = null;
    return false;
  }
  const { refs } = allowance;
  return allowance.walletId === walletId
    && allowance.txId === txId
    && hits.length > 0
    && hits.every((hit) => refs.has(hit));
}

/** As hasCip113SignAllowance, and the allowance is gone afterwards whatever the answer. */
export function consumeCip113SignAllowance(walletId: number, txId: string, hits: readonly string[], now = Date.now()): boolean {
  const allowed = hasCip113SignAllowance(walletId, txId, hits, now);
  allowance = null;
  return allowed;
}

export function clearCip113SignAllowance(): void {
  allowance = null;
}
