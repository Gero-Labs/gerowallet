import { walletStore } from '@/stores/walletStore';
import { featureFlagsStore } from '@/stores/featureFlagsStore';
import { Blockchain, WalletType } from '@/models/types';
import networks from '@/utils/networks';
import { isCip113SendHardware } from '@/utils/cip113Deployments';

/**
 * Whether Gero's own Send of a CIP-113 token is offered to the logged wallet: the
 * `isCip113Enabled` flag, a Cardano wallet that can sign it (password, PassKey, Sign in with
 * Google, or a hardware wallet listed in CIP113_SEND_HARDWARE_WALLET_TYPES, empty until each
 * device has passed a preprod run), and a network whose transfer scripts are configured
 * (preprod and preview).
 */
export function cip113SendAvailable(): boolean {
  const wallet = walletStore.loggedWallet;
  if (!wallet || !featureFlagsStore.isCip113Enabled()) return false;
  if (wallet.chain !== Blockchain.CARDANO) return false;
  const signer = wallet.type === WalletType.Normal
    || (wallet.type === WalletType.Google && wallet.encryptionMethod === 'mpc')
    || isCip113SendHardware(wallet.type);
  return signer && networks.resolveCip113TransferScripts(wallet.chain, wallet.network) !== null;
}

/**
 * Whether a row offers Send: a registered CIP-113 token (never the locked-ADA row, and
 * never a token merely sent to the programmable address), where Send is available.
 */
export function canSendProgrammable(row: { unit?: string; isProgrammable?: boolean } | null | undefined): boolean {
  return !!row && row.unit !== 'lovelace' && isCip113BadgeRow(row) && cip113SendAvailable();
}

/**
 * Which tooltip explains a locked (CIP-113) holdings row. Two different things carry
 * `isProgrammable`: the programmable token itself, and the ADA riding along in its UTxO —
 * ordinary ADA that is merely stuck there, priced and counted in the portfolio total unlike
 * the token. Where Send is available the token can be moved, so the copy says so. Returns
 * the key rather than the string so templates can call it directly.
 */
export function programmableTooltipKey(unit: string): string {
  const sendable = cip113SendAvailable();
  if (unit === 'lovelace') {
    return sendable ? 'programmableTokens.lockedAdaTooltipSendable' : 'programmableTokens.lockedAdaTooltip';
  }
  return sendable ? 'programmableTokens.badgeTooltipSendable' : 'programmableTokens.badgeTooltip';
}

/** The footnote under a holdings list that includes locked tokens. */
export function programmableListFootnoteKey(): string {
  return cip113SendAvailable() ? 'programmableTokens.listFootnoteSendable' : 'programmableTokens.listFootnote';
}

/**
 * Whether a row should be treated as a CIP-113 holding.
 *
 * Holdings rows carry `isProgrammable` from useHoldingsValuation, which is a computed and
 * therefore always current. Market rows do not: `allTokens` is a plain ref filled once per
 * fetch, and the market list normally loads BEFORE sync delivers the programmable UTxOs —
 * so a fetch-time stamp reads false for the whole window that matters and the swap widget
 * would render for a token Gero refuses to move. Consult the store as well, so the check
 * re-evaluates whenever `programmableTokens` lands.
 */
export function isProgrammableRow(row: { unit?: string; isProgrammable?: boolean } | null | undefined): boolean {
  if (!row) return false;
  if (row.isProgrammable) return true;
  if (!row.unit) return false;
  return Object.prototype.hasOwnProperty.call(walletStore.programmableTokens || {}, row.unit);
}

/**
 * Whether a row gets the CIP-113 badge: a locked row whose policy the CIP-113 registry lists
 * (issue 1267). Locked is not enough. Paying into the programmable address runs no validator,
 * so anyone can send any token there, and an unregistered one is shown as an ordinary
 * unverified token instead. It stays locked: isProgrammableRow() still keeps the swap widget
 * away from it. The locked-ADA row keeps its lock, which explains the ADA rather than vouching
 * for a token.
 */
export function isCip113BadgeRow(row: { unit?: string; isProgrammable?: boolean } | null | undefined): boolean {
  if (!isProgrammableRow(row)) return false;
  if (row?.unit === 'lovelace') return true;
  const held = (walletStore.programmableTokens || {})[row?.unit ?? ''] as { cip113Registered?: boolean } | undefined;
  return held?.cip113Registered === true;
}

/** What a locked row says about itself where it can't be swapped. */
export function lockedRowMessageKey(row: { unit?: string; isProgrammable?: boolean }): string {
  if (canSendProgrammable(row)) return 'programmableTokens.noSwapCanSend';
  if (row.unit === 'lovelace' || isCip113BadgeRow(row)) return programmableTooltipKey(row.unit ?? '');
  return 'programmableTokens.unregisteredTooltip';
}
