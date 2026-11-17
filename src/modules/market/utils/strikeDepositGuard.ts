import { Cardano } from '@cardano-sdk/core';
import {
  verifySpendBound,
  type OwnWalletView,
  type TxIntentViolation,
} from '@/shared/utils/txIntentGuard';

/**
 * Strike builds the deposit transaction (POST /v2/deposit/build-tx) from every
 * UTxO the wallet offers, so before signing it is held to the quote the user
 * confirmed. Without this a compromised build endpoint could take the whole
 * wallet with one confirmed deposit, not just the quoted amount.
 *
 * Where the ADA goes cannot be checked: for an ADA deposit the transaction pays
 * an exchanger address Strike creates during build-tx (Strike's strike-deposit
 * reference), not the quote's `deposit_address`. So the check is a spend bound,
 * as for a DEX order: what leaves the wallet is at most the quoted lovelace plus
 * {@link STRIKE_DEPOSIT_MAX_EXTRA_LOVELACE}, and the network fee (capped); no
 * token leaves; every input is one the wallet holds, valued from the transaction
 * that created it (provenInputs.ts), never from the UTxO list. On top of the
 * bound: no certificate, withdrawal, vote, mint or collateral, and no required
 * signer but the wallet's own keys.
 */

/**
 * Lovelace a build may send beyond the quoted amount: what an exchanger output
 * may need on top (its own costs or minimum). A compromised builder gains at
 * most this over the deposit the user agreed to give Strike.
 */
export const STRIKE_DEPOSIT_MAX_EXTRA_LOVELACE = 10_000_000n;

export type StrikeDepositTxViolation = TxIntentViolation | 'invalidAmount';

/** The quoted amount as positive lovelace, or null. Strike sends it as a decimal string. */
function quotedLovelace(amount: string | undefined): bigint | null {
  if (typeof amount !== 'string' || !/^\d+$/.test(amount)) return null;
  const lovelace = BigInt(amount);
  return lovelace > 0n ? lovelace : null;
}

function hasEntries(value: unknown): boolean {
  if (value == null) return false;
  if (value instanceof Map) return value.size > 0;
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === 'object' && Object.keys(value as object).length > 0;
}

/** Every way the built deposit departs from the confirmed quote; empty when it fits. */
export function verifyStrikeDepositTx(
  tx: Cardano.Tx,
  expectation: OwnWalletView & {
    /** The quote's `asset_symbol`: the amount is lovelace only for ADA. */
    assetSymbol: string | undefined;
    /** The quote's `asset_amount`, in lovelace. */
    lovelace: string | undefined;
    /** Key hashes that may be required signers (derivedOwnKeyHashes). */
    ownKeyHashes: Iterable<string>;
  },
): StrikeDepositTxViolation[] {
  const lovelace = quotedLovelace(expectation.lovelace);
  if (lovelace == null || expectation.assetSymbol?.toUpperCase() !== 'ADA') return ['invalidAmount'];

  const violations = new Set<StrikeDepositTxViolation>(
    verifySpendBound(tx, expectation, {
      maxOutflow: new Map([['lovelace', lovelace + STRIKE_DEPOSIT_MAX_EXTRA_LOVELACE]]),
    }),
  );
  const body = tx.body;
  // The spend bound tolerates these for DEX orders; a deposit has no use for them.
  if (hasEntries(body.mint)) violations.add('unexpectedMint');
  if (hasEntries(body.collaterals) || body.collateralReturn || body.totalCollateral != null) {
    violations.add('unexpectedCollateral');
  }
  const ownKeys = new Set(Array.from(expectation.ownKeyHashes, (h) => h.toLowerCase()));
  if ((body.requiredExtraSignatures ?? []).some((h) => !ownKeys.has(String(h).toLowerCase()))) {
    violations.add('unexpectedRequiredSigner');
  }
  return [...violations];
}

/**
 * Whether a Strike expiry (Unix seconds, or milliseconds by magnitude, as
 * useStrikeDeposit's countdown reads it) has passed. An absent expiry is not
 * expired; one that is present but unreadable is.
 */
export function isStrikeQuoteExpired(expiresAt: number | null | undefined, nowMs: number = Date.now()): boolean {
  if (expiresAt == null) return false;
  if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) return true;
  const expiresMs = expiresAt > 1e12 ? expiresAt : expiresAt * 1000;
  return expiresMs <= nowMs;
}
