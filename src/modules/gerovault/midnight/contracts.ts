/**
 * GeroVault on Midnight: the contracts every piece of the Midnight vault codes against.
 *
 * A Midnight vault is a Compact contract of a pinned build (`src/chains/midnight/vault/build`).
 * Owners and guardians do not sign transactions: they sign statement digests computed with the
 * build's own `pureCircuits`, and whoever submits runs the circuit with the collected signatures
 * as private inputs, pays the DUST fee from their own wallet and proves on their own computer.
 * Approvals travel by file. Preprod only, behind `isGeroVaultMidnightEnabled`.
 *
 * Who implements what (each part touches only its own folder):
 * - keys and signing: `src/shared/gerovault/midnight/keys/` owns the key, key card, signature and
 *   verification set types and functions (section 3);
 * - requests, approvals and the review model: `src/shared/gerovault/midnight/requests/`
 *   implements `MidnightVaultRequests`;
 * - the contract client: `src/chains/midnight/vault/client/` implements `VaultChainClient`;
 * - the vault prover: `src/chains/midnight/vault/prover/` implements `VaultProver`;
 * - the store: `src/db/midnightVaultStore.ts` implements `MidnightVaultStore`;
 * - the recovery payload: `src/shared/gerovault/midnight/recovery/` implements
 *   `MidnightVaultRecoveryPayload`;
 * - the background: `src/chrome/gerovaultMidnightHandlers.ts` and
 *   `src/modules/gerovault/midnight/bg/` answer `MidnightVaultMessages`;
 * - the screens: `create/`, `vault/`, `approve/`, `recovery/` and `guardian/` beside this file,
 *   reached through `routes.ts`; the vault screen hosts the components `MIDNIGHT_VAULT_HOSTED`
 *   names; copy lives in `src/plugins/i18n/gerovaultMidnight/`.
 *
 * Everything here is JSON-safe unless it says otherwise (no bigint, no Uint8Array), so it can cross
 * a background message or sit in a file. Encodings:
 * - 32-byte values (addresses, hashes, salts, field elements, scalars) are 64 lowercase hex digits;
 *   field elements and Jubjub scalars are little-endian, as the contract casts them to `Bytes<32>`;
 * - a Jubjub point is 64 bytes: x then y, each a 32-byte little-endian field element;
 * - a Jubjub signature is that 64-byte announcement followed by a 32-byte little-endian response,
 *   as the keys library's card files write it (`JubjubSignatureHex`);
 * - an upgrade key is a 32-byte BIP-340 x-only key; its signatures (64 bytes) follow the ledger's
 *   `signData`, BIP-340 over SHA-256 of the data (`MidnightUpgradeApproval`);
 * - nonces, counters and amounts are decimal strings (amounts in STAR for NIGHT);
 * - times on chain and in statements are unix seconds, file `createdAt` fields milliseconds.
 *
 * Change this file only by agreement: every piece codes against it.
 */
import { blake2b } from '@noble/hashes/blake2.js';
import type { DustLocalState, DustSecretKey, FinalizedTransaction, ProvingKeyMaterial, ProvingProvider, UnprovenTransaction } from '@midnightntwrk/ledger-v9';
import type { MidnightVaultBuild, MidnightVaultCircuit, MidnightVaultNetwork, MidnightVaultProfile } from '@/chains/midnight/vault/build';
import type { GuardianKeyCard, KeyCardRole, OwnerKeyCard, UpgradePublicKeyHex, WhitelistScope } from '@/shared/gerovault/midnight/keys';

export type { MidnightVaultBuild, MidnightVaultCircuit, MidnightVaultNetwork, MidnightVaultProfile };

// =================================================================================================
// 1. Networks

/**
 * The networks this build opens Midnight vaults on: a build-time gate under the
 * `isGeroVaultMidnightEnabled` flag. Outside it the routes redirect and the background refuses,
 * whatever the flag says. Mainnet stays closed until a later change.
 */
export const GEROVAULT_MIDNIGHT_NETWORKS: readonly MidnightVaultNetwork[] = Object.freeze(['preprod']);

/** The vault network of a Midnight wallet's `network` field (`Preprod`, `preprod`, `midnight-preprod`), or undefined. */
export function midnightVaultNetworkOf(walletNetwork: unknown): MidnightVaultNetwork | undefined {
  if (typeof walletNetwork !== 'string') return undefined;
  const key = walletNetwork.trim().toLowerCase().replace(/^midnight-/, '');
  return key === 'mainnet' || key === 'preprod' || key === 'preview' ? key : undefined;
}

/** Whether `walletNetwork` is one of `GEROVAULT_MIDNIGHT_NETWORKS`. */
export function isGeroVaultMidnightNetwork(walletNetwork: unknown): boolean {
  const network = midnightVaultNetworkOf(walletNetwork);
  return network !== undefined && GEROVAULT_MIDNIGHT_NETWORKS.includes(network);
}

// =================================================================================================
// 2. Encodings

/** 32 bytes as 64 lowercase hex digits. */
export type Hex32 = string;
/** A field element or a Jubjub scalar: 32 bytes little-endian, 64 lowercase hex digits. */
export type FieldHex = string;
/**
 * A Jubjub point: 64 bytes, x then y, each a 32-byte little-endian field element, 128 lowercase hex
 * digits (the keys library's `encodeJubjubPoint`, `jubjubPointHex`).
 */
export type JubjubPointHex = string;
/** A vault upgrade key: a 32-byte BIP-340 x-only public key, lowercase hex. */
export type UpgradeKeyHex = string;
/** A BIP-340 signature: 64 bytes, lowercase hex. */
export type Bip340SignatureHex = string;
/** A Midnight unshielded user address of the vault's network, bech32m (`mn_addr...`). */
export type MidnightUserAddress = string;
/** An amount of NIGHT in STAR (10^6 STAR = 1 NIGHT), as a decimal string. */
export type StarAmount = string;
/** Seconds since the epoch. */
export type UnixSeconds = number;

/**
 * A Jubjub Schnorr signature as `jubjubSchnorrVerify<1>` checks it, in the encoding of the keys
 * library's key card files: the 64-byte announcement (x then y, each 32 bytes little-endian)
 * followed by the 32-byte little-endian response, as two hex fields.
 */
export interface JubjubSignatureHex {
  /** R = r*G: 64 bytes, 128 hex digits. */
  readonly announcement: JubjubPointHex;
  /** s = r + c*sk mod r_J: 32 bytes little-endian, 64 hex digits. */
  readonly response: FieldHex;
}

/** Version of the request, approval and vault file formats. Key cards carry the keys library's own `KEY_CARD_VERSION`. */
export const MIDNIGHT_FILE_VERSION = 1;

/** The Jubjub identity point (0, 1): the contract's empty key. */
export const JUBJUB_IDENTITY_HEX: JubjubPointHex = `${'00'.repeat(32)}01${'00'.repeat(31)}`;

// =================================================================================================
// 3. Keys, key cards and the verification set: the keys library's
//
// `src/shared/gerovault/midnight/keys/` owns them, with the functions that make and check them: the
// path `m/1854'/2400'/n'/r'/i'` and its levels, the tags, key derivation, Jubjub and upgrade-key
// signing and verification, point validation, key cards (`readKeyCard`, `keyCardToJson`,
// `keyCardToBech32`), the verification set and number, the request code and the index counter.
// Their types are re-exported here, so a piece can name them from one place; import the functions
// from the keys library itself. Its runtime types carry bigints, so a card or a set crosses a
// message, a file or a record only in the wire forms below.

export type {
  DelegateKeyCard,
  DelegateKeys,
  FieldElement,
  GuardianKeyCard,
  GuardianKeys,
  JubjubKeyPair,
  JubjubPoint,
  JubjubPointRefusal,
  JubjubPublicKey,
  JubjubSecretKey,
  JubjubSignature,
  JubjubSignatureRefusal,
  KeyCardExpectation,
  KeyCardReadResult,
  KeyCardRefusal,
  KeyCardRole,
  KeyCardSigningOptions,
  MidnightIndexCounter,
  MidnightKeyCard,
  MidnightKeyErrorCode,
  MidnightKeyRole,
  MidnightNetwork,
  MidnightVerificationQr,
  MidnightVerificationSet,
  OwnerKeyCard,
  OwnerKeys,
  RequestCodeInput,
  UpgradeKeyPair,
  UpgradePublicKeyHex,
  WhitelistScope,
} from '@/shared/gerovault/midnight/keys';

