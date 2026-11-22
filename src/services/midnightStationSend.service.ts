/**
 * A Midnight unshielded send whose DUST fee Gero's fee station pays
 * (browser/options context). The fourth pipeline beside the three in
 * midnight-tx.service.ts:
 *
 *   1. getWalletKeys        publicKeyHex + addressHex
 *   2. Nexus builds         the unproven transfer, as for a normal send
 *   3. MIDNIGHT_STATION_SEAL    the worker gets the day's vouchers if it holds
 *                               none, checks the transaction and seals it with NO fee
 *   4. MIDNIGHT_STATION_REDEEM  the worker hands the sealed bytes and one voucher
 *                               to the station, which pays, merges and submits
 *
 * No DUST sync and no proof on this side: the station proves its own fee.
 */

import { Messaging } from '@/chrome/messaging';
import { MessageTypes } from '@/models/MessageTypes';
import { getMidnightApi, type BuildMidnightTxRequest, type SubmitMidnightTxResponse } from '@/api/midnight-api';
import { StaleApprovalError } from '@/shared/composables/useApprovalFreshness';
import { assertMidnightWritesOpen } from '@/chains/midnight/midnightWriteStatus';
import {
  MidnightStationError, isStationCode, stationCopyKey, type StationCode, type StationStatus,
} from '@/chains/midnight/midnightStationConfig';
import i18n from '@/plugins/i18n';
import {
  backgroundError, getWalletKeys, type MidnightSendCredentials, type MidnightSendStage,
} from './midnight-tx.service';

const UNAVAILABLE: StationStatus = { available: false, remaining: 0, reason: 'STATION_UNAVAILABLE' };

/** The worker's status answer as it crosses the message boundary: every field is checked before use. */
interface StatusReply {
  success?: unknown; available?: unknown; remaining?: unknown; allowance?: unknown; reason?: unknown; thresholdLovelace?: unknown;
}

/** A station code said in the user's language. */
function stationError(code: StationCode): MidnightStationError {
  return new MidnightStationError(code, String(i18n.t(stationCopyKey(code))));
}

/** Whether Gero's fee station can pay for the logged wallet's next send. Never throws. */
export async function getMidnightStationStatus(): Promise<StationStatus> {
  try {
    const response = await Messaging.sendToBackgroundFromOptions({
      method: MessageTypes.MIDNIGHT_STATION_STATUS,
      data: {},
    }) as { data?: StatusReply };
    const data = response?.data;
    if (!data?.success) return UNAVAILABLE;
    return {
      available: data.available === true,
      remaining: typeof data.remaining === 'number' && Number.isInteger(data.remaining) && data.remaining > 0 ? data.remaining : 0,
      allowance: typeof data.allowance === 'number' && Number.isInteger(data.allowance) ? data.allowance : undefined,
      reason: isStationCode(data.reason) ? data.reason : undefined,
      thresholdLovelace: typeof data.thresholdLovelace === 'string' && /^\d+$/.test(data.thresholdLovelace) ? data.thresholdLovelace : undefined,
    };
  } catch {
    return UNAVAILABLE;
  }
}

function assertCurrent(current: () => boolean): void {
  if (!current()) throw new StaleApprovalError();
}

interface SealReply { success: boolean; sealedTxHex?: string; txIdentifiers?: unknown; error?: string }
interface RedeemReply {
  success: boolean; txHash?: string; ledgerTxHash?: string; status?: SubmitMidnightTxResponse['status'];
  blockHeight?: number; remaining?: number; error?: string;
}

/**
 * Send with the fee paid by Gero's fee station. Throws `MidnightStationError`
 * (message in the user's language) for a station refusal; its code says
 * whether the transaction may have been submitted (`stationSubmitUncertain`).
 */
export async function sendUnshieldedViaStation(
  network: string,
  baseRequest: Omit<BuildMidnightTxRequest, 'publicKeyHex' | 'addressHex'>,
  credentials: MidnightSendCredentials,
  onStage?: (stage: MidnightSendStage) => void,
  current: () => boolean = () => true,
): Promise<SubmitMidnightTxResponse & { stationRemaining: number }> {
  assertCurrent(current);
  // Sends on a paused network stop here, before keys or the build (midnightWriteGate.ts).
  await assertMidnightWritesOpen(network);
  assertCurrent(current);
  onStage?.('authorizing');
  const { publicKeyHex, addressHex } = await getWalletKeys(credentials);
  assertCurrent(current);
  onStage?.('building');
  const built = await getMidnightApi(network).buildUnshieldedTx({ ...baseRequest, publicKeyHex, addressHex });
  assertCurrent(current);
  onStage?.('working');
  const sealResponse = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.MIDNIGHT_STATION_SEAL,
    data: {
      unprovenTxHex: built.unprovenTxHex,
      // What was asked of Nexus: the worker seals only a transaction that is exactly this.
      intendedOutputs: baseRequest.outputs.map(({ address, amount, token }) => ({ address, amount, token })),
      password: credentials.password,
      prfSecret: credentials.prfSecret ? Array.from(credentials.prfSecret) : undefined,
    },
  }) as { data?: SealReply };
  const sealed = sealResponse?.data;
  if (!sealed?.success || !sealed.sealedTxHex) {
    if (isStationCode(sealed?.error)) throw stationError(sealed.error);
    throw backgroundError(sealed?.error, 'Midnight signing failed');
  }
  assertCurrent(current);
  onStage?.('submitting');
  const redeemResponse = await Messaging.sendToBackgroundFromOptions({
    method: MessageTypes.MIDNIGHT_STATION_REDEEM,
    data: { sealedTxHex: sealed.sealedTxHex, ttlMs: baseRequest.ttlMs },
  }) as { data?: RedeemReply };
  const paid = redeemResponse?.data;
  if (!paid?.success || !paid.txHash || !paid.ledgerTxHash || !paid.status) {
    if (isStationCode(paid?.error)) throw stationError(paid.error);
    throw new Error(paid?.error || String(i18n.t(stationCopyKey('STATION_NO_ANSWER'))));
  }
  onStage?.('done');
  return {
    txHash: paid.txHash,
    ledgerTxHash: paid.ledgerTxHash,
    status: paid.status,
    blockHeight: paid.blockHeight,
    stationRemaining: typeof paid.remaining === 'number' ? paid.remaining : 0,
  };
}
