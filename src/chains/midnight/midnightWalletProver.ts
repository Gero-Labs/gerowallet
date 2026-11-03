/**
 * The `ProvingProvider` for a wallet-built transaction, from a
 * {@link WalletProvingRequest}: this device (midnightDeviceProver.ts) or a
 * native-API proof server (midnightLocalProver.ts). One place, so the
 * unshielded, shielded and dapp-balancing paths cannot disagree.
 */

import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type * as ledger9 from '@midnightntwrk/ledger-v9';
import { isDeviceProving, type WalletProvingRequest } from './midnightProvingTarget';
import { requireMidnightLedger8 } from './midnightLedger';
import { makeDeviceProvingProvider } from './midnightDeviceProver';

export async function walletProvingProvider(
  proving: WalletProvingRequest,
  options: {
    /** SDK network id ('preprod', 'mainnet', 'stagenet'). */
    sdkNetworkId?: string;
    /** Admit the Zswap circuits on this device (a shielded transaction). */
    shielded: boolean;
  },
): Promise<ledger.ProvingProvider & Partial<ledger9.ProvingProvider>> {
  if (isDeviceProving(proving)) {
    // The pinned keys are the ledger-8 set; refuse before any preimage is made.
    requireMidnightLedger8(options.sdkNetworkId ?? 'mainnet', 'On-device proving');
    return makeDeviceProvingProvider({ shielded: options.shielded });
  }
  const { makeLocalProvingProvider } = await import('./midnightLocalProver');
  return makeLocalProvingProvider(proving.url, { headers: proving.headers, sdkNetworkId: options.sdkNetworkId });
}

/** For logs: where a proof is made. A server URL, never its auth headers. */
export function describeWalletProving(proving: WalletProvingRequest): string {
  return isDeviceProving(proving) ? 'this device' : proving.url;
}