/**
 * A key card as text: a `.gvmkey.json` file's content (`keyCardToJson`) or its bech32m form
 * (`keyCardToBech32`). It crosses messages and sits in files and records only like this; read it
 * back with `readKeyCard`, which makes every check and gives a `MidnightKeyCard`.
 */
export type MidnightKeyCardText = string;

/**
 * A `MidnightVerificationSet`, pinned: its canonical CBOR (`verificationSetCbor`, hex) and its
 * `verificationDigest`. Comparing a set rebuilt from the chain with the verified one compares these.
 */
export interface MidnightVerificationSetPin {
  readonly cbor: string;
  readonly digest: Hex32;
}

/** `midnightVaultId`'s tag (the only tag this file adds; the keys library holds the others). */
export const MIDNIGHT_VAULT_ID_TAG = 'gero-vault/v1|midnight-vault-id|';

// =================================================================================================
// 4. Statements and request kinds

/** Every signed operation a request file can carry. Delegate payouts need no file. */
export const MIDNIGHT_REQUEST_KINDS = Object.freeze([
  'payout',
  'propose-owners',
  'cancel-owners',
  'propose-policy',
  'cancel-policy',
  'narrow-policy',
  'propose-guardians',
  'cancel-guardians',
  'cancel-recovery',
  'propose-recovery',
  'withdraw-recovery',
  'maintenance',
] as const);
export type MidnightRequestKind = (typeof MIDNIGHT_REQUEST_KINDS)[number];

export type MidnightSignerGroup = 'owners' | 'guardians' | 'committee';
/** Which counter a statement signs: the owner nonce, the recovery nonce, or the committee counter. */
export type MidnightNonceKind = 'owner' | 'recovery' | 'committee';

export interface MidnightRequestKindInfo {
  /** The circuit that consumes the approvals; null for a maintenance update. */
  readonly circuit: MidnightVaultCircuit | null;
  /** The statement's first word (UTF-8, zero-padded to 32 bytes); null for a maintenance update. */
  readonly domain: string | null;
  readonly signers: MidnightSignerGroup;
  readonly nonce: MidnightNonceKind;
  /** Shows the 20-digit request code, to be confirmed by voice. */
  readonly requestCode: boolean;
  /** Bounds of a statement's expiry, from the moment it is signed. */
  readonly maxExpirySeconds: number;
  readonly defaultExpirySeconds: number;
}

const HOUR = 3600;
const DAY = 24 * HOUR;
const ownerStatement = (circuit: MidnightVaultCircuit, domain: string, requestCode = false, nonce: MidnightNonceKind = 'owner'): MidnightRequestKindInfo =>
  Object.freeze({ circuit, domain, signers: 'owners', nonce, requestCode, maxExpirySeconds: 7 * DAY, defaultExpirySeconds: 2 * DAY });
const cancelStatement = (info: MidnightRequestKindInfo): MidnightRequestKindInfo => Object.freeze({ ...info, maxExpirySeconds: 2 * DAY, defaultExpirySeconds: 2 * DAY });
const guardianStatement = (circuit: MidnightVaultCircuit, domain: string): MidnightRequestKindInfo =>
  Object.freeze({ circuit, domain, signers: 'guardians', nonce: 'recovery', requestCode: true, maxExpirySeconds: 30 * DAY, defaultExpirySeconds: 7 * DAY });

/**
 * The statement of each kind, from the contract freeze. Owner statements sign the owner nonce,
 * except the bound recovery cancel, which signs the RECOVERY nonce and the pending recovery's
 * owner set (`cancel-recov:v2`), so a cancel works for that one request and owner operations
 * landing first do not invalidate it. Cancels expire within 48 hours.
 */
export const MIDNIGHT_REQUEST_KIND_INFO: Readonly<Record<MidnightRequestKind, MidnightRequestKindInfo>> = Object.freeze({
  payout: ownerStatement('execute', 'midnight-vault:payout:v4'),
  'propose-owners': ownerStatement('proposeOwners', 'midnight-vault:propose-owners:v2'),
  'cancel-owners': cancelStatement(ownerStatement('cancelOwners', 'midnight-vault:cancel-owners:v2')),
  'propose-policy': ownerStatement('proposePolicy', 'midnight-vault:propose-policy:v1'),
  'cancel-policy': cancelStatement(ownerStatement('cancelPolicy', 'midnight-vault:cancel-policy:v1')),
  'narrow-policy': ownerStatement('narrowPolicy', 'midnight-vault:narrow-policy:v1'),
  'propose-guardians': ownerStatement('proposeGuardians', 'midnight-vault:propose-guard:v1', true),
  'cancel-guardians': cancelStatement(ownerStatement('cancelGuardians', 'midnight-vault:cancel-guard:v1', true)),
  'cancel-recovery': cancelStatement(ownerStatement('cancelRecovery', 'midnight-vault:cancel-recov:v2', true, 'recovery')),
  'propose-recovery': guardianStatement('proposeRecovery', 'midnight-vault:propose-recov:v1'),
  'withdraw-recovery': guardianStatement('withdrawRecovery', 'midnight-vault:withdraw-recov:v1'),
  maintenance: Object.freeze({
    circuit: null, domain: null, signers: 'committee', nonce: 'committee', requestCode: false, maxExpirySeconds: 7 * DAY, defaultExpirySeconds: 2 * DAY,
  }),
});

/** The delegate's own statement (`delegatePayout`, the slot's nonce). */
export const MIDNIGHT_DELEGATE_PAYOUT_DOMAIN = 'midnight-vault:delegate-pay:v1';

/**
 * Timing rules of the ledger and the contract, for whoever builds a call:
 * - the node treats block time as uncertain by `NODE_TIME_MARGIN`: "from T" is T + 30 s, "until T"
 *   is T - 30 s;
 * - `notBefore` and `at` are chosen at build time (never signed): not in the past, at most
 *   `MAX_AHEAD` ahead; the wallet uses now + `NOT_BEFORE_LEAD`, and for cancel and withdraw
 *   `at` = now + `CANCEL_AT_LEAD`;
 * - the intent TTL is at most the tip + `MAX_TTL_AHEAD`.
 */
export const MIDNIGHT_VAULT_TIMING = Object.freeze({
  NODE_TIME_MARGIN: 30,
  MAX_AHEAD: 3600,
  NOT_BEFORE_LEAD: 420,
  CANCEL_AT_LEAD: 50 * 60,
  MAX_TTL_AHEAD: 3540,
});

// =================================================================================================
// 5. Request bodies: the full preimage of each statement, never only a hash
//
// Slot arrays have exactly the build's slot count (owners 5, whitelist 8, delegates 2, guardians 5)
// in contract order, null for an empty slot (the contract's default value). Labels are claims for
// display and are not part of any digest.

/** An owner's two public keys, in the file encodings above. */
export interface MidnightOwnerPublicKeys {
  readonly approvalKey: JubjubPointHex;
  readonly upgradeKey: UpgradeKeyHex;
}

export interface MidnightOwnerSlot extends MidnightOwnerPublicKeys {
  readonly label?: string;
}

/** An owner set and its threshold (owner changes, recovery proposals, withdrawals and cancels). */
export interface MidnightOwnerSetBody {
  readonly owners: readonly (MidnightOwnerSlot | null)[];
  readonly threshold: number;
}

export interface MidnightPayoutBody {
  readonly recipient: MidnightUserAddress;
  readonly amount: StarAmount;
}

/**
 * `quorumOnly`: a threshold payout may go there; `any`: a delegate may pay there too (the
 * contract's enum 0 and 1). The keys library's `WhitelistScope`.
 */
export type MidnightWhitelistScope = WhitelistScope;

export interface MidnightWhitelistSlot {
  readonly recipient: MidnightUserAddress;
  readonly scope: MidnightWhitelistScope;
  readonly label?: string;
}

export interface MidnightDelegateSlot {
  readonly key: JubjubPointHex;
  /** STAR per period. */
  readonly cap: StarAmount;
  /** Seconds, at least 600. */
  readonly period: number;
  readonly label?: string;
}

export interface MidnightPolicyBody {
  readonly whitelistEnabled: boolean;
  readonly whitelist: readonly (MidnightWhitelistSlot | null)[];
  readonly delegates: readonly (MidnightDelegateSlot | null)[];
}

/** A guardian as owners know it: key and salt (secret from everyone but the owners). */
export interface MidnightGuardianSlot {
  readonly key: JubjubPointHex;
  readonly salt: Hex32;
  readonly label?: string;
}

