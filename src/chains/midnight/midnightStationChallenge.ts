// The stake-key proof that asks Gero's fee station for a day's vouchers.
//
// A Midnight wallet's Cardano twin (same recovery phrase, same account) signs
// the server's challenge with its STAKE key as a CIP-8 message, through the
// same signer as a CIP-30 signData (`signDataCip8`). The subject is
// domain-separated and reserved (reservedSigningDomains.ts), so no dApp can
// get one signed through an ordinary sign-message prompt on the user's
// Cardano wallet.
//
// Background only: the stake key exists here for the length of one call.

import type { Ed25519PrivateKey } from '@cardano-sdk/crypto';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { Cardano } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { ChainDerivations } from '@/models/types';
import { signDataCip8 } from '@/chrome/serialization';
import { STATION_CHALLENGE_DOMAIN, type StationChallengeProof } from './midnightStationConfig';

/** The reward (stake) address `stakeKey` controls on the Cardano network with `networkId`. */
export function stakeAddressOf(stakeKey: Ed25519PrivateKey, networkId: Cardano.NetworkId): string {
  return Cardano.RewardAddress.fromCredentials(networkId, {
    type: Cardano.CredentialType.KeyHash,
    hash: Hash28ByteBase16(stakeKey.toPublic().hash().hex()),
  }).toAddress().toBech32();
}

/**
 * Sign `subject` with the twin stake key. The address in the COSE header is the
 * one the key itself controls, never one read from a record or a request.
 */
export async function signStationChallenge(
  stakeKey: Ed25519PrivateKey, networkId: Cardano.NetworkId, subject: string,
): Promise<StationChallengeProof> {
  if (!subject.startsWith(`${STATION_CHALLENGE_DOMAIN}|`)) throw new Error('Not a station challenge');
  const stakeAddress = stakeAddressOf(stakeKey, networkId);
  if (!subject.endsWith(`|${stakeAddress}`)) throw new Error('The station challenge names another stake address');
  const rewardAccount = stakeAddress as Cardano.RewardAccount;
  const publicKey = stakeKey.toPublic().hex();
  const { signature, key } = await signDataCip8(
    {
      derivePublicKey: async () => publicKey,
      signBlob: async (_path, blob) => ({ publicKey, signature: stakeKey.sign(HexBlob(blob)).hex() }),
    },
    // The one address this key signs for: its own reward account, at the stake role.
    [{
      type: ChainDerivations.CHIMERIC_ACCOUNT, index: 0, networkId, accountIndex: 0,
      address: stakeAddress as unknown as Cardano.PaymentAddress, rewardAccount,
    }],
    rewardAccount,
    Buffer.from(new TextEncoder().encode(subject)).toString('hex'),
  );
  return { coseSign1: signature, coseKey: key, stakeAddress };
}
