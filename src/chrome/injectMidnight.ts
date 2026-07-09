// Midnight DApp Connector — page-context provider.
// Spec: @midnight-ntwrk/dapp-connector-api@4.0.1
// Verified against the installed package's dist/*.d.ts and the fetched
// SPECIFICATION.md (see docs/midnight/2026-07-09-midnight-dapp-connector-plan.md).
//
// This module runs in the page's MAIN world (same bundle as inject.ts's CIP-30
// provider) and installs `window.midnight[uuid]` per the spec's discovery
// protocol. It talks to the wallet ONLY through midnightWebpage.ts's bridge
// functions (postMessage → content script → background) — no wallet secrets
// are ever reachable from this file.

import * as bridge from './midnightWebpage';
import { GERO_CARDANO_ICON } from './injectIcon';
import { MidnightErrorCode } from './config';
import type {
  ConnectedAPI,
  InitialAPI,
} from '@midnight-ntwrk/dapp-connector-api';

// Must match the pinned npm package version exactly — dapps semver-match
// against this string to decide compatibility (SPECIFICATION.md §Initial API
// point 7 and 11: "must report exact version of the package it implemented").
const MIDNIGHT_CONNECTOR_API_VERSION = '4.0.1';
const MIDNIGHT_WALLET_RDNS = 'io.gerowallet.midnight';

declare global {
  interface Window {
    midnight?: Record<string, InitialAPI>;
  }
}

function apiError(code: string, reason: string): Error & { type: string; code: string; reason: string } {
  const err = new Error(reason) as Error & { type: string; code: string; reason: string };
  err.type = 'DAppConnectorAPIError';
  err.code = code;
  err.reason = reason;
  return err;
}

/** Methods whose server-side implementation is Phase 2/3 (see build plan §4). */
function notYetImplemented(methodName: string): () => Promise<never> {
  return () => Promise.reject(apiError(
    MidnightErrorCode.InternalError,
    `${methodName} is not yet implemented by GeroWallet's connector (planned)`,
  ));
}

function buildConnectedAPI(): ConnectedAPI {
  const api: ConnectedAPI = {
    getShieldedBalances: () => bridge.midnightGetShieldedBalances(),
    getUnshieldedBalances: () => bridge.midnightGetUnshieldedBalances(),
    getDustBalance: () => bridge.midnightGetDustBalance(),
    getShieldedAddresses: () => bridge.midnightGetShieldedAddresses(),
    getUnshieldedAddress: () => bridge.midnightGetUnshieldedAddress(),
    getDustAddress: () => bridge.midnightGetDustAddress(),
    getTxHistory: (pageNumber, pageSize) => bridge.midnightGetTxHistory(pageNumber, pageSize),
    getConfiguration: () => bridge.midnightGetConfiguration(),
    getConnectionStatus: () => bridge.midnightGetConnectionStatus(),
    submitTransaction: (tx) => bridge.midnightSubmitTransaction(tx),
    signData: (data, options) => bridge.midnightSignData(data, options),
    hintUsage: (methodNames) => bridge.midnightHintUsage(methodNames),
    // Phase 2/3 — present (so the object stays structurally assignable to the
    // real ConnectedAPI type real dapps import) but reject until implemented.
    // Spec prose: "The connected API consists of a couple of parts, each
    // always present" — omitting them would both break that contract and
    // TypeScript structural compatibility for dapps typed against the SDK.
    balanceUnsealedTransaction: notYetImplemented('balanceUnsealedTransaction'),
    balanceSealedTransaction: notYetImplemented('balanceSealedTransaction'),
    makeTransfer: notYetImplemented('makeTransfer'),
    makeIntent: notYetImplemented('makeIntent'),
    getProvingProvider: notYetImplemented('getProvingProvider'),
  };
  return Object.freeze(api);
}

const initialAPI: InitialAPI = Object.freeze({
  rdns: MIDNIGHT_WALLET_RDNS,
  name: 'GeroWallet',
  icon: GERO_CARDANO_ICON,
  apiVersion: MIDNIGHT_CONNECTOR_API_VERSION,
  async connect(networkId: string): Promise<ConnectedAPI> {
    // Under the current background.ts contract, decline/error paths reject
    // the underlying Messaging.sendToContent promise (with a properly-shaped
    // APIError) rather than resolving `data: false` — so `approved` in
    // practice is only ever `true`, and this `await` throws before the
    // `!approved` branch below can run. Kept as a defensive invariant check
    // (not dead code to delete): if a future change to the background
    // handler ever legitimately resolves `{data: false}` instead of
    // rejecting, this still fails safely instead of returning a live
    // ConnectedAPI for a connection that was never actually approved.
    const approved = await bridge.midnightConnect(networkId);
    if (!approved) {
      throw apiError(MidnightErrorCode.Rejected, 'User declined the connection request');
    }
    return buildConnectedAPI();
  },
});

/**
 * Install `window.midnight[uuid]` per SPECIFICATION.md §Initial API points
 * 1-4: first wallet locks the container against tampering; every wallet
 * (including us) installs under a fresh UUIDv4 key with a frozen, immutable
 * property descriptor. `enumerable: true` is required — the documented
 * discovery pattern is `Object.values(window.midnight ?? {})`.
 */
function installMidnightProvider(): void {
  try {
    if (!window.midnight) {
      Object.defineProperty(window, 'midnight', {
        value: Object.create(null),
        writable: false,
        configurable: false,
      });
    }
    Object.defineProperty(window.midnight!, crypto.randomUUID(), {
      configurable: false,
      writable: false,
      enumerable: true,
      value: initialAPI,
    });
  } catch (e) {
    console.error('[Gero] Midnight connector install failed:', e);
  }
}

installMidnightProvider();