export interface MidnightRecoverySettings {
  /** Approvals needed: 0 with no guardians (recovery off), else a strict majority. */
  readonly threshold: number;
  readonly recoveryDelay: number;
  readonly cooldown: number;
  readonly expiryWindow: number;
}

/** `propose-guardians`: the new guardians in full; the request goes to owners only. */
export interface MidnightGuardianSetBody extends MidnightRecoverySettings {
  readonly guardians: readonly (MidnightGuardianSlot | null)[];
}

/** A recovery configuration as the chain holds it: guardian commitments (null for 0), not keys. */
export interface MidnightRecoveryConfigBody extends MidnightRecoverySettings {
  readonly guardians: readonly (FieldHex | null)[];
}

/** The decoded content of a maintenance update; the signer decodes the update itself and compares. */
export interface MidnightMaintenanceBody {
  /** Verifier keys the update inserts, each named by circuit and SHA-256. */
  readonly inserts: readonly { readonly circuit: MidnightVaultCircuit; readonly verifierKeySha256: Hex32 }[];
  readonly removals: readonly MidnightVaultCircuit[];
  /** The committee the update installs, or null when it keeps the current one. */
  readonly authority: { readonly keys: readonly UpgradeKeyHex[]; readonly threshold: number } | null;
}

export interface MidnightRequestBodies {
  readonly payout: MidnightPayoutBody;
  /** The proposed set. Carries `maintenance`: the committee moves to the new owners' upgrade keys when it applies. */
  readonly 'propose-owners': MidnightOwnerSetBody;
  /** The pending set. */
  readonly 'cancel-owners': MidnightOwnerSetBody;
  readonly 'propose-policy': MidnightPolicyBody;
  /** The pending policy. */
  readonly 'cancel-policy': MidnightPolicyBody;
  readonly 'narrow-policy': MidnightPolicyBody;
  readonly 'propose-guardians': MidnightGuardianSetBody;
  /** The pending configuration. */
  readonly 'cancel-guardians': MidnightRecoveryConfigBody;
  /** The pending recovery's owner set; `nonce` is the recovery nonce. */
  readonly 'cancel-recovery': MidnightOwnerSetBody;
  readonly 'propose-recovery': MidnightOwnerSetBody;
  /** The pending recovery's owner set. */
  readonly 'withdraw-recovery': MidnightOwnerSetBody;
  readonly maintenance: MidnightMaintenanceBody;
}

// =================================================================================================
// 6. Files

export const MIDNIGHT_REQUEST_FILE_TYPE = 'gero-vault/v1|midnight-request';
export const MIDNIGHT_APPROVAL_FILE_TYPE = 'gero-vault/v1|midnight-approval';
export const MIDNIGHT_VAULT_FILE_TYPE = 'gero-vault/v1|midnight-vault';

/** Suggested file names end with these. Every file is UTF-8 JSON, hex in lowercase. Key cards are the keys library's. */
export const MIDNIGHT_FILE_EXTENSIONS = Object.freeze({
  request: '.gvmreq.json',
  approval: '.gvmsig.json',
  vault: '.gvmvault.json',
});

/** Larger files are refused before parsing (`readTextFile`'s bound). */
export const MIDNIGHT_FILE_MAX_BYTES = Object.freeze({
  request: 64 * 1024,
  approval: 4 * 1024,
  vault: 64 * 1024,
});

interface MidnightRequestFileOf<K extends MidnightRequestKind> {
  readonly type: typeof MIDNIGHT_REQUEST_FILE_TYPE;
  readonly version: typeof MIDNIGHT_FILE_VERSION;
  readonly network: MidnightVaultNetwork;
  readonly contract: Hex32;
  readonly build: string;
  readonly kind: K;
  readonly signers: MidnightSignerGroup;
  /** The counter the statement signs (`MIDNIGHT_REQUEST_KIND_INFO[kind].nonce`), decimal. */
  readonly nonce: string;
  /** The statement's expiry word. */
  readonly expiry: UnixSeconds;
  readonly body: MidnightRequestBodies[K];
  /**
   * The statement digest (a field element). For `maintenance`, which signs no statement, the
   * SHA-256 of the update's `dataToSign`.
   */
  readonly digest: Hex32;
  /**
   * The serialized `MaintenanceUpdate`, hex: `propose-owners` and `maintenance` only. Committee
   * members sign its `dataToSign` as `MidnightUpgradeApproval` says.
   */
  readonly maintenance?: { readonly update: string };
  /** Set when this request replaces an earlier one that can no longer land. */
  readonly retry?: { readonly of: Hex32; readonly reason: 'replaced' | 'expired' | 'failed' };
  /** Milliseconds; display only. */
  readonly createdAt: number;
  /** A label claim; display only. */
  readonly proposer?: string;
}

/** What the proposer hands to each signer. No secret, except guardian salts in `propose-guardians`. */
export type MidnightRequestFile<K extends MidnightRequestKind = MidnightRequestKind> = { [P in K]: MidnightRequestFileOf<P> }[K];

interface MidnightApprovalBase {
  readonly type: typeof MIDNIGHT_APPROVAL_FILE_TYPE;
  readonly version: typeof MIDNIGHT_FILE_VERSION;
  readonly network: MidnightVaultNetwork;
  readonly contract: Hex32;
  /** The request's digest. */
  readonly digest: Hex32;
  readonly createdAt: number;
}

/**
 * A committee member's signature on a maintenance update. The scheme is the ledger's
 * `signData({ tag: 'schnorr', value }, data)`: BIP-340 over SHA-256(data), never a raw BIP-340
 * signature over the data itself. Make it with the keys library's `signUpgrade(secret,
 * update.dataToSign)` (or ledger `signData`) and check it with `verifyUpgrade` (or ledger
 * `verifySignature`); the ledger refuses anything else.
 */
export interface MidnightUpgradeApproval {
  readonly key: UpgradeKeyHex;
  /** 64 bytes, hex: BIP-340 over SHA-256 of the update's `dataToSign`. */
  readonly signature: Bip340SignatureHex;
}

export interface MidnightOwnerApprovalFile extends MidnightApprovalBase {
  readonly role: 'owner';
  readonly approvalKey: JubjubPointHex;
  readonly signature: JubjubSignatureHex;
  /** When the request carries `maintenance`. */
  readonly upgrade?: MidnightUpgradeApproval;
}

/** A guardian's approval carries its salt: `proposeRecovery` takes key and salt as private inputs. */
export interface MidnightGuardianApprovalFile extends MidnightApprovalBase {
  readonly role: 'guardian';
  readonly approvalKey: JubjubPointHex;
  readonly signature: JubjubSignatureHex;
  readonly salt: Hex32;
}

/** A committee member's signature on a `maintenance` request. */
export interface MidnightCommitteeApprovalFile extends MidnightApprovalBase {
  readonly role: 'committee';
  readonly upgrade: MidnightUpgradeApproval;
}

/** What a signer hands back. Bearer data: anyone holding enough of them can submit. */
export type MidnightApprovalFile = MidnightOwnerApprovalFile | MidnightGuardianApprovalFile | MidnightCommitteeApprovalFile;

// =================================================================================================
// 7. A vault's setup and the vault file

/** The constructor's arguments besides the keys, which come as cards. */
export interface MidnightVaultSettings {
  readonly threshold: number;
  /** Seconds an owner, policy or guardian change waits before it applies. */
  readonly changeDelay: number;
  readonly whitelistEnabled: boolean;
  readonly whitelist: readonly (MidnightWhitelistSlot | null)[];
  /** 0 with no guardians (recovery off), else a strict majority. */
  readonly guardianThreshold: number;
  readonly recoveryDelay: number;
  readonly cooldown: number;
  readonly expiryWindow: number;
}

/**
 * A vault as its co-owners agree it before the deploy: the owners' and guardians' cards in slot
 * order and the settings. The verification set (keys library) is computed from it, with the
 * pinned build's `buildHash` and each guardian card's commitment; the deploy commits to exactly it.
 */
export interface MidnightVaultSetup extends MidnightVaultSettings {
  readonly network: MidnightVaultNetwork;
  readonly build: string;
  readonly owners: readonly (MidnightKeyCardText | null)[];
  readonly guardians: readonly (MidnightKeyCardText | null)[];
}

