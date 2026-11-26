/**
 * Recovery package test vectors (GV-14). PROVISIONAL: not frozen until they match the other
 * client's vectors.
 *
 * Nothing here is a real wallet or a real secret. The participants are the published
 * cardano-addresses account key and test cosigners generated from fixed entropy bytes
 * (`vectors.ts`); the passphrase, salt and nonce are fixed test values.
 *
 * - `standard`: preprod, 2 of 3, every participant at vault index 1 (the standard vault of the
 *   vault identifier vectors in `vaultId.spec.ts`), exported by the published account key, every
 *   other section empty. Its whole file is pinned at full Argon2id strength.
 * - `backup`: preprod, owners the published key and cosigner 1 (threshold 2), cosigner 1 recorded
 *   as an external wallet that supplied its role keys, backup holder cosigner 2 (threshold 1, from
 *   slot 200000000, which on preprod is 2028-10-20T19:33:20Z), exported by the backup holder,
 *   every section filled, with an opaque endorsement and external attestation. Payload pinned.
 * - `plutus`: preview, owners the published key and cosigner 1, guardian cosigner 2 at index 7, a
 *   seed reference, template version 1 and stand-in validator bytes. Payload pinned.
 * - `PASSPHRASE_VECTORS`: the normalisation every client applies, and what the writer and the
 *   reader accept.
 */
import { Cardano } from '@cardano-sdk/core';
import { Hash28ByteBase16 } from '@cardano-sdk/crypto';
import { OwnerAttestation } from '../attestation';
import { bech32 } from 'bech32';
import { BECH32_PREFIX, deriveRoleKeys, deriveVaultPublicKeys } from '../keys';
import { buildVaultFromParticipants } from '../scripts';
import { PackageParticipant, RecoveryPackageContents } from '../recoveryPayload';
import { RoleKeys, VaultScripts } from '../types';
import { ExternalEndorsement, externalAttestationHash, externalEndorsementDigest } from '../verificationNumber';
import { attestationBy, testParticipants } from './manifest';
import { publishedAccountKey, testCosignerAccount } from './vectors';

export const RECOVERY_PASSPHRASE = 'GeroVault recovery vector: correct horse battery staple';
export const RECOVERY_SALT = Uint8Array.from({ length: 16 }, (_, i) => i);
export const RECOVERY_NONCE = Uint8Array.from({ length: 24 }, (_, i) => 0x40 + i);
/** 2026-11-26T00:00:00Z */
export const EXPORTED_AT_MS = 1795651200000;
export const BACKUP_AFTER_SLOT = 200_000_000;
/** Slot 200000000 on preprod: (1655769600 + 200000000 - 86400) s. */
export const BACKUP_OPENS_AT_MS = Date.UTC(2028, 9, 20, 19, 33, 20);
/** Stand-in bytes for an applied validator; a real one comes with the audited template (GV-64). */
export const PLUTUS_VALIDATOR = '590101000033222220051200120011';

export async function vectorPeople(): Promise<RoleKeys[]> {
  return Promise.all([publishedAccountKey(), testCosignerAccount(1), testCosignerAccount(2)].map(async a => deriveRoleKeys(await a)));
}

const xvk = (prefix: string, hex: string) => bech32.encode(prefix, bech32.toWords(Buffer.from(hex, 'hex')), 1023);

/** The role keys as an external wallet supplies them (`addr_shared_xvk1...`, `stake_shared_xvk1...`). */
export function externalRoleKeys(keys: RoleKeys): { payment: string; stake: string } {
  return { payment: xvk(BECH32_PREFIX.PAYMENT_XVK, keys.payment.hex), stake: xvk(BECH32_PREFIX.STAKE_XVK, keys.stake.hex) };
}

/** A participant's entry: both vault keys, or the payment key only for a Plutus vault. */
export async function participantAt(
  keys: RoleKeys,
  index: number,
  role: PackageParticipant['role'],
  paymentOnly = role === 'guardian',
): Promise<PackageParticipant> {
  const v = await deriveVaultPublicKeys(keys, index);
  return paymentOnly ? { role, payment: v.payment } : { role, payment: v.payment, stake: v.stake };
}

