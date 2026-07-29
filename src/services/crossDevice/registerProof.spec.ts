import { describe, it, expect } from 'vitest';
import { Ed25519PrivateKey, Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { Cardano } from '@cardano-sdk/core';
import { buildSignatureAndCoseKey } from '@/shared/utils/converter';
import { buildDeviceRegisterSubject, verifyDeviceRegisterProof, type DeviceRegisterProof } from './registerProof';
import { deviceIdFromPubKey } from './deviceIdentity';

// A fixed relay-auth identity (NOT the wallet key) that the proof is about.
const RELAY_PUB = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const DEVICE_ID = deviceIdFromPubKey(RELAY_PUB);

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function utf8ToHex(s: string): string {
  return Buffer.from(new TextEncoder().encode(s)).toString('hex');
}

/** Deterministic wallet STAKE key from a seed byte. */
function walletStakeKey(seed: number): Ed25519PrivateKey {
  return Ed25519PrivateKey.fromNormalBytes(new Uint8Array(32).fill(seed));
}

/** The reward (stake) bech32 address for a wallet stake key, mainnet. */
function rewardAddressOf(key: Ed25519PrivateKey): string {
  const hash = Hash28ByteBase16(key.toPublic().hash().hex());
  return Cardano.RewardAddress.fromCredentials(Cardano.NetworkId.Mainnet, {
    type: Cardano.CredentialType.KeyHash,
    hash,
  }).toAddress().toBech32();
}

function rewardAddressBytes(bech32: string): Uint8Array {
  return hexToBytes(Cardano.Address.fromBech32(bech32).toBytes());
}

/**
 * Produce a proof by signing the DEVICE_REGISTER subject with `signerKey` while
 * placing `headerAddress` in the COSE header. For an honest proof, signerKey is
 * the wallet key OWNING headerAddress. For the forgery test, they diverge.
 */
function makeProof(signerKey: Ed25519PrivateKey, headerBech32: string, subject: string): DeviceRegisterProof {
  const { signature, key } = buildSignatureAndCoseKey(
    rewardAddressBytes(headerBech32),
    utf8ToHex(subject),
    signerKey,
  );
  return { coseSign1: signature, coseKey: String(key), stakeAddress: headerBech32 };
}

describe('verifyDeviceRegisterProof', () => {
  it('accepts an honest proof (wallet key signs, key-binds to its own reward address)', async () => {
    const wallet = walletStakeKey(7);
    const stake = rewardAddressOf(wallet);
    const subject = buildDeviceRegisterSubject(DEVICE_ID, RELAY_PUB, stake);
    const proof = makeProof(wallet, stake, subject);

    const ok = await verifyDeviceRegisterProof(proof, { deviceId: DEVICE_ID, pubKey: RELAY_PUB }, stake);
    expect(ok).toBe(true);
  });

  it('REJECTS the forgery: attacker key + victim public reward address (key-binding fails)', async () => {
    const victim = walletStakeKey(7);
    const victimStake = rewardAddressOf(victim);
    const attacker = walletStakeKey(66);
    // Attacker signs the correct subject with THEIR key but stamps the VICTIM's
    // reward address into the COSE header (its address is public).
    const subject = buildDeviceRegisterSubject(DEVICE_ID, RELAY_PUB, victimStake);
    const forged = makeProof(attacker, victimStake, subject);

    const ok = await verifyDeviceRegisterProof(forged, { deviceId: DEVICE_ID, pubKey: RELAY_PUB }, victimStake);
    expect(ok).toBe(false); // blake2b224(attacker x) != victim stake key-hash
  });

  it('rejects a proof for a different wallet (own-stake mismatch)', async () => {
    const wallet = walletStakeKey(7);
    const stake = rewardAddressOf(wallet);
    const subject = buildDeviceRegisterSubject(DEVICE_ID, RELAY_PUB, stake);
    const proof = makeProof(wallet, stake, subject);

    const otherStake = rewardAddressOf(walletStakeKey(9));
    const ok = await verifyDeviceRegisterProof(proof, { deviceId: DEVICE_ID, pubKey: RELAY_PUB }, otherStake);
    expect(ok).toBe(false);
  });

  it('rejects when the signed subject is for a different relay pubkey/deviceId', async () => {
    const wallet = walletStakeKey(7);
    const stake = rewardAddressOf(wallet);
    // Signs a subject binding a DIFFERENT relay pubkey than the device we check.
    const otherPub = 'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff';
    const subject = buildDeviceRegisterSubject(deviceIdFromPubKey(otherPub), otherPub, stake);
    const proof = makeProof(wallet, stake, subject);

    const ok = await verifyDeviceRegisterProof(proof, { deviceId: DEVICE_ID, pubKey: RELAY_PUB }, stake);
    expect(ok).toBe(false);
  });

  it('rejects missing / malformed proof (fail closed)', async () => {
    const stake = rewardAddressOf(walletStakeKey(7));
    const dev = { deviceId: DEVICE_ID, pubKey: RELAY_PUB };
    expect(await verifyDeviceRegisterProof(undefined, dev, stake)).toBe(false);
    expect(await verifyDeviceRegisterProof({ coseSign1: 'zz', coseKey: 'zz', stakeAddress: stake }, dev, stake)).toBe(false);
  });
});

// Shared conformance vector — the STANDARD CIP-30 signData structure that both
// iOS (CardanoKit) and our own walletBg.signData (Cardano SDK, per the CIP-30 standard)
// emit: protected header {1:-8, "address":addr} with NO key_id. Inputs: wallet
// STAKE key = 32 bytes of 0x01 (mainnet), relay-auth pubkey = RELAY_PUB,
// deviceId = 4884fdaafea47c29fea7159d0daddd9c. The COSE_Key + reward address are
// byte-identical across clients (so the blake2b224(x)==stake-key-hash binding
// aligns); the COSE_Sign1 is the canonical CIP-30 structure and the verifier
// is generic over the header layout (verifies the message's own Sig_structure).
const VEC_STAKE = 'stake1uyxk54m7j3q6mrkevcunryrwf4p7e68c93cjk8gzxkhlkpswtcyrc';
const VEC_COSE_KEY = 'a5010102581de10d6a577e9441ad8ed9663931906e4d43ece8f82c712b1d0235affb06032720062158208a88e3dd7409f195fd52db2d3cba5d72ca6709bf1d94121bf3748801b40f6f5c';
// the canonical CIP-30 COSE_Sign1 (standard CIP-30 signData; no key_id in protected).
const VEC_COSE_SIGN1 = '84582aa201276761646472657373581de10d6a577e9441ad8ed9663931906e4d43ece8f82c712b1d0235affb06a166686173686564f458ba6765726f2d786465762f76317c4445564943455f52454749535445527c34383834666461616665613437633239666561373135396430646164646439637c303132333435363738396162636465663031323334353637383961626364656630313233343536373839616263646566303132333435363738396162636465667c7374616b65317579786b35346d376a3371366d726b657663756e7279727766347037653638633933636a6b38677a786b686c6b70737774637972635840dae7f6bb4dacc10439b9f868c445fa3a1b2e072947ddafe2052afa49eafccc3335dfb3e400853457e061a24d96f1de5cde495ccc9dadd18c19f8351d419fd10a';

describe('DEVICE_REGISTER proof conformance (byte-for-byte with iOS)', () => {
  it('reproduces the reward address + COSE_Key (the binding input) exactly', () => {
    const wallet = walletStakeKey(1);
    const stake = rewardAddressOf(wallet);
    expect(stake).toBe(VEC_STAKE);
    const subject = buildDeviceRegisterSubject(DEVICE_ID, RELAY_PUB, stake);
    const proof = makeProof(wallet, stake, subject);
    expect(proof.coseKey).toBe(VEC_COSE_KEY);
  });

  it('verifies the iOS standard-CIP-30 proof (generic over the COSE_Sign1 layout)', async () => {
    const proof: DeviceRegisterProof = { coseSign1: VEC_COSE_SIGN1, coseKey: VEC_COSE_KEY, stakeAddress: VEC_STAKE };
    expect(await verifyDeviceRegisterProof(proof, { deviceId: DEVICE_ID, pubKey: RELAY_PUB }, VEC_STAKE)).toBe(true);
  });
});
