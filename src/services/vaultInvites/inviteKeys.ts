/**
 * This wallet's vault keys for an invitation, in the background worker only: the root key is
 * opened behind the wallet's own credential, the CIP-1854 account key and the two vault keys at the
 * participant's index are derived, and the vault payment key attests an INVITE or an ACCEPT
 * digest (`PROTOCOL.md` 4.1, 4.2). Only public keys and attestations leave this file.
 *
 * - A recovery-phrase wallet opens its root key with the spending password.
 * - A Google (MPC) wallet takes it from its unlocked session.
 * - A PassKey wallet's page decrypts the root key where WebAuthn runs (the documented PRF
 *   exception) and hands the bytes over, as notifications and signing already do; they are
 *   checked against the wallet's own account #0 key before anything is derived.
 * Hardware wallets are refused here (`canHoldVaultKeys`): no vault flow signs on a device yet.
 *
 * The attestation is CIP-8 (method 0) in the stored form of `attestation.ts`, built here without
 * the serialization library, and verified before it is returned: a key that is not the vault
 * payment key never produces an attestation.
 *
 * Kept free of page-only imports: the background imports this file.
 */
import { Cardano } from '@cardano-sdk/core';
import { Bip32PrivateKey, Ed25519PrivateKey, Hash28ByteBase16, ready } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { bech32 } from 'bech32';
import type { Wallet } from '@/models/types';
import {
  ATTESTATION_METHOD,
  BECH32_PREFIX,
  CIP1854_ACCOUNT_PATH,
  ROLE,
  canonicalAttestation,
  cip8Proof,
  deriveRoleKeys,
  deriveVaultPublicKeys,
  multisigAccountPublicKey,
  parseVaultPublicKeys,
  vaultKeyHashes,
  verifyAttestation,
  type AttestedDigest,
  type OwnerAttestation,
  type VaultNetwork,
  type VaultPublicKeys,
} from '@/shared/gerovault';
import { encodeCanonicalCbor, type CborWritable } from '@/shared/gerovault/canonicalCbor';
import { bytesToHex, hexToBytes } from '@/shared/gerovault/cbor';
import { withDerivedKey } from '@/modules/gerovault/keyWipe';
import { OwnAccountKeyError, canHoldVaultKeys, multisigAccountKeyOfRoot, type DeriveMultisigAccountKeyDeps } from '@/modules/gerovault/create/ownAccountKeyFlow';
import { secretsWallet } from '@/shared/utils/walletAccount';

/** The credential a page may send: the spending password, or a PassKey wallet's root key bytes. */
export interface VaultKeyAuth {
  readonly password?: string;
  readonly privateKeyBytes?: Uint8Array;
}

/** What a page may learn: public keys only. */
export interface VaultKeyPublic {
  readonly index: number;
  /** The CIP-1854 account public key (128 hex): stays in this extension's own pages. */
  readonly accountKey: string;
  /** The vault keys at `index`, raw Ed25519 public keys (hex). */
  readonly payment: string;
  readonly stake: string;
  /** blake2b-224 of `payment`: whose attestation an INVITE or ACCEPT carries. */
  readonly credential: string;
}

export interface VaultKeyMaterial extends VaultKeyPublic {
  /** Attests `subject` with the vault payment key, in the stored CIP-8 form, verified. */
  attest(subject: AttestedDigest): Promise<OwnerAttestation>;
  /** Overwrites the signing key. Every later `attest` throws. */
  wipe(): void;
}

export type VaultKeyDeps = DeriveMultisigAccountKeyDeps;

const hexOf = (bytes: Uint8Array): string => bytesToHex(bytes);
function bytesOf(hex: string): Uint8Array {
  const bytes = hexToBytes(hex);
  if (!bytes) throw new TypeError('Expected hex');
  return bytes;
}

/** The typed vault keys of two raw Ed25519 public keys, through the library's own reader. Throws `GeroVaultError`. */
export function vaultKeysFromRaw(payment: string, stake: string): VaultPublicKeys {
  return parseVaultPublicKeys({
    payment: bech32.encode(BECH32_PREFIX.PAYMENT_VK, bech32.toWords(bytesOf(payment)), 200),
    stake: bech32.encode(BECH32_PREFIX.STAKE_VK, bech32.toWords(bytesOf(stake)), 200),
  });
}

function rootKeyOf(record: Wallet, wallets: Record<number, Wallet>, auth: VaultKeyAuth, deps: VaultKeyDeps): { bytes: Uint8Array; wallet: Wallet } {
  const wallet = secretsWallet(record, wallets);
  if (wallet.encryptionMethod === 'mpc') {
    const cached = deps.sessionRootKey(wallet.id);
    if (!cached) throw new OwnAccountKeyError('locked');
    return { bytes: Uint8Array.from(cached), wallet };
  }
  if (wallet.encryptionMethod === 'prf' || (wallet.prfEncryptedPrivateKey && wallet.webAuthnCredentialId && !wallet.encryptedPrivateKey)) {
    // Checked below against the wallet's own account #0 key: bytes of any other wallet are refused.
    if (!(auth.privateKeyBytes instanceof Uint8Array) || auth.privateKeyBytes.length === 0) throw new OwnAccountKeyError('wrong-password');
    return { bytes: Uint8Array.from(auth.privateKeyBytes), wallet };
  }
  if (!wallet.encryptedPrivateKey) throw new OwnAccountKeyError('not-supported');
  if (typeof auth.password !== 'string' || !auth.password) throw new OwnAccountKeyError('wrong-password');
  let opened: Uint8Array;
  try {
    opened = deps.decryptRootKey(wallet.encryptedPrivateKey, auth.password);
  } catch {
    throw new OwnAccountKeyError('wrong-password');
  }
  const bytes = Uint8Array.from(opened);
  opened.fill(0);
  return { bytes, wallet };
}

