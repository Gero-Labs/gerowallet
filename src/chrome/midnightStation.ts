// Gero's fee station, worker side: is it available, get the day's vouchers,
// spend one on a sealed transaction. The message handlers in background.ts are
// thin wrappers around these three.
//
// Vouchers stay in the worker and its private store. A page learns counts and
// reason codes only.

import { getMidnightEndpoints } from '@/chains/midnight/midnightConfig';
import {
  MidnightStationError, buildStationChallengeSubject, isStationNetwork, stationCodeOfError,
  type StationChallengeProof, type StationStatus,
} from '@/chains/midnight/midnightStationConfig';
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
/** How long after sealing a transaction may be redeemed. A send expires after 5 minutes. */
const SEALED_MEMORY_MS = 10 * 60_000;

/**
 * The transactions this worker sealed for the station, by their first identifier. In memory
 * only: a redeem spends a voucher of the user's daily allowance, so it is done only for bytes
 * the SEAL step produced for the same wallet a moment ago, never for bytes a page hands over.
 * A worker restart between the two steps forgets them; the send then fails with nothing sent.
 */
const sealedHere = new Map<string, { network: string; stakeAddress: string; until: number }>();

/** Remember a transaction this worker just sealed for the wallet whose twin is `stakeAddress`. */
export function rememberSealedForStation(
  network: string, stakeAddress: string, identifiers: readonly string[], now: number = Date.now(),
): void {
  for (const [identifier, entry] of sealedHere) if (entry.until <= now) sealedHere.delete(identifier);
  const txIdentifier = identifiers[0];
  if (txIdentifier) sealedHere.set(txIdentifier, { network, stakeAddress, until: now + SEALED_MEMORY_MS });
}

/** Test seam: forget every sealed transaction. */
export function forgetSealedForStationForTests(): void {
  sealedHere.clear();
}

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
  const sealed = sealedHere.get(txIdentifier);
  if (!sealed || sealed.network !== network || sealed.stakeAddress !== stakeAddress || sealed.until <= deps.now()) {
    throw new MidnightStationError('SEAL_UNKNOWN');
  }
  for (let attempt = 0; attempt < MAX_VOUCHER_TRIES; attempt++) {
    const voucher = await reserveVoucher(network, stakeAddress, txIdentifier, ttlMs + RESERVATION_MARGIN_MS, deps.now());
    if (!voucher) throw new MidnightStationError('STATION_NO_VOUCHER');
    try {
      const result = await deps.client.redeemStationVoucher(network, {
        keyId: voucher.keyId, message: voucher.message, signature: voucher.signature, signedTxHex: sealedTxHex,
      });
      await dropVoucher(network, stakeAddress, voucher.message, deps.now());
      // Paid: these bytes are not redeemed again.
      sealedHere.delete(txIdentifier);
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
