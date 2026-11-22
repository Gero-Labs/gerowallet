// Gero's fee station: Gero pays the DUST fee of a Midnight send for a wallet
// whose same-seed Cardano account stakes ADA. NOT the "sponsor" feature
// (midnightSponsor*.ts), where another wallet the user owns pays.
//
// Pure: codes, the build-time network gate and the code → copy table. Used by
// the worker and the pages.

import { Network } from '@/models/types';

/**
 * Networks where this build offers station-paid fees. A build-time gate beside
 * the UI flag (`isMidnightSponsoredFeesEnabled`) and the server's own switch:
 * a network absent here never calls the station, whatever the flag says.
 */
export const MIDNIGHT_STATION_NETWORKS: readonly string[] = [Network.PREPROD];

export function isStationNetwork(network: string | null | undefined): boolean {
  return typeof network === 'string' && MIDNIGHT_STATION_NETWORKS.includes(network);
}

/** Every code a station call can end with. The first two groups are the server's. */
const CODES = {
  // Why a stake account gets no vouchers (challenge and issue).
  NOT_REGISTERED: 'midnight.station.error.notEligible',
  NOT_DELEGATED: 'midnight.station.error.notEligible',
  BELOW_THRESHOLD: 'midnight.station.error.notEligible',
  ALREADY_ISSUED: 'midnight.station.error.notEligible',
  CHALLENGE_INVALID: 'midnight.station.error.unavailable',
  // Why the station did not pay for a transaction (submit).
  VOUCHER_INVALID: 'midnight.station.error.voucher',
  VOUCHER_SPENT: 'midnight.station.error.voucher',
  TX_NOT_ELIGIBLE: 'midnight.station.error.notEligibleTx',
  FEE_OVER_CAP: 'midnight.station.error.feeOverCap',
  BUDGET_EXHAUSTED: 'midnight.station.error.budget',
  STATION_OFF: 'midnight.station.error.off',
  STATION_BUSY: 'midnight.station.error.busy',
  // The wallet's own.
  /** Unreachable, or an answer that could not be read, BEFORE anything was handed over. */
  STATION_UNAVAILABLE: 'midnight.station.error.unavailable',
  /** The sealed transaction was posted and no readable answer came back: it may have been submitted. */
  STATION_NO_ANSWER: 'midnight.station.error.noAnswer',
  /** No usable voucher is stored. */
  STATION_NO_VOUCHER: 'midnight.station.error.voucher',
  /** The wallet record has no Cardano twin stake address, or it is not the key's. */
  NO_TWIN: 'midnight.station.error.unavailable',
} as const;

export type StationCode = keyof typeof CODES;

export function isStationCode(value: unknown): value is StationCode {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(CODES, value);
}

/** The `us.ts` key that says `code` to the user. Server text is never shown. */
export function stationCopyKey(code: StationCode): string {
  return CODES[code];
}

/** Whether the transaction may have been submitted although the send failed. */
export function stationSubmitUncertain(code: StationCode): boolean {
  return code === 'STATION_NO_ANSWER';
}

export class MidnightStationError extends Error {
  readonly code: StationCode;
  /** `text` is the user's-language message; without it the message is the code (worker side). */
  constructor(code: StationCode, text?: string) {
    super(text ?? code);
    this.name = 'MidnightStationError';
    this.code = code;
  }
}

export function isMidnightStationError(error: unknown): error is MidnightStationError {
  return error instanceof MidnightStationError;
}

/** The code of a station error; any other failure reads as the station being unavailable. */
export function stationCodeOfError(error: unknown): StationCode {
  return isMidnightStationError(error) ? error.code : 'STATION_UNAVAILABLE';
}

/**
 * The domain of the stake-key proof that asks for vouchers. Reserved
 * (reservedSigningDomains.ts): no dApp gets a subject under it signed.
 */
export const STATION_CHALLENGE_DOMAIN = 'gero-station/v1|ISSUE';

/**
 * The exact string the stake key signs (midnightStationChallenge.ts).
 * `networkSlug` is Nexus's Midnight network (`midnight-preprod`), `keyId` the
 * voucher key the batch is blinded for, `challenge` the server's nonce (hex).
 */
export function buildStationChallengeSubject(networkSlug: string, keyId: string, challenge: string, stakeAddress: string): string {
  return `${STATION_CHALLENGE_DOMAIN}|${networkSlug}|${keyId}|${challenge}|${stakeAddress}`;
}

/** The signed challenge, as a CIP-30 signData answer plus the address it is for. */
export interface StationChallengeProof {
  /** COSE_Sign1, hex: the CIP-30 `signature`. */
  readonly coseSign1: string;
  /** COSE_Key, hex: the CIP-30 `key`. */
  readonly coseKey: string;
  readonly stakeAddress: string;
}

/** What a page learns about the station before the user sends. Counts and reasons only. */
export interface StationStatus {
  /** A station-paid send can be offered now. */
  available: boolean;
  /** Vouchers already held and free to use. */
  remaining: number;
  /** Sends covered per day, when the server said. */
  allowance?: number;
  /** Why not, when `available` is false. */
  reason?: StationCode;
  /** The stake the Cardano account needs, in lovelace, when the server said. */
  thresholdLovelace?: string;
}
