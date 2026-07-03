// Cross-device signing — authenticated DEVICE_REGISTER proof (wallet-control).
//
// A device proves it controls the wallet by signing its relay-auth pubkey with
// the WALLET's stake key (CIP-8 / COSE_Sign1). Sibling devices verify the proof
// themselves (the relay stays untrusted) before pairing. This closes the
// trust-on-first-use gap where anyone who knows the PUBLIC stake address could
// register a device under the wallet.
//
// SECURITY-CRITICAL: the load-bearing step is the key-binding — blake2b224 of
// the COSE_Key public key MUST equal the stake key-hash inside the signer's
// reward address. Both are attacker-supplied fields; without cross-binding them,
// a self-signed proof with an attacker key + the victim's (public) reward address
// verifies as "valid". See docs/plans/2026-07-03-authenticated-device-register-contract.md.

import * as ed25519 from '@noble/ed25519';
import { blake2bHex } from 'blakejs';
import { COSESign1, COSEKey } from '@emurgo/cardano-message-signing-browser';
import { Cardano } from '@cardano-sdk/core';
import { HexBlob } from '@cardano-sdk/util';
import { keyHashFromAddress } from '@/chrome/serialization';
import { CoseLabel, safeFreeCSLObject } from '@/shared/utils/converter';

export interface DeviceRegisterProof {
  coseSign1: string; // hex CBOR of COSE_Sign1
  coseKey: string; // hex CBOR of COSE_Key
  stakeAddress: string; // bech32 reward address the wallet key signed with
}

export const DEVICE_REGISTER_DOMAIN = 'gero-xdev/v1|DEVICE_REGISTER';

/** The exact string a device's wallet key signs. Pipe-joined, domain-separated. */
export function buildDeviceRegisterSubject(
  deviceId: string,
  relayPubKeyHex: string,
  stakeAddress: string,
): string {
  return `${DEVICE_REGISTER_DOMAIN}|${deviceId}|${relayPubKeyHex}|${stakeAddress}`;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.length % 2 === 0 ? hex : `0${hex}`;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(b: Uint8Array): string {
  let s = '';
  for (let i = 0; i < b.length; i++) s += b[i].toString(16).padStart(2, '0');
  return s;
}
function utf8ToHex(s: string): string {
  return bytesToHex(new TextEncoder().encode(s));
}
function bytesEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i];
  return d === 0;
}

/**
 * Fail-closed verification of a peer's DEVICE_REGISTER proof.
 *
 * @param proof the peer's proof (or undefined -> unverified -> false)
 * @param device the peer's relay identity: { deviceId, pubKey } (the relay-auth key)
 * @param ownStakeAddress THIS wallet's bech32 reward address (both devices share the wallet)
 * @returns true iff the proof cryptographically proves the peer controls the same wallet
 */
export async function verifyDeviceRegisterProof(
  proof: DeviceRegisterProof | undefined,
  device: { deviceId: string; pubKey: string },
  ownStakeAddress: string,
): Promise<boolean> {
  if (!proof || !proof.coseSign1 || !proof.coseKey || !proof.stakeAddress) return false;
  if (!device || !device.deviceId || !device.pubKey || !ownStakeAddress) return false;
  // Convenience field must agree with our own wallet (real check is the header below).
  if (proof.stakeAddress !== ownStakeAddress) return false;

  let sign1: COSESign1 | undefined;
  let coseKey: COSEKey | undefined;
  try {
    sign1 = COSESign1.from_bytes(hexToBytes(proof.coseSign1));
    coseKey = COSEKey.from_bytes(hexToBytes(proof.coseKey));

    // 1. Public key from the COSE_Key (label -2 / x). Must be a 32-byte Ed25519 key.
    const xCbor = coseKey.header(CoseLabel.x);
    const x = xCbor ? xCbor.as_bytes() : undefined;
    if (!x || x.length !== 32) return false;

    // 2. Signer address from the protected header's "address" label. This is the
    //    standard CIP-30 signData layout that every Cardano wallet emits (Lace,
    //    iOS, and our own walletBg.signData). key_id is OPTIONAL in that layout:
    //    if present it must match, but we do not require it, so any wallet's
    //    canonical signData interoperates. The signature (step 5) is verified over
    //    the message's OWN reconstructed Sig_structure, so header layout is generic.
    const protectedHdr = sign1.headers().protected().deserialized_headers();
    const addrLabel = protectedHdr.header(CoseLabel.address);
    const addrBytes = addrLabel ? addrLabel.as_bytes() : undefined;
    if (!addrBytes) return false;
    const keyId = protectedHdr.key_id();
    if (keyId && !bytesEqual(keyId, addrBytes)) return false;

    // 3. The signer address must be THIS wallet's reward address.
    const signerAddr = Cardano.Address.fromBytes(HexBlob(bytesToHex(addrBytes))).toBech32();
    if (signerAddr !== ownStakeAddress) return false;

    // 4. KEY-BINDING (the whole security): blake2b224(x) == stake key-hash of the
    //    signer's reward address. Proves x is the wallet's stake key, not an
    //    attacker key paired with the victim's public address.
    const xHash = blake2bHex(x, undefined, 28); // blake2b-224, lowercase hex (56 chars)
    const stakeKeyHash = keyHashFromAddress(signerAddr);
    if (!stakeKeyHash || xHash.toLowerCase() !== String(stakeKeyHash).toLowerCase()) return false;

    // 5. Ed25519-verify the COSE signature over the reconstructed Sig_structure
    //    (never the raw payload). This also pins the algorithm to Ed25519.
    const sigStructObj = sign1.signed_data();
    const sigStruct = sigStructObj.to_bytes();
    safeFreeCSLObject(sigStructObj);
    const sig = sign1.signature();
    const okSig = await ed25519.verifyAsync(sig, sigStruct, x);
    if (!okSig) return false;

    // 6. The signed payload must be exactly the subject re-derived from THIS peer's
    //    relay pubkey + deviceId + our own wallet. Binds the proof to this device.
    const payload = sign1.payload();
    if (!payload) return false;
    const expected = utf8ToHex(buildDeviceRegisterSubject(device.deviceId, device.pubKey, ownStakeAddress));
    if (bytesToHex(payload).toLowerCase() !== expected.toLowerCase()) return false;

    return true;
  } catch {
    return false; // any parse / crypto failure -> unverified -> unpairable
  } finally {
    safeFreeCSLObject(sign1);
    safeFreeCSLObject(coseKey);
  }
}
