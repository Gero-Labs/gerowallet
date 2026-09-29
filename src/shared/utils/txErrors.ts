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
import { CIP113_SIGN_REFUSAL_MESSAGE, TX_SUBMIT_UNCONFIRMED_MESSAGE } from '@/chrome/config';

type JsonRecord = Record<string, unknown>;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryParseJsonObject(text: string): JsonRecord | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function firstSentence(text: string): string {
  const trimmed = text.trim();
  const match = /^(.*?[.!?])(?:\s|$)/.exec(trimmed);
  return match ? match[1] : trimmed;
}

/**
 * "Ogmios rejected transaction (400 BAD_REQUEST): {json}" → the node's own
 * `error.message`, cut to its first sentence (the rest is a protocol essay and,
 * for value-size rejections, every asset in the offending output).
 */
function unwrapOgmiosRejection(message: string): string {
  const brace = message.indexOf('{');
  if (brace < 0) return message;
  const inner = tryParseJsonObject(message.slice(brace));
  const error = inner ? inner['error'] : undefined;
  const nodeMessage = isRecord(error) ? error['message'] : undefined;
  return typeof nodeMessage === 'string' && nodeMessage.trim() ? firstSentence(nodeMessage) : message;
}

/**
 * The backend answers a rejected submission with plain text, not JSON:
 * `Ogmios rejected tx: Invalid transaction; It looks like ...`. Keep the node's own
 * sentence and drop our prefix; only cut to the first sentence when the remainder is
 * one of Ogmios's protocol essays, so a short rejection keeps the numbers in it.
 */
const OGMIOS_PLAIN_PREFIX = 'Ogmios rejected tx:';
const OGMIOS_FULL_TEXT_LIMIT = 300;

function unwrapPlainOgmiosRejection(message: string): string {
  const at = message.indexOf(OGMIOS_PLAIN_PREFIX);
  if (at < 0) return message;
  const reason = message.slice(at + OGMIOS_PLAIN_PREFIX.length).trim();
  if (!reason) return message;
  return reason.length <= OGMIOS_FULL_TEXT_LIMIT ? reason : firstSentence(reason);
}

/**
 * Recover the human sentence from a Nexus error that reached the UI as raw JSON.
 *
 * `parseHttpError` stringifies the whole axios response (`{data, headers, status}`)
 * and Nexus wraps provider errors in its own envelope, so a node rejection can reach
 * a dialog as kilobytes of nested JSON — a customer registering for DUST on
 * 2026-09-15 saw Ogmios 3120 ("Some output values in the transaction are too large")
 * followed by every asset in the rejected output. Walk back down to the message:
 * the Nexus `message` (or a plain-text body), then the embedded node message for an
 * Ogmios rejection. Anything that isn't such an envelope is returned unchanged.
 */
export function extractNexusErrorMessage(raw: string): string {
  const envelope = tryParseJsonObject(raw);
  if (!envelope) return raw;
  const data = envelope['data'];
  if (typeof data === 'string' && data.trim()) return data;
  const body = isRecord(data) ? data : envelope;
  const message = [body['message'], body['error'], envelope['message']]
    .find((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return message ? unwrapOgmiosRejection(message) : raw;
}

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
  const message = unwrapPlainOgmiosRejection(
    extractNexusErrorMessage(raw instanceof Error ? raw.message : String(raw ?? '')),
  );
  const l = message.toLowerCase();

  // The CIP-113 signing refusal is thrown from the background as a fixed English
  // string, so it has to be mapped back to a key here or a non-English user sees it raw.
  if (message === CIP113_SIGN_REFUSAL_MESSAGE) return i18n.t('programmableTokens.signRefused') as string;

  // We never learned the transaction's fate (5xx / no response), which is NOT the
  // same as it being rejected -- the localized copy has to keep that uncertainty.
  // Same fixed-English-string contract as the CIP-113 refusal above.
  if (message.startsWith(TX_SUBMIT_UNCONFIRMED_MESSAGE)) return i18n.t('errors.submitUnconfirmed') as string;

  // Nexus's shared collateral pool is exhausted — transient infra, retryable.
  if (l.includes('collateral pool')) return i18n.t('errors.collateralPoolEmpty') as string;
  if (isCollateralError(message)) return i18n.t('errors.noCollateral') as string;
  if (isInsufficientAdaError(message)) return i18n.t('errors.insufficientAdaForTx') as string;
  return message;
}
