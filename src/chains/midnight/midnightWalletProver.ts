/**
 * The `ProvingProvider` for a wallet-built transaction, from a
 * {@link WalletProvingRequest}: this device (midnightDeviceProver.ts) or a
 * native-API proof server (midnightLocalProver.ts). One place, so the
 * unshielded, shielded and dapp-balancing paths cannot disagree.
 */

import type * as ledger from '@midnight-ntwrk/ledger-v8';
import type * as ledger9 from '@midnightntwrk/ledger-v9';
import type { WalletProvingRequest } from './midnightProvingTarget';
import { resolveMidnightLedger } from './midnightChainLedger';
import { midnightNetworkName, type MidnightLedger } from './midnightLedger';

/** Inlined (not midnightProvingTarget's): this module stays free of that one's value imports. */
function isDeviceProving(request: WalletProvingRequest): request is { device: true } {
  return 'device' in request && request.device === true;
}

export async function walletProvingProvider(
  proving: WalletProvingRequest,
  options: {
    /** SDK network id ('preprod', 'mainnet', 'stagenet'). */
    sdkNetworkId: string;
    /**
     * The transaction's own ledger, when the caller decoded it. Otherwise the
     * chain's ledger is read for `sdkNetworkId`.
     */
    ledger?: MidnightLedger;
    /** Admit the Zswap circuits on this device (a shielded transaction). */
    shielded: boolean;
  },
): Promise<ledger.ProvingProvider & Partial<ledger9.ProvingProvider>> {
  const ledger = options.ledger ?? await resolveMidnightLedger(options.sdkNetworkId);
  if (isDeviceProving(proving)) {
    // The pinned keys are ledger 9's (generation 10 DUST); refuse before any preimage is made.
    if (ledger !== 9) {
      throw new Error(`On-device proving is not supported on Midnight ${midnightNetworkName(options.sdkNetworkId)} (ledger ${ledger}) in this version`);
    }
    // Loaded only when this device proves: a host bundle can shim it (gero-ios).
    const { makeDeviceProvingProvider } = await import('./midnightDeviceProver');
    return makeDeviceProvingProvider({ shielded: options.shielded });
  }
  const { makeLocalProvingProvider } = await import('./midnightLocalProver');
  return makeLocalProvingProvider(proving.url, { headers: proving.headers, sdkNetworkId: options.sdkNetworkId, ledger });
}

/** For logs: where a proof is made. A server URL, never its auth headers. */
export function describeWalletProving(proving: WalletProvingRequest): string {
  return isDeviceProving(proving) ? 'this device' : proving.url;
}