/**
 * What the creator hands co-owners once the vault is ready. Guardian cards carry salts, so the file
 * goes to owners only. An import recomputes the set from the cards and compares `verification`.
 */
export interface MidnightVaultFile extends MidnightVaultSetup {
  readonly type: typeof MIDNIGHT_VAULT_FILE_TYPE;
  readonly version: typeof MIDNIGHT_FILE_VERSION;
  readonly contract: Hex32;
  readonly verification: MidnightVerificationSetPin;
  /** A suggested name, a claim. */
  readonly name?: string;
  readonly createdAt: number;
}

// =================================================================================================
// 8. The review model (implemented in src/shared/gerovault/midnight/requests/)

/**
 * Every reason a request or an approval is refused. A refusal is never a warning: the sheet shows a
 * complete review or every refusal it found, never a partial sheet. Each code has copy under
 * `gerovaultMidnight.approve.refusal.<code>`.
 */
export type MidnightRefusalCode =
  // The file and the vault it names
  | 'FILE_MALFORMED'
  | 'FILE_TOO_LARGE'
  | 'WRONG_TYPE'
  | 'UNSUPPORTED_VERSION'
  | 'WRONG_NETWORK'
  | 'NETWORK_CLOSED'
  | 'OTHER_VAULT'
  | 'VAULT_NOT_ACCEPTED'
  | 'UNKNOWN_BUILD'
  | 'BUILD_MISMATCH'
  | 'BUILD_NOT_ALLOWED'
  | 'NOT_A_SIGNER'
  // The statement
  | 'DIGEST_MISMATCH'
  | 'STATE_UNAVAILABLE'
  | 'NONCE_STALE'
  | 'NONCE_AHEAD'
  | 'EXPIRED'
  | 'EXPIRY_TOO_FAR'
  // The content, as the contract would judge it
  | 'AMOUNT_INVALID'
  | 'RECIPIENT_INVALID'
  | 'RECIPIENT_NOT_WHITELISTED'
  | 'OWNER_SET_INVALID'
  | 'THRESHOLD_INVALID'
  | 'KEY_INVALID'
  | 'KEY_REUSED'
  | 'GUARDIAN_IS_OWNER'
  | 'POLICY_INVALID'
  | 'POLICY_WIDENS'
  | 'GUARDIAN_THRESHOLD_INVALID'
  | 'RECOVERY_SETTINGS_INVALID'
  | 'NOT_PENDING'
  // The maintenance part
  | 'MAINTENANCE_MISSING'
  | 'MAINTENANCE_UNEXPECTED'
  | 'MAINTENANCE_MALFORMED'
  | 'MAINTENANCE_MISMATCH'
  | 'MAINTENANCE_UNKNOWN_CIRCUIT'
  | 'MAINTENANCE_KEY_MISMATCH'
  | 'MAINTENANCE_AUTHORITY_INVALID'
  | 'MAINTENANCE_COMMITTEE_MISMATCH'
  // An approval file, on import
  | 'APPROVAL_MALFORMED'
  | 'APPROVAL_OTHER_REQUEST'
  /** The keys library's `checkJubjubSignature` (or `verifyUpgrade`) refused it; its reason goes in the Details layer. */
  | 'APPROVAL_SIGNATURE_INVALID'
  | 'APPROVAL_NOT_A_SIGNER'
  | 'APPROVAL_UPGRADE_INVALID'
  | 'APPROVAL_DUPLICATE';

/** Shown beside a complete review; none of them stops signing. */
export type MidnightReviewWarning =
  /** The test build: 60-second floors, preprod only. */
  | 'TEST_DELAYS'
  /** A guardian signs without a fresh state read: the statement is bound to the recovery nonce and the full owner set. */
  | 'STATE_UNREAD'
  /** The payout is more than the vault's last read balance. */
  | 'ABOVE_BALANCE'
  /** The recipient is one of the vault's owners. */
  | 'RECIPIENT_IS_OWNER';

export interface MidnightOwnerSetChange {
  readonly proposed: MidnightOwnerSetBody;
  /** The current owners as last read, null without a state read. */
  readonly current: MidnightOwnerSetBody | null;
}

/** What the request authorises, per kind, with everything the sheet needs to show it in full. */
export type MidnightReviewContent =
  | {
      readonly kind: 'payout';
      readonly recipient: MidnightUserAddress;
      readonly amount: StarAmount;
      /** Null when the whitelist is off. */
      readonly whitelisted: boolean | null;
    }
  | ({ readonly kind: 'propose-owners'; readonly committee: { readonly keys: readonly UpgradeKeyHex[]; readonly threshold: number } } & MidnightOwnerSetChange)
  | ({ readonly kind: 'cancel-owners' } & MidnightOwnerSetChange)
  | ({
      readonly kind: 'propose-recovery' | 'withdraw-recovery' | 'cancel-recovery';
      /** When an unopposed recovery could apply, and when it expires; null when not yet pending. */
      readonly appliesFrom: UnixSeconds | null;
      readonly expiresAfter: UnixSeconds | null;
      /** Guardian slots that approved the pending recovery, as the chain discloses them. */
      readonly approvedSlots: readonly number[];
    } & MidnightOwnerSetChange)
  | {
      readonly kind: 'propose-policy' | 'cancel-policy' | 'narrow-policy';
      readonly policy: MidnightPolicyBody;
      readonly current: MidnightPolicyBody | null;
    }
  | {
      readonly kind: 'propose-guardians';
      readonly guardians: MidnightGuardianSetBody;
      readonly current: MidnightRecoveryConfigBody | null;
      /** Applying it cancels a pending recovery and starts the cool-down. */
      readonly cancelsPendingRecovery: boolean;
    }
  | { readonly kind: 'cancel-guardians'; readonly config: MidnightRecoveryConfigBody }
  | { readonly kind: 'maintenance'; readonly update: MidnightMaintenanceBody };

/** A complete review of one request, computed on this device. */
export interface MidnightRequestReview {
  readonly request: MidnightRequestFile;
  readonly build: { readonly buildId: string; readonly profile: MidnightVaultProfile };
  readonly network: MidnightVaultNetwork;
  readonly contract: Hex32;
  readonly nonce: { readonly kind: MidnightNonceKind; readonly value: string };
  readonly expiry: UnixSeconds;
  /** The 20-digit code in 4 groups, for kinds that show it. */
  readonly requestCode: readonly string[] | null;
  /** On the submitter's device: approvals collected so far against the threshold. */
  readonly approvals: { readonly collected: number; readonly threshold: number } | null;
  /** Where and when the state the review used was read; null without a read. */
  readonly stateRead: { readonly source: string; readonly blockHeight: number; readonly at: number } | null;
  readonly content: MidnightReviewContent;
  readonly warnings: readonly MidnightReviewWarning[];
}

export type MidnightReviewResult =
  | { readonly ok: true; readonly review: MidnightRequestReview }
  | { readonly ok: false; readonly refusals: readonly MidnightRefusalCode[] };

/** What the sheet and the signer need beside the file: this device's view of the vault. */
export interface MidnightReviewContext {
  readonly record: MidnightVaultRecord;
  /** The state read just before; null when it could not be read (owners then refuse to sign). */
  readonly state: MidnightVaultChainState | null;
  /** Unix seconds. */
  readonly now: UnixSeconds;
}

/** The requests part. Pure apart from loading the pinned build. */
export interface MidnightVaultRequests {
  /** Parses a request file's text and runs every check; the digest is recomputed with the pinned build. */
  reviewRequest(text: string, context: MidnightReviewContext): Promise<MidnightReviewResult>;
  /** Builds a request of `kind` at the current nonce, its digest computed with the pinned build. */
  createRequest<K extends MidnightRequestKind>(
    kind: K,
    body: MidnightRequestBodies[K],
    context: MidnightReviewContext & { readonly expiry: UnixSeconds; readonly maintenance?: string; readonly retry?: MidnightRequestFile['retry'] },
  ): Promise<MidnightRequestFile<K>>;
  /** Checks an approval file against an open request: network, contract and digest, signature, signer, duplicates. */
  checkApproval(
    text: string,
    request: MidnightRequestFile,
    context: MidnightReviewContext & { readonly collected: readonly MidnightApprovalFile[] },
  ): Promise<{ readonly ok: true; readonly approval: MidnightApprovalFile } | { readonly ok: false; readonly refusals: readonly MidnightRefusalCode[] }>;
}

// =================================================================================================
// 9. The store (implemented by src/db/midnightVaultStore.ts, table `midnightVaults`)

