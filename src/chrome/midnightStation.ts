// Gero's fee station, worker side: is it available, get the day's vouchers,
// spend one on a sealed transaction. The message handlers in background.ts are
// thin wrappers around these three.
//
// Vouchers stay in the worker and its private store. A page learns counts and
// reason codes only.

import { getMidnightEndpoints } from '@/chains/midnight/midnightConfig';
import {
  MidnightStationError, isStationNetwork, stationCodeOfError, type StationStatus,
} from '@/chains/midnight/midnightStationConfig';
import { buildStationChallengeSubject, type StationChallengeProof } from '@/chains/midnight/midnightStationChallenge';
import {
  fetchStationChallenge, issueStationVouchers, redeemStationVoucher, type StationSubmitResult,
} from '@/chains/midnight/midnightStationClient';
import {
  STATION_MAX_BATCH, addVouchers, blindBatch, countFreeVouchers, dropVoucher, finalizeBatch, importStationKey,
  releaseVoucher, reserveVoucher, voucherKeyUsable,
} from '@/chains/midnight/midnightStationVouchers';

/** Injected so the flows are tested without a server. */
export interface StationDeps {
  now: () => number;
  client: {
    fetchStationChallenge: typeof fetchStationChallenge;
    issueStationVouchers: typeof issueStationVouchers;
    redeemStationVoucher: typeof redeemStationVoucher;
  };
}

const defaultDeps: StationDeps = {
  now: () => Date.now(),
  client: { fetchStationChallenge, issueStationVouchers, redeemStationVoucher },
};

/** A reservation outlives the transaction's expiry by this much: after it, the voucher is tried on another send. */
const RESERVATION_MARGIN_MS = 60_000;
/** Vouchers tried for one transaction when the station calls them spent or invalid. */
const MAX_VOUCHER_TRIES = 3;

function networkSlug(network: string): string {
  const endpoints = getMidnightEndpoints(network);
  if (!endpoints) throw new MidnightStationError('STATION_OFF');
  return `midnight-${endpoints.sdkNetworkId}`;
}

const off = (reason: StationStatus['reason']): StationStatus => ({ available: false, remaining: 0, reason });

/**
 * Whether a station-paid send can be offered. Needs no credential. The server
 * is asked only while no voucher is held.
 */
export async function midnightStationStatus(
  network: string, stakeAddress: string | undefined, deps: StationDeps = defaultDeps,
): Promise<StationStatus> {
  if (!isStationNetwork(network)) return off('STATION_OFF');
  if (!stakeAddress) return off('NO_TWIN');
  try {
    const remaining = await countFreeVouchers(network, stakeAddress, deps.now());
    if (remaining > 0) return { available: true, remaining };
    const challenge = await deps.client.fetchStationChallenge(network, stakeAddress);
    return challenge.eligible
      ? { available: true, remaining: 0, allowance: challenge.allowance, thresholdLovelace: challenge.thresholdLovelace }
      : {
        available: false, remaining: 0, reason: challenge.reason ?? 'STATION_UNAVAILABLE',
        allowance: challenge.allowance, thresholdLovelace: challenge.thresholdLovelace,
      };
  } catch (error) {
    return off(stationCodeOfError(error));
  }
}

/**
 * Make sure a free voucher is held, issuing the day's batch when none is.
 * `sign` signs the challenge subject with the wallet's Cardano twin stake key;
 * it is called only when a batch is issued, and only after the server said
 * the account is eligible.
 */
export async function ensureStationVouchers(
  network: string,
  stakeAddress: string,
  sign: (subject: string) => Promise<StationChallengeProof>,
  deps: StationDeps = defaultDeps,
): Promise<void> {
  if (!isStationNetwork(network)) throw new MidnightStationError('STATION_OFF');
  if (await countFreeVouchers(network, stakeAddress, deps.now()) > 0) return;
  const challenge = await deps.client.fetchStationChallenge(network, stakeAddress);
  if (!challenge.eligible) throw new MidnightStationError(challenge.reason ?? 'STATION_UNAVAILABLE');
  if (!voucherKeyUsable(challenge.keyId, deps.now()) || challenge.expiresAt <= deps.now()) {
    throw new MidnightStationError('STATION_UNAVAILABLE');
  }
  let key: CryptoKey;
  try {
    key = await importStationKey(challenge.publicKey);
  } catch {
    throw new MidnightStationError('STATION_UNAVAILABLE');
  }
  const pending = await blindBatch(key, Math.min(challenge.allowance, STATION_MAX_BATCH));
  const proof = await sign(buildStationChallengeSubject(networkSlug(network), challenge.keyId, challenge.challenge, stakeAddress));
  // The key signs for the address it controls: it must be the one vouchers are kept under.
  if (proof.stakeAddress !== stakeAddress) throw new MidnightStationError('NO_TWIN');
  const blindSignatures = await deps.client.issueStationVouchers(network, {
    stakeAddress, keyId: challenge.keyId, challenge: challenge.challenge,
    coseSign1: proof.coseSign1, coseKey: proof.coseKey, blinded: pending.blinded,
  });
  let issued: Awaited<ReturnType<typeof finalizeBatch>>;
  try {
    issued = await finalizeBatch(key, challenge.keyId, pending, blindSignatures);
  } catch {
    throw new MidnightStationError('STATION_UNAVAILABLE');
  }
  await addVouchers(network, stakeAddress, issued, deps.now());
}

/**
 * Spend one voucher on the sealed transaction. `identifiers` are the sealed
 * transaction's own; the voucher is held under the first, so a repeat of the
 * same transaction reuses the same voucher (the station answers it again).
 */
export async function redeemSealedWithStation(
  network: string,
  stakeAddress: string,
  sealedTxHex: string,
  identifiers: readonly string[],
  ttlMs: number,
  deps: StationDeps = defaultDeps,
): Promise<StationSubmitResult & { remaining: number }> {
  if (!isStationNetwork(network)) throw new MidnightStationError('STATION_OFF');
  const txIdentifier = identifiers[0];
  if (!txIdentifier) throw new MidnightStationError('TX_NOT_ELIGIBLE');
  for (let attempt = 0; attempt < MAX_VOUCHER_TRIES; attempt++) {
    const voucher = await reserveVoucher(network, stakeAddress, txIdentifier, ttlMs + RESERVATION_MARGIN_MS, deps.now());
    if (!voucher) throw new MidnightStationError('STATION_NO_VOUCHER');
    try {
      const result = await deps.client.redeemStationVoucher(network, {
        keyId: voucher.keyId, message: voucher.message, signature: voucher.signature, signedTxHex: sealedTxHex,
      });
      await dropVoucher(network, stakeAddress, voucher.message, deps.now());
      return { ...result, remaining: await countFreeVouchers(network, stakeAddress, deps.now()) };
    } catch (error) {
      const code = stationCodeOfError(error);
      if (code === 'VOUCHER_SPENT' || code === 'VOUCHER_INVALID') {
        await dropVoucher(network, stakeAddress, voucher.message, deps.now());
        continue;
      }
      // A lost answer: the station may have submitted. The voucher stays held for this transaction.
      if (code !== 'STATION_NO_ANSWER') await releaseVoucher(network, stakeAddress, voucher.message, deps.now());
      throw error;
    }
  }
  throw new MidnightStationError('STATION_NO_VOUCHER');
}
