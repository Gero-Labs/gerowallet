/**
 * Human-readable mapping for the two transaction failure classes users hit most
 * and understand least: missing Plutus collateral, and insufficient ADA. Every
 * on-chain flow (send, staking, governance, swap, dApp approval, DUST) can route
 * its raw build/submit error through {@link friendlyTxError} so the user sees an
 * actionable message instead of a raw Nexus/ledger string.
 *
 * Localized via the shared i18n instance (all callers run in a UI context, so
 * the user's locale is active). Anything not recognized is returned unchanged.
 */
import i18n from '@/plugins/i18n';

/**
 * True when the error is the user lacking a pure-ADA UTxO for script collateral.
 * Single source of truth for the pattern — DUST's mapDustBuildError() delegates
 * here so the two paths can't drift on what counts as a collateral error.
 */
export function isCollateralError(message: string): boolean {
  const l = message.toLowerCase();
  // "pool empty" is a Nexus shared-pool infra state, not the user's wallet.
  if (l.includes('collateral pool')) return false;
  // Nexus's insufficient-ADA message NAMES the bucket it counted ("available in
  // non-collateral UTxOs: 2.1 ADA"), so a bare 'collateral' substring match hijacks
  // it and tells the user to create an ADA-only UTxO when what they actually need is
  // more ADA. Defer to the more specific classifier — mapErrorMessage checks this
  // function first, so without the guard the insufficient-ADA branch is unreachable
  // for that message.
  if (isInsufficientAdaError(l)) return false;
  return l.includes('collateral') || l.includes('pure-ada') || l.includes('pure ada');
}

/** True when the tx can't be covered by the wallet's ADA (fees / min-UTxO / inputs). */
export function isInsufficientAdaError(message: string): boolean {
  const l = message.toLowerCase();
  // Don't hijack native-token shortfalls — those are a separate, self-explanatory case.
  if (l.includes('token')) return false;
  return /insufficient ada|insufficient input|utxo balance insufficient|not enough ada|minimum utxo|value ?not ?conserved/.test(l);
}

/**
 * Map a raw tx build/submit error to a friendly, localized message. Returns the
 * original message unchanged when it isn't a collateral / insufficient-ADA error.
 */
export function friendlyTxError(raw: unknown): string {
  const message = raw instanceof Error ? raw.message : String(raw ?? '');
  const l = message.toLowerCase();

  // Nexus's shared collateral pool is exhausted — transient infra, retryable.
  if (l.includes('collateral pool')) return i18n.t('errors.collateralPoolEmpty') as string;
  if (isCollateralError(message)) return i18n.t('errors.noCollateral') as string;
  if (isInsufficientAdaError(message)) return i18n.t('errors.insufficientAdaForTx') as string;
  return message;
}