/** The address a CIP-8 header signs: the enterprise address of the vault payment credential on `network`. */
function signedAddress(credential: string, network: VaultNetwork): Uint8Array {
  const networkId = network === 'mainnet' ? Cardano.NetworkId.Mainnet : Cardano.NetworkId.Testnet;
  const address = Cardano.EnterpriseAddress.fromCredentials(networkId, { type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16(credential) });
  return bytesOf(address.toAddress().toBytes());
}

/**
 * A CIP-8 attestation of `subject.digest` by `key` in the stored form of `attestation.ts`:
 * protected header `{ 1: -8, "address": <enterprise address> }`, an empty unprotected map, the
 * digest as payload, and the COSE_Key `{ 1: 1, 3: -8, -1: 6, -2: <key> }`.
 */
export function cip8AttestationOf(key: Ed25519PrivateKey, credential: string, subject: AttestedDigest): OwnerAttestation {
  const protectedBytes = encodeCanonicalCbor(new Map<number | string, CborWritable>([[1, -8], ['address', signedAddress(credential, subject.network)]]));
  const payload = bytesOf(subject.digest);
  const toSign = encodeCanonicalCbor(['Signature1', protectedBytes, new Uint8Array(0), payload]);
  const signature = bytesOf(key.sign(HexBlob(hexOf(toSign))).hex());
  const sign1 = encodeCanonicalCbor([protectedBytes, new Map<number, CborWritable>(), payload, signature]);
  const coseKey = encodeCanonicalCbor(new Map<number, CborWritable>([[1, 1], [3, -8], [-1, 6], [-2, bytesOf(key.toPublic().hex())]]));
  return { method: ATTESTATION_METHOD.CIP8, proof: cip8Proof(hexOf(sign1), hexOf(coseKey)) };
}

/**
 * Opens wallet `walletId`'s root key behind `auth`, derives its vault keys at `index` and keeps
 * only the vault payment key, for `attest`. The root key and every private key derived on the way
 * are overwritten before this returns. Throws `OwnAccountKeyError` (`not-found`, `not-supported`,
 * `wrong-password`, `locked`).
 */
export async function openVaultKey(walletId: number, auth: VaultKeyAuth, index: number, deps: VaultKeyDeps): Promise<VaultKeyMaterial> {
  const wallets = await deps.getWallets();
  const record = wallets[walletId];
  if (!record) throw new OwnAccountKeyError('not-found');
  if (!canHoldVaultKeys(record)) throw new OwnAccountKeyError('not-supported');
  const { bytes: rootBytes, wallet } = rootKeyOf(record, wallets, auth ?? {}, deps);
  let signing: Uint8Array;
  let accountKey: string;
  let keys: VaultPublicKeys;
  try {
    try {
      accountKey = await multisigAccountKeyOfRoot(rootBytes, wallet.publicKey);
    } catch (error) {
      // PassKey bytes that are not this wallet's root key read as a wrong credential.
      if (error instanceof OwnAccountKeyError) throw new OwnAccountKeyError(auth?.privateKeyBytes ? 'wrong-password' : error.code);
      throw new OwnAccountKeyError(auth?.privateKeyBytes ? 'wrong-password' : 'not-supported');
    }
    keys = await deriveVaultPublicKeys(await deriveRoleKeys(multisigAccountPublicKey(accountKey)), index);
    await ready();
    const root = Bip32PrivateKey.fromBytes(rootBytes);
    signing = withDerivedKey(root, [...CIP1854_ACCOUNT_PATH, ROLE.PAYMENT, index], bip32 => {
      const raw = bip32.toRawKey();
      try {
        if (raw.toPublic().hex() !== keys.payment) throw new OwnAccountKeyError('not-supported');
        return Uint8Array.from(raw.bytes());
      } finally {
        raw.bytes().fill(0);
      }
    });
  } finally {
    rootBytes.fill(0);
  }
  const credential = (await vaultKeyHashes(keys)).payment;
  let wiped = false;
  return {
    index,
    accountKey,
    payment: keys.payment,
    stake: keys.stake,
    credential,
    async attest(subject) {
      if (wiped) throw new OwnAccountKeyError('locked');
      const key = Ed25519PrivateKey.fromExtendedBytes(Uint8Array.from(signing));
      let attestation: OwnerAttestation;
      try {
        attestation = cip8AttestationOf(key, credential, subject);
      } finally {
        key.bytes().fill(0);
      }
      const stored = canonicalAttestation(attestation);
      if (stored.ok === false) throw new OwnAccountKeyError('not-supported');
      const check = await verifyAttestation(stored.attestation, credential, subject);
      if (check.ok === false) throw new OwnAccountKeyError('not-supported');
      return stored.attestation;
    },
    wipe() {
      wiped = true;
      signing.fill(0);
    },
  };
}
