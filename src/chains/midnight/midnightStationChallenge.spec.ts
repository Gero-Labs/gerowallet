import { describe, expect, it } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import { blake2bHex } from 'blakejs';
import { COSEKey, COSESign1 } from '@emurgo/cardano-message-signing-browser';
import { Ed25519PrivateKey } from '@cardano-sdk/crypto';
import { Cardano } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { keyHashFromAddress } from '@/chrome/serialization';
import { CoseLabel } from '@/shared/utils/converter';
import { reservedSigningDomain, RESERVED_SIGNING_DOMAINS } from '@/shared/utils/reservedSigningDomains';
import { signStationChallenge, stakeAddressOf } from './midnightStationChallenge';
import { STATION_CHALLENGE_DOMAIN, buildStationChallengeSubject } from './midnightStationConfig';

// Synthetic key. Never fund.
const stakeKey = Ed25519PrivateKey.fromNormalBytes(new Uint8Array(32).fill(7));
const TESTNET = Cardano.NetworkId.Testnet;
const CHALLENGE = 'ab'.repeat(32);
const hex = (text: string) => Buffer.from(new TextEncoder().encode(text)).toString('hex');
const bytes = (value: string) => Uint8Array.from(Buffer.from(value, 'hex'));

describe('the station challenge proof', () => {
  const stake = stakeAddressOf(stakeKey, TESTNET);
  const subject = buildStationChallengeSubject('midnight-preprod', '2026-11-22', CHALLENGE, stake);

  it('names the network, the voucher key, the challenge and the stake address', () => {
    expect(stake.startsWith('stake_test1')).toBe(true);
    expect(subject).toBe(`gero-station/v1|ISSUE|midnight-preprod|2026-11-22|${CHALLENGE}|${stake}`);
  });

  it('is a CIP-8 signature a server can check: the key hashes to the stake address and signs the subject', async () => {
    const proof = await signStationChallenge(stakeKey, TESTNET, subject);
    expect(proof.stakeAddress).toBe(stake);
    const sign1 = COSESign1.from_bytes(bytes(proof.coseSign1));
    const key = COSEKey.from_bytes(bytes(proof.coseKey));
    const x = key.header(CoseLabel.x)!.as_bytes()!;
    const address = sign1.headers().protected().deserialized_headers().header(CoseLabel.address)!.as_bytes()!;
    expect(Cardano.Address.fromBytes(HexBlob(Buffer.from(address).toString('hex'))).toBech32()).toBe(stake);
    expect(blake2bHex(x, undefined, 28)).toBe(String(keyHashFromAddress(stake)));
    expect(Buffer.from(sign1.payload()!).toString('hex')).toBe(hex(subject));
    expect(await ed25519.verifyAsync(sign1.signature(), sign1.signed_data().to_bytes(), x)).toBe(true);
  });

  it('refuses a subject of another domain or for another stake address', async () => {
    await expect(signStationChallenge(stakeKey, TESTNET, `gero-support/v1|${stake}`)).rejects.toThrow('Not a station challenge');
    const other = stakeAddressOf(Ed25519PrivateKey.fromNormalBytes(new Uint8Array(32).fill(8)), TESTNET);
    await expect(signStationChallenge(stakeKey, TESTNET, buildStationChallengeSubject('midnight-preprod', '2026-11-22', CHALLENGE, other)))
      .rejects.toThrow('another stake address');
    // The same key on mainnet has another address: a preprod subject is not signed with it.
    await expect(signStationChallenge(stakeKey, Cardano.NetworkId.Mainnet, subject)).rejects.toThrow('another stake address');
  });

  it('is a reserved subject: no dApp gets one signed through signData', () => {
    expect(RESERVED_SIGNING_DOMAINS).toContain('gero-station/');
    expect(STATION_CHALLENGE_DOMAIN.startsWith('gero-station/')).toBe(true);
    expect(reservedSigningDomain(hex(subject))).toBe('gero-station/');
  });
});
