import { Blockchain } from '@/models/types';
import { isNftMarketHardware } from '@/utils/nftMarketDeployments';

/** Wallet types that sign in the worker with a key the wallet holds (password and PassKey are both `Normal`). */
const SOFTWARE_WALLET_TYPES: ReadonlySet<string> = new Set(['Normal', 'Google']);

/**
 * Whether a wallet of this chain and type may use Gero's NFT market at all: a Cardano wallet that
 * signs in the worker (password, PassKey, Google) or a hardware wallet type listed in
 * NFT_MARKET_HARDWARE_WALLET_TYPES (empty until each device has signed a real market transaction).
 * Never a watch wallet, whatever list is passed.
 *
 * The one predicate behind both sides: the worker's prepare handlers (marketPrepare.ts) refuse a
 * wallet it says no to, and the pages (nftMarketAvailability.ts) offer the market's actions only
 * where it says yes, so a button is never shown that the worker would turn down. The network side
 * of the gate (a reviewed deployment) and the `isNftMarketEnabled` flag are separate: see there.
 */
export function canUseNftMarketWallet(
  chain: string | null | undefined,
  walletType: string | null | undefined,
  hardwareTypes?: readonly string[],
): boolean {
  if (chain !== Blockchain.CARDANO || typeof walletType !== 'string') return false;
  if (SOFTWARE_WALLET_TYPES.has(walletType)) return true;
  return hardwareTypes === undefined ? isNftMarketHardware(walletType) : isNftMarketHardware(walletType, hardwareTypes);
}
