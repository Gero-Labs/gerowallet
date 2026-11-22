// The stake-key proof that asks Gero's fee station for a day's vouchers.
//
// A Midnight wallet's Cardano twin (same recovery phrase, same account) signs
// the server's challenge with its STAKE key as a CIP-8 message, exactly like a
// CIP-30 signData. The subject is domain-separated and reserved
// (reservedSigningDomains.ts), so no dApp can get one signed through an
// ordinary sign-message prompt on the user's Cardano wallet.
//
// Background only: the stake key exists here for the length of one call.

import type { Ed25519PrivateKey } from '@cardano-sdk/crypto';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { Cardano } from '@cardano-sdk/core';
import { buildSignatureAndCoseKey } from '@/shared/utils/converter';

export const STATION_CHALLENGE_DOMAIN = 'gero-station/v1|ISSUE';

/**
 * The exact string the stake key signs. `networkSlug` is Nexus's Midnight
 * network (`midnight-preprod`), `keyId` the voucher key the batch is blinded
 * for, `challenge` the server's nonce (hex).
 */
export function buildStationChallengeSubject(networkSlug: string, keyId: string, challenge: string, stakeAddress: string): string {
  return `${STATION_CHALLENGE_DOMAIN}|${networkSlug}|${keyId}|${challenge}|${stakeAddress}`;
}

/** The reward (stake) address `stakeKey` controls on the Cardano network with `networkId`. */
export function stakeAddressOf(stakeKey: Ed25519PrivateKey, networkId: Cardano.NetworkId): string {
  return Cardano.RewardAddress.fromCredentials(networkId, {
    type: Cardano.CredentialType.KeyHash,
    hash: Hash28ByteBase16(stakeKey.toPublic().hash().hex()),
  }).toAddress().toBech32();
}

export interface StationChallengeProof {
  /** COSE_Sign1, hex: the CIP-30 `signature`. */
  readonly coseSign1: string;
  /** COSE_Key, hex: the CIP-30 `key`. */
  readonly coseKey: string;
  readonly stakeAddress: string;
}

/**
 * Sign `subject` with the twin stake key. The address in the COSE header is the
 * one the key itself controls, never one read from a record or a request.
 */
export function signStationChallenge(stakeKey: Ed25519PrivateKey, networkId: Cardano.NetworkId, subject: string): StationChallengeProof {
  if (!subject.startsWith(`${STATION_CHALLENGE_DOMAIN}|`)) throw new Error('Not a station challenge');
  const stakeAddress = stakeAddressOf(stakeKey, networkId);
  if (!subject.endsWith(`|${stakeAddress}`)) throw new Error('The station challenge names another stake address');
  const addressBytes = Buffer.from(Cardano.Address.fromBech32(stakeAddress).toBytes(), 'hex');
  const payloadHex = Buffer.from(new TextEncoder().encode(subject)).toString('hex');
  const { signature, key } = buildSignatureAndCoseKey(addressBytes, payloadHex, stakeKey);
  return { coseSign1: signature, coseKey: String(key), stakeAddress };
}
