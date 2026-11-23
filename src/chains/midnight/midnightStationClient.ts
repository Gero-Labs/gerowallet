// The three calls to Gero's fee station on Nexus.
//
//   challenge, vouchers: behind the device token, like the rest of the Midnight API.
//   submit: NO device token. It is authorized by the voucher alone. A device
//           token here would join the stake key (seen at issuance) to the
//           transaction, and the blind voucher would protect nothing.
//
// Every answer is validated field by field. Server text is never shown: a
// refusal is one of the fixed codes (midnightStationConfig.ts), anything else is
// "unavailable". PRIVACY: never log a voucher, a challenge or tx hex.

import { nexusMidnightPathFor } from './midnightConfig';
import { geroClientHeaders } from './midnightClientVersion';
import { normalizeMidnightTxHash } from './midnightTxHash';
import { MidnightStationError, isStationCode, type StationCode } from './midnightStationConfig';
import { STATION_MAX_BATCH } from './midnightStationVouchers';
import { getNexusAccessToken, reauthenticateNexus } from '@/services/nexusDevice.service';

const HEX_32_BYTES = /^[0-9a-f]{64}$/;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
/**
 * `expiresAt` is epoch MILLISECONDS. Anything below this (2001 in milliseconds; an epoch in
 * seconds is about 1.8e9) is an answer in another unit: refused as unreadable, not read as
 * a challenge that expired long ago.
 */
const MIN_EPOCH_MS = 1_000_000_000_000;
const CALL_TIMEOUT_MS = 30_000;
// Cloudflare in front of Nexus gives up at 100 s (as MIDNIGHT_SUBMIT_TIMEOUT_MS in midnight-api.ts).
const REDEEM_TIMEOUT_MS = 110_000;
/** How many times the same redeem bytes are posted before the answer counts as lost. */
export const STATION_REDEEM_ATTEMPTS = 3;
const REDEEM_RETRY_MS = 3_000;

interface Answer { status: number; data: unknown }

