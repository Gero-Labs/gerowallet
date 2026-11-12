import { Cardano, Serialization } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { verifyTxIntent, type TxIntentViolation } from '@/shared/utils/txIntentGuard';

/**
 * Strike builds the deposit transaction (POST /v2/deposit/build-tx) from every
 * UTxO the wallet offers, so it is checked against the quote the user confirmed
 * before signing: exactly the quoted lovelace to the quoted deposit address (a
 * script address) and no tokens there; every other output back to the wallet;
 * no certificate, withdrawal, mint or collateral; only the wallet's own required
 * signers; a capped fee. Without this a compromised build endpoint could take
 * the whole wallet with one confirmed deposit, not just the quoted amount.
 *
 * Tolerances: the deposit output's datum, which the wallet has no reviewed
 * schema for (it carries Strike's request id); the inputs, which Strike selects
 * (outputs, fee and collateral are bounded, so an input can only add to what
 * returns to the wallet).
 *
 * The deposit address is only known from the quote, as for the withdraw
 * validator (strikeWithdrawGuard.ts): pinning it needs Strike's published V2
 * vault script hash per network, reviewed into a constant.
 */

export type StrikeDepositTxViolation = TxIntentViolation | 'depositNotScript' | 'invalidAmount' | 'undecodable';

function isScriptAddress(address: string): boolean {
  try {
    const props = Cardano.Address.fromBech32(address.trim()).getProps();
    return props.paymentPart?.type === Cardano.CredentialType.ScriptHash;
  } catch {
    return false;
  }
}

/** The quoted amount as positive lovelace, or null. Strike sends it as a decimal string. */
function quotedLovelace(amount: string | undefined): bigint | null {
  if (typeof amount !== 'string' || !/^\d+$/.test(amount)) return null;
  const lovelace = BigInt(amount);
  return lovelace > 0n ? lovelace : null;
}

/** Every way the built deposit departs from the confirmed quote; empty when it matches. */
export function verifyStrikeDepositTx(
  txCborHex: string,
  expectation: {
    depositAddress: string | undefined;
    /** The quote's `asset_symbol`: the amount is lovelace only for ADA. */
    assetSymbol: string | undefined;
    /** The quote's `asset_amount`, in lovelace. */
    lovelace: string | undefined;
    ownAddresses: Iterable<string>;
    ownKeyHashes: Iterable<string>;
  },
): StrikeDepositTxViolation[] {
  const { depositAddress } = expectation;
  if (!depositAddress || !isScriptAddress(depositAddress)) return ['depositNotScript'];
  const lovelace = quotedLovelace(expectation.lovelace);
  if (lovelace == null || expectation.assetSymbol?.toUpperCase() !== 'ADA') return ['invalidAmount'];
  let tx: Cardano.Tx;
  try {
    tx = Serialization.Transaction.fromCbor(HexBlob(txCborHex)).toCore();
  } catch {
    return ['undecodable'];
  }
  return verifyTxIntent(tx, {
    outputs: [],
    boundedOutputs: [{ address: depositAddress, minLovelace: lovelace, maxLovelace: lovelace }],
    ownAddresses: expectation.ownAddresses,
    requiredSigners: expectation.ownKeyHashes,
  });
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