export async function standardVault(people: readonly RoleKeys[]): Promise<VaultScripts> {
  return buildVaultFromParticipants({ template: { kind: 'standard', threshold: 2 }, owners: people.map(roleKeys => ({ roleKeys, index: 1 })) });
}

export async function backupVault(people: readonly RoleKeys[]): Promise<VaultScripts> {
  return buildVaultFromParticipants({
    template: { kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: BACKUP_AFTER_SLOT },
    owners: people.slice(0, 2).map(roleKeys => ({ roleKeys, index: 1 })),
    backups: [{ roleKeys: people[2], index: 1 }],
  });
}

const EMPTY = { manifests: [], proposals: [], addressBook: [], referenceScripts: [] } as const;

export async function standardContents(people: readonly RoleKeys[], exporter = 0): Promise<RecoveryPackageContents> {
  const vault = await standardVault(people);
  return {
    network: 'preprod',
    exportedAtMs: EXPORTED_AT_MS,
    vault: { kind: 'native', payment: vault.payment, stake: vault.stake },
    self: { position: exporter, index: 1 },
    participants: await Promise.all(people.map(p => participantAt(p, 1, 'owner'))),
    ...EMPTY,
  };
}

/** A test enterprise address on preprod, for the address book. */
export const ADDRESS_BOOK_ADDRESS = Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Testnet, {
  type: Cardano.CredentialType.KeyHash,
  hash: Hash28ByteBase16('1c'.repeat(28)),
}).toAddress().toBech32();

/**
 * An external attestation and an endorsement of it in the manifest code's stored form, built with
 * its own test signers (`manifest.ts` fixtures): cosigner 1's expired-transaction attestation of a
 * verification digest, endorsed by the published key's owner with CIP-8. Their meaning is the
 * manifest code's (GV-61); the package only carries them.
 */
export async function vectorEndorsement(): Promise<{ endorsement: ExternalEndorsement; externalAttestation: OwnerAttestation }> {
  const [endorser, external] = await testParticipants();
  const digest = '11'.repeat(32);
  const externalAttestation = attestationBy(external, { kind: 'verification', digest, network: 'preprod' }, 'expiredTx');
  const body = {
    verificationDigest: digest,
    externalCredential: external.credential,
    externalAttestationHash: externalAttestationHash(externalAttestation.proof),
    endorserCredential: endorser.credential,
  };
  const endorsement = { ...body, attestation: attestationBy(endorser, { kind: 'endorsement', digest: externalEndorsementDigest(body), network: 'preprod' }) };
  return { endorsement, externalAttestation };
}

export async function backupContents(people: readonly RoleKeys[]): Promise<RecoveryPackageContents> {
  const vault = await backupVault(people);
  const { endorsement, externalAttestation } = await vectorEndorsement();
  const [owner0, owner1, holder] = await Promise.all([
    participantAt(people[0], 1, 'owner'),
    participantAt(people[1], 1, 'owner'),
    participantAt(people[2], 1, 'backup'),
  ]);
  return {
    network: 'preprod',
    exportedAtMs: EXPORTED_AT_MS,
    vault: { kind: 'native', payment: vault.payment, stake: vault.stake, backup: { threshold: 1, afterSlot: BACKUP_AFTER_SLOT } },
    // The backup holder exports; cosigner 1 is recorded as an external wallet with its role keys.
    self: { position: 2, index: 1 },
    participants: [{ ...owner0, label: 'Treasurer' }, { ...owner1, external: externalRoleKeys(people[1]), label: 'Auditor' }, holder],
    manifests: [
      { version: 1, cbor: 'a1006d6765726f2d7661756c742f7631' },
      { version: 2, cbor: 'a2006d6765726f2d7661756c742f76310102' },
    ],
    proposals: [{ id: '5a'.repeat(32), cbor: '8301020c' }],
    addressBook: [{ address: ADDRESS_BOOK_ADDRESS, label: 'Payroll' }],
    referenceScripts: [{ txId: 'be'.repeat(32), index: 0 }],
    endorsements: [endorsement],
    externalAttestations: [externalAttestation],
  };
}