/** `null` when the request got no HTTP answer at all. */
async function post(url: string, body: unknown, token: string | undefined, timeoutMs: number): Promise<Answer | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
      headers: { 'Content-Type': 'application/json', ...geroClientHeaders(), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let data: unknown = null;
    try { data = await response.json(); } catch { /* not JSON */ }
    return { status: response.status, data };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** The named fields of a JSON object answer, each still unknown; null when the answer is not an object. */
type Fields<K extends string> = { readonly [P in K]?: unknown };
function fields<K extends string>(data: unknown): Fields<K> | null {
  return data !== null && typeof data === 'object' && !Array.isArray(data) ? data as Fields<K> : null;
}

function refusalOf(answer: Answer): StationCode | null {
  const code = fields<'code'>(answer.data)?.code;
  return isStationCode(code) ? code : null;
}

/** A device-token call. Logs in again once when the token is refused and the answer names no station code. */
async function authedPost(url: string, body: unknown): Promise<Answer> {
  let answer = await post(url, body, await getNexusAccessToken(), CALL_TIMEOUT_MS);
  if (answer && (answer.status === 401 || answer.status === 403) && !refusalOf(answer)) {
    answer = await post(url, body, await reauthenticateNexus(), CALL_TIMEOUT_MS);
  }
  if (!answer) throw new MidnightStationError('STATION_UNAVAILABLE');
  return answer;
}

export interface StationChallenge {
  eligible: boolean;
  /** Why not, when not eligible. */
  reason?: StationCode;
  /** Sends covered per day. */
  allowance: number;
  thresholdLovelace: string;
  /** The four below are empty or zero when not eligible. */
  challenge: string;
  /** Epoch milliseconds. */
  expiresAt: number;
  keyId: string;
  /** Base64 SPKI of the day's voucher key. */
  publicKey: string;
}

export async function fetchStationChallenge(network: string, stakeAddress: string): Promise<StationChallenge> {
  const answer = await authedPost(nexusMidnightPathFor(network, 'sponsor/challenge'), { stakeAddress });
  const data = fields<'eligible' | 'reason' | 'allowance' | 'thresholdLovelace' | 'challenge' | 'expiresAt' | 'keyId' | 'publicKey'>(answer.data);
  const unavailable = () => new MidnightStationError(refusalOf(answer) ?? 'STATION_UNAVAILABLE');
  if (answer.status !== 200 || !data) throw unavailable();
  const { eligible, reason, allowance, thresholdLovelace, challenge, expiresAt, keyId, publicKey } = data;
  if (typeof eligible !== 'boolean'
    || typeof allowance !== 'number' || !Number.isInteger(allowance) || allowance < 1 || allowance > STATION_MAX_BATCH
    || typeof thresholdLovelace !== 'string' || !/^\d+$/.test(thresholdLovelace)) throw unavailable();
  if (!eligible) {
    if (!isStationCode(reason)) throw unavailable();
    return { eligible: false, reason, allowance, thresholdLovelace, challenge: '', expiresAt: 0, keyId: '', publicKey: '' };
  }
  if (typeof challenge !== 'string' || !HEX_32_BYTES.test(challenge)
    || typeof expiresAt !== 'number' || !Number.isInteger(expiresAt) || expiresAt < MIN_EPOCH_MS
    || typeof keyId !== 'string' || !DAY.test(keyId)
    || typeof publicKey !== 'string' || !BASE64.test(publicKey)) throw unavailable();
  return { eligible: true, allowance, thresholdLovelace, challenge, expiresAt, keyId, publicKey };
}

export interface IssueVouchersRequest {
  stakeAddress: string;
  keyId: string;
  challenge: string;
  /** CIP-30 signData `signature`, hex. */
  coseSign1: string;
  /** CIP-30 signData `key`, hex. */
  coseKey: string;
  /** Base64 blinded messages. */
  blinded: string[];
}

/** The blind signatures for `request.blinded`, same order. Throws the server's refusal by its code. */
export async function issueStationVouchers(network: string, request: IssueVouchersRequest): Promise<string[]> {
  const answer = await authedPost(nexusMidnightPathFor(network, 'sponsor/vouchers'), request);
  const data = fields<'keyId' | 'blindSignatures'>(answer.data);
  const signatures = data?.blindSignatures;
  if (answer.status !== 200 || !data || data.keyId !== request.keyId || !Array.isArray(signatures)
    || signatures.length !== request.blinded.length
    || !signatures.every((item): item is string => typeof item === 'string' && BASE64.test(item))) {
    throw new MidnightStationError(refusalOf(answer) ?? 'STATION_UNAVAILABLE');
  }
  return signatures;
}

export interface RedeemVoucherRequest {
  keyId: string;
  /** Base64 prepared message. */
  message: string;
  /** Base64 voucher signature. */
  signature: string;
  /** The sealed, fee-less transaction. */
  signedTxHex: string;
}

export interface StationSubmitResult {
  /** Substrate extrinsic hash. */
  txHash: string;
  /** Ledger hash of the MERGED transaction: what history knows it by. */
  ledgerTxHash: string;
  status: 'Submitted' | 'InBlock' | 'Finalized';
  blockHeight?: number;
}

function paidResult(data: Fields<'txHash' | 'ledgerTxHash' | 'status' | 'blockHeight'> | null): StationSubmitResult | null {
  if (!data || typeof data.txHash !== 'string' || data.txHash.length === 0 || typeof data.ledgerTxHash !== 'string') return null;
  const ledgerTxHash = normalizeMidnightTxHash(data.ledgerTxHash);
  if (!HEX_32_BYTES.test(ledgerTxHash)) return null;
  if (data.status !== 'Submitted' && data.status !== 'InBlock' && data.status !== 'Finalized') return null;
  const blockHeight = typeof data.blockHeight === 'number' && Number.isInteger(data.blockHeight) ? data.blockHeight : undefined;
  return { txHash: data.txHash, ledgerTxHash, status: data.status, blockHeight };
}

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

/**
 * Hand the sealed transaction and one voucher to the station. No device token.
 *
 * A coded refusal is thrown at once. Anything else (no answer, a gateway error,
 * a 200 that cannot be read) is repeated with the SAME bytes: the station
 * answers a repeat of the same voucher and transaction with its first answer.
 * When that still gives nothing, the answer is lost (`STATION_NO_ANSWER`): the
 * transaction may have been submitted.
 */
export async function redeemStationVoucher(network: string, request: RedeemVoucherRequest): Promise<StationSubmitResult> {
  const url = nexusMidnightPathFor(network, 'sponsor/submit');
  for (let attempt = 1; attempt <= STATION_REDEEM_ATTEMPTS; attempt++) {
    const answer = await post(url, request, undefined, REDEEM_TIMEOUT_MS);
    if (answer) {
      const refusal = refusalOf(answer);
      if (refusal) throw new MidnightStationError(refusal);
      const paid = answer.status === 200 ? paidResult(fields(answer.data)) : null;
      if (paid) return paid;
    }
    if (attempt < STATION_REDEEM_ATTEMPTS) await sleep(REDEEM_RETRY_MS);
  }
  throw new MidnightStationError('STATION_NO_ANSWER');
}