/** `candidate`: quarantined, shown for review, never funded from this wallet, never signed for. */
export type MidnightVaultStatus = 'candidate' | 'accepted';
export type MidnightVaultOrigin = 'created' | 'imported' | 'restored';
/**
 * - `deploying`: the deploy is built or submitted, the completion update not yet landed;
 * - `incomplete`: the contract lacks operations of its build, or the committee is still the interim one;
 * - `ready`: every import check passes;
 * - `temporary`: recovered; the funds must move to a new vault (the old owners keep upgrade power);
 * - `moved`: the funds moved to `successor`; still watched for late arrivals.
 */
export type MidnightVaultLifecycle = 'deploying' | 'incomplete' | 'ready' | 'temporary' | 'moved';

/** One role this seed holds in the vault, at its own index. */
export interface MidnightSelfRole {
  readonly role: KeyCardRole;
  /** This seed's own index, from the keys library's index counter. */
  readonly index: number;
}

export interface MidnightStoredOwner extends MidnightOwnerSlot {
  /** The card this device received for these keys; absent for keys read from the chain. */
  readonly card?: MidnightKeyCardText;
}

export interface MidnightStoredGuardian {
  readonly commitment: FieldHex;
  /** Owners' devices only: the guardian's card, which carries its key and salt. */
  readonly card?: MidnightKeyCardText;
  readonly label?: string;
}

export interface MidnightStoredParticipants {
  readonly owners: readonly (MidnightStoredOwner | null)[];
  readonly guardians: readonly (MidnightStoredGuardian | null)[];
  readonly delegates: readonly (MidnightDelegateSlot | null)[];
}

/** How this device verified a co-owner. Kept on this device, never sent anywhere. */
export interface MidnightOwnerVerification {
  readonly approvalKey: JubjubPointHex;
  readonly method: 'number' | 'qr';
  /** `verificationDigest` of the set verified. */
  readonly verificationDigest: Hex32;
  readonly at: UnixSeconds;
}

export interface MidnightDeploymentRecord {
  readonly deployTxHash?: Hex32;
  readonly completionTxHash?: Hex32;
  /** The circuits the completion update inserts. */
  readonly deferred: readonly MidnightVaultCircuit[];
}

/** Results of the chain checks of an import, cached for display only. */
export interface MidnightVaultChecks {
  readonly operations: MidnightOperationCheck;
  readonly committee: MidnightCommitteeCheck;
  readonly decoded: boolean;
  /** This seed holds a role in the vault. */
  readonly role: boolean;
  /** The set rebuilt from the state equals `agreedConfig` (null without one). */
  readonly matchesAgreed: boolean | null;
}

export interface MidnightLastCheck {
  readonly source: string;
  readonly blockHeight: number;
  readonly blockHash: Hex32;
  /** Milliseconds. */
  readonly at: number;
  readonly checks: MidnightVaultChecks;
}

export type MidnightStoredRequestState = 'open' | 'submitted' | 'landed' | 'replaced' | 'expired' | 'failed';

/** A request this device made or imported, with the approvals collected; kept across reloads. */
export interface MidnightStoredRequest {
  readonly request: MidnightRequestFile;
  readonly approvals: readonly MidnightApprovalFile[];
  readonly state: MidnightStoredRequestState;
  readonly txHash?: Hex32;
  readonly updatedAt: number;
}

/** One vault of one seed: a row of `midnightVaults`, stored under the phrase's secrets record. */
export interface MidnightVaultRecord {
  readonly recordVersion: 1;
  /** `midnightVaultId(network, contractAddress)`. The table key. */
  readonly vaultId: Hex32;
  readonly network: MidnightVaultNetwork;
  readonly contractAddress: Hex32;
  readonly build: string;
  readonly status: MidnightVaultStatus;
  readonly origin: MidnightVaultOrigin;
  readonly lifecycle: MidnightVaultLifecycle;
  /** A local name, read rule of `labels.ts`. Show it only through `displayLabel`. */
  readonly name?: string;
  /** This seed's roles in the vault. A guardian is never also an owner. */
  readonly self: readonly MidnightSelfRole[];
  readonly participants: MidnightStoredParticipants;
  /** The set verified in the ceremony, for the import check; null when none was. */
  readonly agreedConfig: MidnightVerificationSetPin | null;
  readonly verifications: readonly MidnightOwnerVerification[];
  readonly deployment: MidnightDeploymentRecord | null;
  readonly lastCheck: MidnightLastCheck | null;
  /** Open and settled requests, by digest. */
  readonly requests: readonly MidnightStoredRequest[];
  /** Set once the funds have moved to a successor vault. */
  readonly successor: Hex32 | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly acceptedAt: number | null;
}

export interface MidnightVaultCandidateInput {
  /** Must equal `midnightVaultId(network, contractAddress)`; the store recomputes it. */
  readonly vaultId: Hex32;
  readonly network: MidnightVaultNetwork;
  readonly contractAddress: Hex32;
  readonly build: string;
  readonly origin: MidnightVaultOrigin;
  readonly lifecycle: MidnightVaultLifecycle;
  readonly name?: string;
  readonly self: readonly MidnightSelfRole[];
  readonly participants: MidnightStoredParticipants;
  readonly agreedConfig?: MidnightVerificationSetPin | null;
  readonly verifications?: readonly MidnightOwnerVerification[];
  readonly deployment?: MidnightDeploymentRecord | null;
  readonly lastCheck?: MidnightLastCheck | null;
}

/** What `update` may change. Network, contract, build, vault id and status never change. */
export interface MidnightVaultRecordPatch {
  readonly name?: string | null;
  readonly lifecycle?: MidnightVaultLifecycle;
  readonly self?: readonly MidnightSelfRole[];
  /** After an applied owner, policy or guardian change, as read from the chain. */
  readonly participants?: MidnightStoredParticipants;
  readonly agreedConfig?: MidnightVerificationSetPin | null;
  readonly verifications?: readonly MidnightOwnerVerification[];
  readonly deployment?: MidnightDeploymentRecord;
  readonly lastCheck?: MidnightLastCheck;
  readonly successor?: Hex32;
}

export interface MidnightVaultListFilter {
  readonly status?: MidnightVaultStatus;
  readonly network?: MidnightVaultNetwork;
}

/**
 * Codes of the store's errors:
 * - `STORE_UNAVAILABLE`: the database could not be opened or read. Never treat it as "no vaults";
 * - `INVALID_INPUT`: a field is malformed, a card fails `readKeyCard`, or roles collide;
 * - `VAULT_ID_MISMATCH`, `VAULT_EXISTS`, `NOT_FOUND`, `NOT_A_CANDIDATE`: as the Cardano store;
 * - `INDEX_EXHAUSTED`: no index is left to allocate.
 */
export type MidnightVaultStoreErrorCode =
  | 'STORE_UNAVAILABLE'
  | 'INVALID_INPUT'
  | 'VAULT_ID_MISMATCH'
  | 'VAULT_EXISTS'
  | 'NOT_FOUND'
  | 'NOT_A_CANDIDATE'
  | 'INDEX_EXHAUSTED';

/**
 * The Midnight vaults one seed holds. `walletId` is `secretsWalletId` of the Midnight wallet, so
 * every account of one phrase sees one list and one index sequence. Every call throws an error
 * carrying a `MidnightVaultStoreErrorCode`; reads never answer empty when the database cannot be read.
 */
export interface MidnightVaultStore {
  /** Oldest first. */
  list(walletId: number, filter?: MidnightVaultListFilter): Promise<readonly MidnightVaultRecord[]>;
  get(walletId: number, vaultId: Hex32): Promise<MidnightVaultRecord | undefined>;
  /** Checks everything that needs no chain and stores a candidate. */
  addCandidate(walletId: number, input: MidnightVaultCandidateInput): Promise<MidnightVaultRecord>;
  /** Moves a candidate to accepted. The funding gates stay the caller's (`MidnightFundingBlock`). */
  accept(walletId: number, vaultId: Hex32, input?: { readonly verifications?: readonly MidnightOwnerVerification[] }): Promise<MidnightVaultRecord>;
  update(walletId: number, vaultId: Hex32, patch: MidnightVaultRecordPatch): Promise<MidnightVaultRecord>;
  /** Adds a request, or replaces the stored one with the same digest. */
  putRequest(walletId: number, vaultId: Hex32, request: MidnightStoredRequest): Promise<MidnightVaultRecord>;
  /** The next unused index for this seed and network (the keys library's counter rules), recorded as taken before it is returned. */
  allocateIndex(walletId: number, network: MidnightVaultNetwork): Promise<number>;
  /** The highest index ever allocated for this seed and network, 0 when none. */
  highestIndex(walletId: number, network: MidnightVaultNetwork): Promise<number>;
  /** Raises the highest index to at least `index` (a restored package's), never lowers it. */
  raiseIndex(walletId: number, network: MidnightVaultNetwork, index: number): Promise<void>;
}

