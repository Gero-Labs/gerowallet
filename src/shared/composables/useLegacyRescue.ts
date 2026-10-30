import { MessageTypes } from '@/models/MessageTypes';
import { usePreparedTxFlow, type PreparedTxFlowOptions } from '@/shared/composables/usePreparedTxFlow';
import type { LegacyCancelSummary } from '@/chrome/legacyCancelVerify';

/**
 * Rescue of a closed marketplace's stuck listings, page side (options and side panel).
 *
 * `prepare(refs)` sends only the `txHash#index` refs the user picked. The worker
 * (LEGACY_LISTING_PREPARE_CANCEL) checks they belong to the wallet, has Nexus build the
 * cancel, verifies the CBOR and answers `{ success, result: { txCbor, txId, summary } }` or
 * `{ success: false, errorCode }`. `failure.code` is then that errorCode: one of the
 * worker's (NOT_OWNED, VERIFY_FAILED, WALLET_UNSUPPORTED, NETWORK_UNSUPPORTED, …) or a Nexus
 * 422 code it passed through (LISTING_NOT_FOUND when an item was spent since the list was
 * read, NOT_LEGACY_LISTING, EVALUATION_FAILED, …).
 *
 * Signing and submitting is the shared usePreparedTxFlow: the CBOR is signed and submitted
 * exactly as the worker returned it, never re-encoded, and collateral Nexus lent
 * (`summary.sponsoredCollateralRef`) gets its pool co-signature. Which wallet types may
 * reach a device is the worker's call, not this file's.
 */

export type LegacyRescueOptions = Pick<PreparedTxFlowOptions, 'getIsBT'>;

export function useLegacyRescue(options: LegacyRescueOptions = {}) {
  const flow = usePreparedTxFlow<LegacyCancelSummary>({ getIsBT: options.getIsBT });

  /** Have the worker build and verify the cancel of these refs. True when a summary is ready to review. */
  function prepare(refs: string[]): Promise<boolean> {
    return flow.prepare(MessageTypes.LEGACY_LISTING_PREPARE_CANCEL, { refs });
  }

  return { ...flow, prepare };
}