export async function plutusContents(people: readonly RoleKeys[]): Promise<RecoveryPackageContents> {
  return {
    network: 'preview',
    exportedAtMs: EXPORTED_AT_MS,
    vault: { kind: 'plutus', seed: { txId: '0f'.repeat(32), index: 3 }, templateVersion: 1, validator: PLUTUS_VALIDATOR },
    self: { position: 0, index: 1 },
    participants: [
      await participantAt(people[0], 1, 'owner', true),
      await participantAt(people[1], 1, 'owner', true),
      await participantAt(people[2], 7, 'guardian'),
    ],
    ...EMPTY,
    referenceScripts: [{ txId: '0e'.repeat(32), index: 0 }],
  };
}

/** A generated passphrase used by the vectors below (the example the rules give). */
export const GENERATED_EXAMPLE = '7KQ2-M9XD-4TRB-H8WN';

/**
 * Passphrase normalisation vectors, for every client: the input, the normalised text whose UTF-8
 * the key derivation takes, and whether the writer and the reader accept it.
 */
export const PASSPHRASE_VECTORS: readonly {
  readonly name: string;
  readonly input: string;
  readonly normalised: string;
  readonly writer: 'accepts' | 'TOO_SHORT' | 'CONTROL_CHARACTER';
  readonly reader: 'accepts';
}[] = [
  { name: 'ASCII spaces', input: 'correct horse battery staple', normalised: 'correct horse battery staple', writer: 'accepts', reader: 'accepts' },
  { name: 'a no-break space reads as an ASCII space', input: 'correct\u00A0horse battery staple', normalised: 'correct horse battery staple', writer: 'accepts', reader: 'accepts' },
  { name: 'an ideographic space reads as an ASCII space', input: 'correct\u3000horse battery staple', normalised: 'correct horse battery staple', writer: 'accepts', reader: 'accepts' },
  { name: 'a trailing newline is trimmed', input: 'correct horse battery staple\u000A', normalised: 'correct horse battery staple', writer: 'accepts', reader: 'accepts' },
  { name: 'leading tab and trailing CR LF are trimmed', input: '\u0009correct horse battery staple\u000D\u000A', normalised: 'correct horse battery staple', writer: 'accepts', reader: 'accepts' },
  { name: 'a tab inside is kept, refused by the writer only', input: 'correct\u0009horse battery staple', normalised: 'correct\u0009horse battery staple', writer: 'CONTROL_CHARACTER', reader: 'accepts' },
  { name: 'NUL is refused by the writer', input: 'correct horse\u0000battery staple', normalised: 'correct horse\u0000battery staple', writer: 'CONTROL_CHARACTER', reader: 'accepts' },
  { name: 'decomposed text reads as composed (NFC)', input: 'cafe\u0301 cre\u0300me bru\u0302le\u0301e', normalised: 'caf\u00E9 cr\u00E8me br\u00FBl\u00E9e', writer: 'accepts', reader: 'accepts' },
  { name: 'generated, as shown', input: '7KQ2-M9XD-4TRB-H8WN', normalised: '7KQ2M9XD4TRBH8WN', writer: 'accepts', reader: 'accepts' },
  { name: 'generated, typed lowercase without hyphens', input: '7kq2m9xd4trbh8wn', normalised: '7KQ2M9XD4TRBH8WN', writer: 'accepts', reader: 'accepts' },
  { name: 'generated, pasted with a trailing newline', input: '7KQ2-M9XD-4TRB-H8WN\u000A', normalised: '7KQ2M9XD4TRBH8WN', writer: 'accepts', reader: 'accepts' },
  { name: 'generated, pasted with CR LF', input: '7KQ2-M9XD-4TRB-H8WN\u000D\u000A', normalised: '7KQ2M9XD4TRBH8WN', writer: 'accepts', reader: 'accepts' },
  { name: 'generated, pasted with a trailing line separator U+2028', input: '7KQ2-M9XD-4TRB-H8WN\u2028', normalised: '7KQ2M9XD4TRBH8WN', writer: 'accepts', reader: 'accepts' },
  { name: 'generated, typed with spaces and a no-break space', input: '7KQ2 M9XD\u00A04TRB H8WN', normalised: '7KQ2M9XD4TRBH8WN', writer: 'accepts', reader: 'accepts' },
  { name: 'generated, a tab between groups', input: '7KQ2\u0009M9XD-4TRB-H8WN', normalised: '7KQ2M9XD4TRBH8WN', writer: 'accepts', reader: 'accepts' },
  { name: 'generated, U+2011 between groups', input: '7KQ2\u2011M9XD\u20114TRB\u2011H8WN', normalised: '7KQ2M9XD4TRBH8WN', writer: 'accepts', reader: 'accepts' },
  { name: 'generated, an en dash (U+2013) and a minus sign (U+2212) between groups', input: '7KQ2\u2013M9XD\u22124TRB\u2013H8WN', normalised: '7KQ2M9XD4TRBH8WN', writer: 'accepts', reader: 'accepts' },
  { name: 'generated, small hyphen-minus U+FE63 and small dash U+FE58 between groups', input: '7KQ2\uFE63M9XD\uFE584TRB-H8WN', normalised: '7KQ2M9XD4TRBH8WN', writer: 'accepts', reader: 'accepts' },
  { name: 'generated, a soft hyphen and a zero-width space inside a group', input: '7KQ\u00AD2-M9X\u200BD-4TRB-H8WN', normalised: '7KQ2M9XD4TRBH8WN', writer: 'accepts', reader: 'accepts' },
  { name: 'generated, a byte order mark and a word joiner inside', input: '\uFEFF7KQ2-M9\u2060XD-4TRB-H8WN', normalised: '7KQ2M9XD4TRBH8WN', writer: 'accepts', reader: 'accepts' },
  { name: 'generated, fullwidth digits and letters with a fullwidth hyphen', input: '\uFF17\uFF2B\uFF31\uFF12\uFF0D\uFF2D\uFF19\uFF38\uFF24-\uFF14\uFF54\uFF52\uFF42-H8WN', normalised: '7KQ2M9XD4TRBH8WN', writer: 'accepts', reader: 'accepts' },
  { name: 'generated, lookalikes O, I and L', input: 'oil2-m9xd-4trb-h8wn', normalised: '0112M9XD4TRBH8WN', writer: 'accepts', reader: 'accepts' },
  { name: 'a long s (U+017F) in place of a letter is used as typed', input: '7KQ2-M9XD-4TRB-H8W\u017F', normalised: '7KQ2-M9XD-4TRB-H8W\u017F', writer: 'accepts', reader: 'accepts' },
  { name: 'a dotless i (U+0131) in place of a letter is used as typed', input: 'o\u0131l2-m9xd-4trb-h8wn', normalised: 'o\u0131l2-m9xd-4trb-h8wn', writer: 'accepts', reader: 'accepts' },
  { name: 'a U does not match the generated pattern', input: 'UKQ2-M9XD-4TRB-H8WN', normalised: 'UKQ2-M9XD-4TRB-H8WN', writer: 'accepts', reader: 'accepts' },
  { name: 'a user\'s own 16 alphanumerics match the generated pattern and are folded', input: 'GoldenMapleTree7', normalised: 'G01DENMAP1ETREE7', writer: 'accepts', reader: 'accepts' },
  { name: 'a user\'s own passphrase with U+2011 is left unchanged', input: 'my\u2011own pass phrase', normalised: 'my\u2011own pass phrase', writer: 'accepts', reader: 'accepts' },
  { name: '16 code points', input: 'sixteen code pts', normalised: 'sixteen code pts', writer: 'accepts', reader: 'accepts' },
  { name: '15 code points', input: 'fifteen code pt', normalised: 'fifteen code pt', writer: 'TOO_SHORT', reader: 'accepts' },
  { name: '16 code points, two of them outside the BMP', input: 'fourteen chars\u{1F510}\u{1F511}', normalised: 'fourteen chars\u{1F510}\u{1F511}', writer: 'accepts', reader: 'accepts' },
];