/** `BLAKE2b-256(MIDNIGHT_VAULT_ID_TAG || UTF-8 network id || 32-byte contract address)`, lowercase hex. */
export function midnightVaultId(network: MidnightVaultNetwork, contractAddress: Hex32): Hex32 {
  if (!/^[0-9a-f]{64}$/.test(contractAddress) || midnightVaultNetworkOf(network) !== network) {
    throw new TypeError('A vault id needs a Midnight network id and a 32-byte contract address in lowercase hex');
  }
  const encoder = new TextEncoder();
  const tag = encoder.encode(MIDNIGHT_VAULT_ID_TAG);
  const id = encoder.encode(network);
  const address = Uint8Array.from(contractAddress.match(/../g)!.map(pair => Number.parseInt(pair, 16)));
  const preimage = new Uint8Array(tag.length + id.length + address.length);
  preimage.set(tag, 0);
  preimage.set(id, tag.length);
  preimage.set(address, tag.length + id.length);
  return Array.from(blake2b(preimage, { dkLen: 32 }), byte => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * Why this wallet refuses to fund a vault (any deposit from it). Deposits above
 * `MIDNIGHT_FIRST_PAYOUT_DRILL_LIMIT` also wait for one threshold payout to have landed.
 */
export type MidnightFundingBlock =
  | 'NOT_ACCEPTED'
  | 'NOT_READY'
  | 'TEMPORARY'
  | 'UPGRADE_KEYS_OUT_OF_STEP'
  | 'NOT_VERIFIED_HERE'
  | 'FIRST_PAYOUT_PENDING'
  | 'UNKNOWN_BUILD';

/** 10 NIGHT, in STAR. */
export const MIDNIGHT_FIRST_PAYOUT_DRILL_LIMIT: StarAmount = '10000000';

// =================================================================================================
// 10. The contract client (implemented in src/chains/midnight/vault/client/)

/**
 * - `exact`: every operation of one pinned build, each verifier key matching its pin;
 * - `incomplete`: a subset of a pinned build's operations (a split deployment before completion);
 * - `unknown-build`: anything else; read only, never funded, never signed for.
 */
export type MidnightOperationCheck = 'exact' | 'incomplete' | 'unknown-build';
/**
 * - `owners`: the committee is the owners' upgrade keys at the owner threshold (threshold at least 1);
 * - `interim`: the deployer's key alone, before the completion update;
 * - `temporary`: the old owners' keys after an applied recovery;
 * - `drift`: anything else; deposits blocked.
 */
export type MidnightCommitteeCheck = 'owners' | 'interim' | 'temporary' | 'drift';

/** The contract's ledger, decoded with the build's own `ledger()` reader, JSON-safe. */
export interface MidnightVaultLedgerView {
  readonly owners: readonly (MidnightOwnerPublicKeys | null)[];
  readonly threshold: number;
  readonly nonce: string;
  /** The network tag word, or null when it names no known network. */
  readonly network: MidnightVaultNetwork | null;
  readonly changeDelay: number;
  readonly pendingOwners: (MidnightOwnerSetBody & { readonly executableAfter: UnixSeconds }) | null;
  readonly policy: MidnightPolicyBody;
  readonly pendingPolicy: { readonly policy: MidnightPolicyBody; readonly executableAfter: UnixSeconds } | null;
  /** Per delegate slot: its nonce and its current window; null for a slot never used. */
  readonly delegateWindows: readonly ({ readonly nonce: string; readonly start: UnixSeconds; readonly spent: StarAmount } | null)[];
  readonly recovery: MidnightRecoveryConfigBody;
  readonly pendingGuardians: { readonly config: MidnightRecoveryConfigBody; readonly executableAfter: UnixSeconds } | null;
  readonly pendingRecovery: (MidnightOwnerSetBody & {
    readonly executableAfter: UnixSeconds;
    readonly expiresAfter: UnixSeconds;
    /** Per guardian slot. */
    readonly approvedBy: readonly boolean[];
  }) | null;
  readonly recoveryNonce: string;
  readonly cooldownUntil: UnixSeconds;
}

/** One read of a vault's contract, with the import checks made on it. State is display, never proof. */
export interface MidnightVaultChainState {
  readonly network: MidnightVaultNetwork;
  readonly contractAddress: Hex32;
  /** The provider the state came from, for "read from ... at block ...". */
  readonly source: string;
  readonly block: { readonly height: number; readonly hash: Hex32; readonly time: UnixSeconds };
  /** Milliseconds. */
  readonly readAt: number;
  /**
   * The pinned builds the deployed verifier keys are consistent with. One for a complete vault; an
   * incomplete one can match both, because the two builds differ only in deferred circuits.
   */
  readonly builds: readonly string[];
  readonly operations: MidnightOperationCheck;
  /** The SHA-256 of each operation's verifier key on chain, by circuit name; absent operations are left out. */
  readonly verifierKeys: Readonly<Record<string, Hex32>>;
  readonly committee: {
    readonly keys: readonly UpgradeKeyHex[];
    readonly threshold: number;
    readonly counter: string;
    readonly check: MidnightCommitteeCheck;
  };
  /** NIGHT the contract holds. */
  readonly balance: StarAmount;
  /** Null when the state does not decode with the build's reader. */
  readonly ledger: MidnightVaultLedgerView | null;
}

export interface MidnightVaultHistoryEntry {
  readonly txHash: Hex32;
  readonly blockHeight: number;
  readonly blockTime: UnixSeconds | null;
  readonly kind: 'deploy' | 'call' | 'maintenance';
  /** The circuits the transaction called. */
  readonly circuits: readonly string[];
  /** The change of the vault's NIGHT, signed decimal STAR; null when unknown. */
  readonly balanceChange: string | null;
}

export interface MidnightReadOptions {
  readonly signal?: AbortSignal;
}

export interface MidnightHistoryOptions extends MidnightReadOptions {
  /** At most 100. */
  readonly limit?: number;
  /** Entries below this block height, for the next page. */
  readonly before?: number;
}

/** A contract call, JSON-safe. A signed call carries the request and the approvals that satisfy it. */
export type MidnightVaultCall =
  | { readonly kind: 'deposit'; readonly amount: StarAmount }
  | {
      readonly kind: 'signed';
      readonly request: MidnightRequestFile;
      readonly approvals: readonly MidnightApprovalFile[];
      /** Chosen at build time, never signed. */
      readonly notBefore?: UnixSeconds;
      readonly at?: UnixSeconds;
    }
  | {
      readonly kind: 'delegate-payout';
      readonly slot: number;
      readonly recipient: MidnightUserAddress;
      readonly amount: StarAmount;
      readonly expiry: UnixSeconds;
      /** A new window's start, or null to spend in the current one. */
      readonly timeClaim: UnixSeconds | null;
      readonly signature: JubjubSignatureHex;
    }
  | {
      readonly kind: 'apply';
      readonly circuit: 'applyOwners' | 'applyPolicy' | 'applyGuardians' | 'applyRecovery' | 'clearExpiredRecovery';
      /**
       * `applyOwners` only: the proposal and its approvals, whose committee update rides in the same
       * fallible segment.
       */
      readonly committee?: { readonly request: MidnightRequestFile<'propose-owners'>; readonly approvals: readonly MidnightApprovalFile[] };
    };

/**
 * Why the contract refuses a call when it is run locally against fresh state, before anything is
 * built. Mapped from the contract's assertion messages; each has copy under
 * `gerovaultMidnight.approve.contract.<code>`.
 */
export type MidnightContractRefusalCode =
  | 'APPROVAL_EXPIRED'
  | 'NOT_ENOUGH_APPROVALS'
  | 'INVALID_SIGNATURE'
  | 'NOT_A_SIGNER'
  | 'NONCE_MOVED'
  | 'CHANGE_PENDING'
  | 'NOTHING_PENDING'
  | 'NOT_DUE'
  | 'RECOVERY_EXPIRED'
  | 'COOLDOWN'
  | 'TIME_OUT_OF_RANGE'
  | 'NOT_WHITELISTED'
  | 'INSUFFICIENT_BALANCE'
  | 'DELEGATE_CAP'
  | 'INVALID_INPUT'
  | 'OTHER';

export type MidnightDryRunResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: MidnightContractRefusalCode; /** The assertion text, for the Details layer. */ readonly message: string };

/**
 * What the submitter's own wallet gives the client to pay the DUST fee. Background only: it holds
 * the DUST secret key. The client pays with at least two DUST spends, since a contract call paid
 * with exactly one can fail time to dismiss.
 */
export interface MidnightFeePayer {
  /** Rebuilt from compact public projections (the wallet's DUST light sync). */
  readonly dustState: DustLocalState;
  readonly dustKey: DustSecretKey;
  /** The chain's ledger parameters, hex. */
  readonly parameters: string;
  readonly sdkNetworkId: string;
}

/**
 * Signs a maintenance update as a committee member. Background only. `sign` returns the ledger's
 * Schnorr signature over `dataToSign`, BIP-340 over SHA-256(dataToSign) (`MidnightUpgradeApproval`):
 * the keys library's `signUpgrade` or ledger `signData`, never a raw BIP-340 signature.
 */
export interface MidnightCommitteeSigner {
  readonly key: UpgradePublicKeyHex;
  sign(dataToSign: Uint8Array): Promise<Bip340SignatureHex>;
}

/**
 * A deployment's inputs, in the background: the agreed setup with its cards already read
 * (`readKeyCard`, so every key is validated), owners and guardians in slot order without the empty
 * slots (as `MidnightVerificationSet` lists them; the contract fills the rest), and the deployer's key.
 */
export interface MidnightVaultDeploySetup extends MidnightVaultSettings {
  readonly network: MidnightVaultNetwork;
  readonly build: string;
  readonly owners: readonly OwnerKeyCard[];
  readonly guardians: readonly GuardianKeyCard[];
  /** The interim committee, at threshold 1. */
  readonly deployerUpgradeKey: UpgradePublicKeyHex;
}

/** Built and paid, not proved. Holds ledger objects: never crosses a message. */
export interface MidnightPreparedVaultTx {
  readonly network: MidnightVaultNetwork;
  readonly contractAddress: Hex32;
  readonly kind: 'deploy' | 'completion' | 'call';
  readonly circuits: readonly MidnightVaultCircuit[];
  readonly tx: UnprovenTransaction;
  readonly ttl: Date;
  /** The DUST fee, in specks (10^15 per DUST), decimal. */
  readonly fee: string;
  readonly dustSpends: number;
}

export interface MidnightProvenVaultTx extends Omit<MidnightPreparedVaultTx, 'tx'> {
  readonly tx: FinalizedTransaction;
}

export interface MidnightSubmitResult {
  readonly txHash: Hex32;
  /** `included` once the indexer shows it, with its block. */
  readonly status: 'submitted' | 'included';
  readonly blockHeight?: number;
}

export interface MidnightFeeCapacity {
  /** DUST-registered NIGHT outputs this wallet can spend; a vault call needs at least two. */
  readonly coins: number;
  /** Spendable DUST now, in specks. */
  readonly available: string;
}

/**
 * The contract client for one network. Reads go through `MidnightApi.graphql` (`contractAction`);
 * submits through the wallet's proven-transaction submit with lost-reply recovery. Builders run the
 * circuit locally first: the contract's own refusal comes back as a `MidnightDryRunResult` code
 * (thrown as an error carrying it) before anything is built.
 */
export interface VaultChainClient {
  readonly network: MidnightVaultNetwork;
  readState(contractAddress: Hex32, options?: MidnightReadOptions): Promise<MidnightVaultChainState>;
  history(contractAddress: Hex32, options?: MidnightHistoryOptions): Promise<readonly MidnightVaultHistoryEntry[]>;
  dryRun(contractAddress: Hex32, call: MidnightVaultCall, options?: MidnightReadOptions): Promise<MidnightDryRunResult>;
  feeCapacity(payer: MidnightFeePayer): Promise<MidnightFeeCapacity>;
  prepareCall(contractAddress: Hex32, call: MidnightVaultCall, payer: MidnightFeePayer, options?: MidnightReadOptions): Promise<MidnightPreparedVaultTx>;
  /** The deploy with the interim committee; the address is known once it is built. */
  prepareDeploy(setup: MidnightVaultDeploySetup, payer: MidnightFeePayer, options?: MidnightReadOptions): Promise<MidnightPreparedVaultTx>;
  /** The deployer-signed update that inserts the deferred circuits and hands the committee to the owners. */
  prepareCompletion(contractAddress: Hex32, deployer: MidnightCommitteeSigner, payer: MidnightFeePayer, options?: MidnightReadOptions): Promise<MidnightPreparedVaultTx>;
  /** Proves with `prover`, binds, and runs the local checks (cost, well-formedness without proof verification). */
  prove(prepared: MidnightPreparedVaultTx, prover: VaultProver, onProgress?: (progress: MidnightProvingProgress) => void): Promise<MidnightProvenVaultTx>;
  submit(proven: MidnightProvenVaultTx, options?: MidnightReadOptions): Promise<MidnightSubmitResult>;
}

// =================================================================================================
// 11. The vault prover (implemented in src/chains/midnight/vault/prover/)

/**
 * Where a vault proof is made: always on the user's own computer, for the vault circuits and the
 * DUST spends of a vault transaction alike; never a remote service. On preprod the local proof
 * server is the only engine.
 */
export type MidnightVaultProvingEngine = 'proof-server' | 'browser' | 'helper';

export interface MidnightProvingProgress {
  readonly stage: 'keys' | 'proving' | 'done';
  readonly circuit?: string;
  readonly done: number;
  readonly total: number;
  /** An honest estimate for the remaining proofs on this computer. */
  readonly estimateSeconds?: number;
}

export type MidnightProverUnavailable = 'PROOF_SERVER_UNREACHABLE' | 'ENGINE_NOT_ALLOWED' | 'KEYS_UNAVAILABLE' | 'KEY_PIN_MISMATCH';

export interface VaultProver {
  readonly engine: MidnightVaultProvingEngine;
  status(): Promise<{ readonly available: true } | { readonly available: false; readonly reason: MidnightProverUnavailable }>;
  /**
   * A ledger proving provider: vault circuits (key location = circuit name) get the build's pinned
   * key material, DUST spends the wallet's existing path. An unpinned or altered key file is refused
   * before any preimage leaves the background.
   */
  provider(build: string, onProgress?: (progress: MidnightProvingProgress) => void): Promise<ProvingProvider>;
  /** One circuit's prover key, verifier key and ZKIR, each checked against its pin. */
  keyMaterial(build: string, circuit: MidnightVaultCircuit): Promise<ProvingKeyMaterial>;
}

// =================================================================================================
// 12. The recovery payload (implemented in src/shared/gerovault/midnight/recovery/)

/** The payload kind of a Midnight contract vault, beside Cardano's native and Plutus kinds. */
export const MIDNIGHT_RECOVERY_PAYLOAD_KIND = 2;

/** What a restore yields: a candidate (never accepted, deposits blocked until verified here). */
export interface MidnightRecoveryRestore {
  readonly candidate: MidnightVaultCandidateInput;
  /** The package's highest allocated index, for `MidnightVaultStore.raiseIndex`. */
  readonly highestIndex: number;
}

/** The recovery part: the Midnight payload over the existing envelope. */
export interface MidnightVaultRecoveryPayload {
  /** Canonical CBOR of this seed's payload for one vault, hex. */
  encode(record: MidnightVaultRecord, highestIndex: number): string;
  /** Throws on a malformed payload; the chain checks of an import follow before the candidate is stored. */
  decode(payloadCbor: string): MidnightRecoveryRestore;
}

// =================================================================================================
// 13. Background messages (answered by src/chrome/gerovaultMidnightHandlers.ts)
//
// Pages send these with `Messaging.sendToBackgroundFromOptions`; every one is extension-page only
// (`senderTrust.ts`). Requests carrying a credential are never logged. Only cards, approval files,
// transaction hashes and progress leave the background.

/** The spending password, or the 32-byte PassKey PRF secret, as the Midnight handlers take them. */
export interface MidnightVaultCredential {
  readonly password?: string;
  readonly prfSecret?: readonly number[];
}

/**
 * - `not-found`: no logged wallet, another wallet than named, or no such vault;
 * - `not-supported`: a wallet that cannot hold vault keys (hardware, watch-only);
 * - `wrong-password`, `throttled` (with `retryAfterMs`): the unlock;
 * - `network-closed`: outside `GEROVAULT_MIDNIGHT_NETWORKS`, or the flag is off;
 * - `not-accepted`: a candidate is never signed for or acted on;
 * - `request-refused`: the review refuses it (`refusals`);
 * - `contract-refused`: the local run refuses it (`contractRefusal`);
 * - `key-mismatch`: the key at the record's index is not the one the vault holds;
 * - `state-unavailable`, `fee-capacity`, `prover-unavailable` (`detail` names the reason), `proof-failed`;
 * - `submit-failed`: nothing reached the chain; `submit-uncertain`: it may have, look it up first;
 * - `busy`: another vault operation of this wallet is running.
 */
export type MidnightVaultBgError =
  | 'not-found'
  | 'not-supported'
  | 'wrong-password'
  | 'throttled'
  | 'network-closed'
  | 'not-accepted'
  | 'request-refused'
  | 'contract-refused'
  | 'key-mismatch'
  | 'state-unavailable'
  | 'fee-capacity'
  | 'prover-unavailable'
  | 'proof-failed'
  | 'submit-failed'
  | 'submit-uncertain'
  | 'busy';

export type MidnightVaultBgFailure = {
  readonly success: false;
  readonly error: MidnightVaultBgError;
  readonly detail?: string;
  readonly retryAfterMs?: number;
  readonly refusals?: readonly MidnightRefusalCode[];
  readonly contractRefusal?: MidnightContractRefusalCode;
};

/** The `data` of a background reply. */
export type MidnightVaultBgReply<T> = ({ readonly success: true } & T) | MidnightVaultBgFailure;

export type MidnightOperationStage = 'checking' | 'syncing-dust' | 'building' | 'proving' | 'submitting' | 'confirming' | 'done' | 'failed';

export interface MidnightOperationProgress {
  readonly operationId: string;
  readonly stage: MidnightOperationStage;
  readonly proving?: MidnightProvingProgress;
  readonly txHash?: Hex32;
  readonly error?: MidnightVaultBgError;
  /** Milliseconds. */
  readonly startedAt: number;
}

/** Message types of the Midnight vault, as `MessageTypes` names them. */
export const MIDNIGHT_VAULT_MESSAGE_TYPES = Object.freeze([
  'GEROVAULT_MIDNIGHT_DERIVE_CARD',
  'GEROVAULT_MIDNIGHT_FIND_ROLES',
  'GEROVAULT_MIDNIGHT_SIGN_REQUEST',
  'GEROVAULT_MIDNIGHT_DEPLOY',
  'GEROVAULT_MIDNIGHT_COMPLETE_DEPLOY',
  'GEROVAULT_MIDNIGHT_SUBMIT',
  'GEROVAULT_MIDNIGHT_PROGRESS',
  'GEROVAULT_MIDNIGHT_CHECK_NOW',
] as const);
export type MidnightVaultMessageType = (typeof MIDNIGHT_VAULT_MESSAGE_TYPES)[number];

/** Each message's request (`data`) and the fields of its successful reply. */
export interface MidnightVaultMessages {
  /** This seed's own card for a role, at the next index (allocated) or at a given one (restore). */
  readonly GEROVAULT_MIDNIGHT_DERIVE_CARD: {
    readonly request: MidnightVaultCredential & {
      readonly walletId: number;
      readonly network: MidnightVaultNetwork;
      readonly role: MidnightSelfRole['role'];
      readonly index?: number;
      readonly label?: string;
    };
    /** The card as `keyCardToJson` and `keyCardToBech32` write it. */
    readonly reply: { readonly card: MidnightKeyCardText; readonly bech32m: MidnightKeyCardText; readonly index: number };
  };
  /** Import by address: scans this seed's indices (1 to the highest plus the gap limit) for a role in the contract. */
  readonly GEROVAULT_MIDNIGHT_FIND_ROLES: {
    readonly request: MidnightVaultCredential & { readonly walletId: number; readonly network: MidnightVaultNetwork; readonly contractAddress: Hex32 };
    readonly reply: { readonly self: readonly MidnightSelfRole[]; readonly scannedTo: number };
  };
  /** Signs a request file (any kind) after repeating every check from the file itself. */
  readonly GEROVAULT_MIDNIGHT_SIGN_REQUEST: {
    readonly request: MidnightVaultCredential & { readonly walletId: number; readonly vaultId: Hex32; readonly requestText: string };
    readonly reply: { readonly approval: MidnightApprovalFile };
  };
  /** Deploys with the interim committee, stores the record (`deploying`), and waits for inclusion. */
  readonly GEROVAULT_MIDNIGHT_DEPLOY: {
    readonly request: MidnightVaultCredential & {
      readonly walletId: number;
      readonly operationId: string;
      readonly setup: MidnightVaultSetup;
      /** The set the ceremony verified: the worker recomputes it from `setup` and refuses any other. */
      readonly verification: MidnightVerificationSetPin;
      readonly self: readonly MidnightSelfRole[];
      readonly name?: string;
    };
    readonly reply: { readonly vaultId: Hex32; readonly contractAddress: Hex32; readonly txHash: Hex32 };
  };
  /** Submits the completion update, then re-reads the contract and runs every import check. */
  readonly GEROVAULT_MIDNIGHT_COMPLETE_DEPLOY: {
    readonly request: MidnightVaultCredential & { readonly walletId: number; readonly vaultId: Hex32; readonly operationId: string };
    readonly reply: { readonly txHash: Hex32; readonly lifecycle: MidnightVaultLifecycle };
  };
  /** Builds, pays, proves (on this computer) and submits one call. */
  readonly GEROVAULT_MIDNIGHT_SUBMIT: {
    readonly request: MidnightVaultCredential & {
      readonly walletId: number;
      readonly vaultId: Hex32;
      readonly operationId: string;
      readonly call: MidnightVaultCall;
      /** Another wallet of this user pays the fee (the sponsor feature). */
      readonly payerWalletId?: number;
    };
    readonly reply: { readonly txHash: Hex32 };
  };
  /** Progress of a running operation, polled by the page that started it. */
  readonly GEROVAULT_MIDNIGHT_PROGRESS: {
    readonly request: { readonly operationId: string };
    readonly reply: { readonly progress: MidnightOperationProgress | null };
  };
  /** Reads the state of one vault, or of every accepted vault of the seed, now. */
  readonly GEROVAULT_MIDNIGHT_CHECK_NOW: {
    readonly request: { readonly walletId: number; readonly vaultId?: Hex32 };
    readonly reply: { readonly checked: number };
  };
}

// =================================================================================================
// 14. Components the vault screen hosts
//
// The vault screen (`vault/`) renders these from the other screens' folders, so no folder edits
// another. Each takes `MidnightVaultHostedProps` (the guardian list `MidnightGuardianHostedProps`).

export interface MidnightVaultHostedProps {
  /** `secretsWalletId` of the logged Midnight wallet. */
  readonly walletId: number;
  readonly vaultId: Hex32;
}

export interface MidnightGuardianHostedProps {
  readonly walletId: number;
}

export const MIDNIGHT_VAULT_HOSTED = Object.freeze({
  /** Open requests and the approvals collected, on the overview tab. */
  requestList: { name: 'MidnightRequestList', file: 'src/modules/gerovault/midnight/approve/MidnightRequestList.vue' },
  /** The Recovery tab: guardians, settings, a pending recovery and its cancel, health. */
  recoveryPanel: { name: 'MidnightRecoveryPanel', file: 'src/modules/gerovault/midnight/recovery/MidnightRecoveryPanel.vue' },
  /** The banner of a pending recovery, above every tab. */
  recoveryAlert: { name: 'MidnightRecoveryAlert', file: 'src/modules/gerovault/midnight/recovery/MidnightRecoveryAlert.vue' },
  /** The banner of a temporary (recovered) vault until its funds have moved. */
  moveBanner: { name: 'MidnightMoveBanner', file: 'src/modules/gerovault/midnight/recovery/MidnightMoveBanner.vue' },
  /** The vaults this seed guards, on the vaults home. */
  guardianList: { name: 'MidnightGuardianList', file: 'src/modules/gerovault/midnight/guardian/MidnightGuardianList.vue' },
} as const);
