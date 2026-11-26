// @vitest-environment node
import { describe, expect, it, beforeAll } from 'vitest';
import { createDecipheriv, pbkdf2Sync } from 'node:crypto';
import { Cardano, Serialization } from '@cardano-sdk/core';
import { Ed25519KeyHashHex } from '@cardano-sdk/crypto';
import {
  DecodedRegistration,
  EncodedRegistration,
  RegistrationInput,
  decodeRegistration,
  decryptRegistrationFields,
  encodeRegistration,
  RebuildParticipant,
  rebuildFromRegistration,
} from './registration';
import { cip83Decrypt, cip83Encrypt } from './cip83';
import { deriveParticipantKeyHashes, deriveRoleKeys, deriveVaultPublicKeys } from './keys';
import { buildVaultFromParticipants, instantiateVaultScripts, vaultScript } from './scripts';
import { ROLE, RoleKeys, VaultScripts } from './types';
import { CIP83_EXAMPLE, publishedAccountKey, testCosignerAccount } from './__fixtures__/vectors';

const native = Cardano.ScriptType.Native;
const K = Cardano.NativeScriptKind;
const SALT = Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
const INDEX = 3;

type Plain = string | number | Plain[] | { [k: string]: Plain };
const metadatum = (v: Plain): Cardano.Metadatum =>
  typeof v === 'string' ? v
    : typeof v === 'number' ? BigInt(v)
      : Array.isArray(v) ? v.map(metadatum)
        : new Map(Object.entries(v).map(([k, x]) => [k, metadatum(x)]));
const metadataCbor = (value: Plain, label = 1854n) =>
  Serialization.GeneralTransactionMetadata.fromCore(new Map([[label, metadatum(value)]])).toCbor();

function decoded(input: RegistrationInput): DecodedRegistration {
  const result = decodeRegistration(input);
  if (result.ok !== true) throw new Error(`refused: ${result.code} ${result.detail ?? ''}`);
  return result.registration;
}

function refusal(input: unknown): string {
  const result = decodeRegistration(input as RegistrationInput);
  return result.ok === true ? 'ACCEPTED' : result.code;
}

const fromOffChain = (e: EncodedRegistration): RegistrationInput => ({
  metadata: { cbor: e.offChain.metadata },
  nativeScripts: { cbor: e.offChain.native_scripts },
});

let people: RoleKeys[];
let outsider: RoleKeys;
let vault: VaultScripts;
let backupVault: VaultScripts;

const at = (index: number) => (roleKeys: RoleKeys) => ({ roleKeys, index });
const external = (roleKeys: RoleKeys): RebuildParticipant => ({ kind: 'external', roleKeys });

beforeAll(async () => {
  people = await Promise.all([publishedAccountKey(), testCosignerAccount(21), testCosignerAccount(22)].map(async a => deriveRoleKeys(await a)));
  outsider = await deriveRoleKeys(await testCosignerAccount(23));
  vault = await buildVaultFromParticipants({ template: { kind: 'standard', threshold: 2 }, owners: people.map(at(INDEX)) });
  backupVault = await buildVaultFromParticipants({
    template: { kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 123_456_789 },
    owners: people.slice(0, 2).map(at(INDEX)),
    backups: [at(INDEX)(people[2])],
  });
});

describe('encode and decode', () => {
  it('round-trips through the off-chain CBOR form', () => {
    const someone = vault.owners[0].payment;
    const encoded = encodeRegistration(vault, {
      name: 'Treasury',
      description: 'Two of three',
      icon: 'https://example.com/i.png',
      participants: { [someone]: { name: 'Alice', description: 'finance' } },
    });
    expect(encoded.json).toEqual({
      types: [0, 2],
      name: 'Treasury',
      description: 'Two of three',
      icon: 'https://example.com/i.png',
      participants: { [someone]: { name: 'Alice', description: 'finance' } },
    });
    const reg = decoded(fromOffChain(encoded));
    expect(reg.encryption).toBe('none');
    expect(reg.payment.hash).toBe(vault.payment.hash);
    expect(reg.stake.hash).toBe(vault.stake.hash);
    expect(reg.scripts.map(s => s.role)).toEqual([ROLE.PAYMENT, ROLE.STAKE]);
    expect(reg.name).toEqual({ kind: 'clear', text: 'Treasury' });
    expect(reg.participants[someone].name).toEqual({ kind: 'clear', text: 'Alice' });
    expect(reg.participants[someone].icon).toBeUndefined();
  });

  it('round-trips through the no-conversions JSON form an indexer serves, one script per item', () => {
    const encoded = encodeRegistration(backupVault, { name: 'Family' });
    const reg = decoded({
      metadata: { json: JSON.parse(JSON.stringify(encoded.json)) },
      nativeScripts: { cbors: [backupVault.payment.cbor, backupVault.stake.cbor] },
    });
    expect(reg.payment.hash).toBe(backupVault.payment.hash);
    expect(reg.stake.hash).toBe(backupVault.stake.hash);
  });

  it('keeps the auxiliary data consistent: metadata under 1854 and the scripts in types order', () => {
    const encoded = encodeRegistration(vault);
    const aux = Serialization.GeneralTransactionMetadata.fromCbor(encoded.offChain.metadata as never).toCore();
    expect([...aux.keys()]).toEqual([1854n]);
    expect(encoded.nativeScripts).toEqual([vault.payment.script, vault.stake.script]);
    expect(encoded.offChain.native_scripts).toBe(`82${vault.payment.cbor}${vault.stake.cbor}`);
  });

  it('refuses descriptions the CIPs do not allow', () => {
    const tooLong = 'x'.repeat(65);
    expect(() => encodeRegistration(vault, { name: tooLong })).toThrow(expect.objectContaining({ code: 'INVALID_DESCRIPTION' }));
    expect(() => encodeRegistration(vault, { name: '' })).toThrow(expect.objectContaining({ code: 'INVALID_DESCRIPTION' }));
    expect(() => encodeRegistration(vault, { participants: { ['ab'.repeat(28)]: { name: 'Not in the vault' } } }))
      .toThrow(expect.objectContaining({ code: 'INVALID_DESCRIPTION' }));
    expect(() => encodeRegistration(vault, {}, { method: 'basic', passphrase: '' }))
      .toThrow(expect.objectContaining({ code: 'INVALID_PASSPHRASE' }));
    // Encrypted text is split into 64-character strings, so a long name fits.
    expect(() => encodeRegistration(vault, { name: tooLong }, { method: 'basic' })).not.toThrow();
  });
});

describe('CIP-83 encrypted fields', () => {
  it('decrypts the CIP-83 README example with the default passphrase', () => {
    // The published ciphertext ends in a newline: it was made without `echo -n`, whatever the
    // README's command line says. The decryption is exact either way.
    expect(cip83Decrypt(CIP83_EXAMPLE.chunks)).toBe(`${CIP83_EXAMPLE.plaintext}\n`);
    expect(cip83Decrypt(CIP83_EXAMPLE.chunks, 'not cardano')).toBeUndefined();
  });

  it('writes an OpenSSL envelope node:crypto can open (independent PBKDF2 and AES-256-CBC)', () => {
    const chunks = cip83Encrypt('Treasury of the three of us', 'cardano', SALT);
    expect(chunks.every(c => c.length <= 64)).toBe(true);
    const raw = Buffer.from(chunks.join(''), 'base64');
    expect(raw.subarray(0, 8).toString('latin1')).toBe('Salted__');
    const keyIv = pbkdf2Sync('cardano', raw.subarray(8, 16), 10000, 48, 'sha256');
    const decipher = createDecipheriv('aes-256-cbc', keyIv.subarray(0, 32), keyIv.subarray(32));
    const clear = Buffer.concat([decipher.update(raw.subarray(16)), decipher.final()]).toString('utf8');
    expect(clear).toBe('Treasury of the three of us');
  });

  it('round-trips an encrypted registration; types and scripts stay in clear', () => {
    const someone = vault.owners[1].payment;
    const encoded = encodeRegistration(
      vault,
      { name: 'A long vault name that needs more than sixty four bytes once encrypted', participants: { [someone]: { name: 'Bob', icon: 'ipfs://x' } } },
      { method: 'basic', salt: SALT },
    );
    expect(encoded.json['enc']).toBe('basic');
    expect(encoded.json['types']).toEqual([0, 2]);
    expect(Array.isArray(encoded.json['name'])).toBe(true);
    const reg = decoded(fromOffChain(encoded));
    expect(reg.encryption).toBe('basic');
    expect(reg.name.kind).toBe('encrypted');
    const opened = decryptRegistrationFields(reg);
    expect(opened).toEqual({
      ok: true,
      fields: {
        name: 'A long vault name that needs more than sixty four bytes once encrypted',
        participants: { [someone]: { name: 'Bob', icon: 'ipfs://x' } },
      },
    });
  });

  it('a custom passphrase is needed to read the fields back', () => {
    const encoded = encodeRegistration(vault, { name: 'Secret' }, { method: 'basic', passphrase: 'shared secret', salt: SALT });
    const reg = decoded(fromOffChain(encoded));
    expect(decryptRegistrationFields(reg)).toEqual({ ok: false, code: 'DECRYPTION_FAILED' });
    expect(decryptRegistrationFields(reg, 'shared secret')).toEqual({ ok: true, fields: { name: 'Secret', participants: {} } });
  });
});

describe('malformed and hostile registrations are refused, never thrown', () => {
  const scripts = () => ({ cbors: [vault.payment.cbor, vault.stake.cbor] });
  const json = (value: Plain) => ({ metadata: { json: value }, nativeScripts: scripts() });
  const cbor = (metadata: string, nativeScripts: string = `82${vault.payment.cbor}${vault.stake.cbor}`) =>
    ({ metadata: { cbor: metadata }, nativeScripts: { cbor: nativeScripts } });

  it.each<[string, Plain]>([
    ['TYPES_INVALID', { name: 'no types' }],
    ['TYPES_INVALID', { types: 'payment' }],
    ['TYPES_INVALID', { types: [] }],
    ['TYPES_INVALID', { types: [0, 0] }],
    ['TYPES_INVALID', { types: [0, 1] }],
    ['TYPES_INVALID', { types: [0, 3] }],
    ['NOT_A_MAP', [0, 2]],
    ['UNSUPPORTED_ENCRYPTION', { enc: 'chacha', types: [0, 2] }],
    ['FIELD_INVALID', { types: [0, 2], name: 7 }],
    ['FIELD_INVALID', { types: [0, 2], name: ['clear text in a list'] }],
    ['FIELD_INVALID', { enc: 'basic', types: [0, 2], name: 'not chunks' }],
    ['FIELD_INVALID', { enc: 'basic', types: [0, 2], name: [] }],
    ['PARTICIPANT_INVALID', { types: [0, 2], participants: [] }],
    ['PARTICIPANT_INVALID', { types: [0, 2], participants: { 'not-a-key-hash': { name: 'x' } } }],
    ['PARTICIPANT_NOT_IN_SCRIPT', { types: [0, 2], participants: { ['ab'.repeat(28)]: { name: 'x' } } }],
    ['TOO_MANY_PARTICIPANTS', { types: [0, 2], participants: Object.fromEntries(Array.from({ length: 81 }, (_, i) => [i.toString(16).padStart(56, '0'), { name: 'x' }])) }],
  ])('%s: %j', (code, value) => {
    expect(refusal(json(value))).toBe(code);
    expect(refusal(cbor(metadataCbor(value)))).toBe(code);
  });

  it('text over the 64-byte metadata limit', () => {
    expect(refusal(json({ types: [0, 2], name: 'x'.repeat(65) }))).toBe('INVALID_METADATA');
    // The SDK will not write it, so the CBOR is assembled by hand: "name": 65-byte text.
    const types = '65747970657382' + '0002';
    expect(refusal(cbor(`a119073ea2${types}646e616d657841${'78'.repeat(65)}`))).toBe('INVALID_METADATA');
    expect(refusal(cbor(`a119073ea2${types}646e616d657840${'78'.repeat(64)}`))).toBe('ACCEPTED');
  });

  it('a participant must have a name', async () => {
    const someone = vault.owners[0].payment;
    expect(refusal(json({ types: [0, 2], participants: { [someone]: { description: 'no name' } } }))).toBe('PARTICIPANT_INVALID');
  });

  it('types and the scripts array must line up, and a payment script is required', () => {
    expect(refusal({ metadata: { json: { types: [0, 2] } }, nativeScripts: { cbors: [vault.payment.cbor] } })).toBe('TYPES_SCRIPTS_MISMATCH');
    expect(refusal({ metadata: { json: { types: [2] } }, nativeScripts: { cbors: [vault.stake.cbor] } })).toBe('NO_PAYMENT_SCRIPT');
    expect(refusal({ metadata: { json: { types: [0] } }, nativeScripts: { cbors: [] } })).toBe('NO_SCRIPTS');
    expect(refusal({ metadata: { json: { types: [0] } }, nativeScripts: { cbor: '80' } })).toBe('NO_SCRIPTS');
  });

  it('JSON values that are not metadata', () => {
    expect(refusal(json({ types: [0, 2], name: 1.5 } as never))).toBe('INVALID_METADATA');
    expect(refusal(json({ types: [0, 2], name: true } as never))).toBe('INVALID_METADATA');
    expect(refusal(json({ types: [0, 2], name: null } as never))).toBe('INVALID_METADATA');
    expect(refusal({ metadata: { json: undefined }, nativeScripts: scripts() })).toBe('MISSING_LABEL');
  });

  it('CBOR the strict reader refuses', () => {
    const types = '65747970657382' + '0002'; // "types": [0, 2]
    expect(refusal(cbor(`a119073ea1${types}`))).toBe('ACCEPTED');
    // Duplicate key "types" in the 1854 map.
    expect(refusal(cbor(`a119073ea2${types}${types}`))).toBe('MALFORMED_CBOR');
    // Indefinite-length list for types.
    expect(refusal(cbor(`a119073ea1657479706573${'9f0002ff'}`))).toBe('MALFORMED_CBOR');
    // Non-minimal integer (0 written in two bytes).
    expect(refusal(cbor(`a119073ea165747970657382${'1800'}02`))).toBe('MALFORMED_CBOR');
    // Non-minimal label (1854 written in four bytes).
    expect(refusal(cbor(`a11a0000073ea1${types}`))).toBe('MALFORMED_CBOR');
    // Trailing byte.
    expect(refusal(cbor(`a119073ea1${types}00`))).toBe('MALFORMED_CBOR');
    // A tag around the value.
    expect(refusal(cbor(`a119073ed818a1${types}`))).toBe('MALFORMED_CBOR');
    // Truncated.
    expect(refusal(cbor(`a119073ea1${types}`.slice(0, -2)))).toBe('MALFORMED_CBOR');
    // Invalid UTF-8 in a key.
    expect(refusal(cbor(`a119073ea2${types}62c328${'00'}`))).toBe('MALFORMED_CBOR');
    // Label missing, or not a metadata map at all.
    expect(refusal(cbor(metadataCbor({ msg: ['hi'] }, 674n)))).toBe('MISSING_LABEL');
    expect(refusal(cbor('80'))).toBe('INVALID_METADATA');
    expect(refusal(cbor('a120a0'))).toBe('INVALID_METADATA');
    // Byte string over the ledger's 64-byte limit.
    expect(refusal(cbor(`a119073ea2${types}6474657374${'5841' + '00'.repeat(65)}`))).toBe('INVALID_METADATA');
  });

  it('oversized input is refused before it is parsed', () => {
    expect(refusal(cbor('a0'.repeat(20000)))).toBe('TOO_LARGE');
    const many = `a119073ea2${'65747970657382' + '0002'}6474657374${'99' + '1388' + '00'.repeat(5000)}`;
    expect(refusal(cbor(many))).toBe('TOO_LARGE');
  });

  it('native scripts outside the vault grammar', () => {
    const meta = metadataCbor({ types: [0] });
    const one = (scriptHex: string) => refusal(cbor(meta, `81${scriptHex}`));
    const key = (n: number) => `8200581c${n.toString(16).padStart(2, '0').repeat(28)}`;
    // RequireGuard (kind 6) and an unassigned kind 9.
    expect(one(`8206${'8200581c' + 'aa'.repeat(28)}`)).toBe('UNKNOWN_SCRIPT_KIND');
    expect(one('820900')).toBe('UNKNOWN_SCRIPT_KIND');
    // The same key twice: one signature would count twice towards the threshold.
    expect(one(`830302${'82'}${key(1)}${key(1)}`)).toBe('DUPLICATE_SCRIPT_KEY');
    expect(one(`8202${'82'}${key(1)}${'8201' + '81'}${key(1)}`)).toBe('DUPLICATE_SCRIPT_KEY');
    // A threshold above the number of keys, a short key hash, a wrong arity.
    expect(one(`830303${'82'}${key(1)}${key(2)}`)).toBe('SCRIPT_INVALID');
    expect(one(`8200581b${'aa'.repeat(27)}`)).toBe('SCRIPT_INVALID');
    expect(one(`830201${'81'}${key(1)}`)).toBe('SCRIPT_INVALID');
    expect(one('8100')).toBe('SCRIPT_INVALID');
    // Nesting deeper than any vault template.
    let nested = key(1);
    for (let i = 0; i < 12; i++) nested = `820181${nested}`;
    expect(['MALFORMED_CBOR', 'SCRIPT_TOO_LARGE']).toContain(one(nested));
    // Non-canonical: indefinite-length sub-script list.
    expect(one(`8201${'9f'}${key(1)}ff`)).toBe('MALFORMED_CBOR');
  });

  it('inputs of the wrong shape', () => {
    for (const input of [null, undefined, 42, 'x', {}, { metadata: {} }, { metadata: { cbor: 7 }, nativeScripts: scripts() },
      { metadata: { cbor: 'zz' }, nativeScripts: scripts() }, { metadata: { json: { types: [0] } }, nativeScripts: { cbors: ['zz'] } },
      { metadata: { json: { types: [0] } }, nativeScripts: null }]) {
      const result = decodeRegistration(input as never);
      expect(result.ok).toBe(false);
    }
  });

  it('random and mutated bytes never throw', () => {
    const good = encodeRegistration(vault, { name: 'Treasury' }, { method: 'basic', salt: SALT }).offChain;
    let seed = 1;
    const rand = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    for (let i = 0; i < 500; i++) {
      const mutate = (hex: string) => {
        const bytes = Buffer.from(hex, 'hex');
        for (let j = 0; j < 1 + Math.floor(rand() * 4); j++) bytes[Math.floor(rand() * bytes.length)] = Math.floor(rand() * 256);
        return bytes.subarray(0, Math.max(1, Math.floor(bytes.length * (0.5 + rand() / 2)))).toString('hex');
      };
      const input = { metadata: { cbor: mutate(good.metadata) }, nativeScripts: { cbor: mutate(good.native_scripts) } };
      expect(() => decodeRegistration(input)).not.toThrow();
      const garbage = Buffer.from(Array.from({ length: 1 + Math.floor(rand() * 64) }, () => Math.floor(rand() * 256))).toString('hex');
      expect(() => decodeRegistration({ metadata: { cbor: garbage }, nativeScripts: { cbor: garbage } })).not.toThrow();
    }
  });
});

describe('rebuilding the vault from a registration and the participants keys', () => {
  it('finds every participant on their own and rebuilds the same scripts, whatever their order', async () => {
    const reg = decoded(fromOffChain(encodeRegistration(vault)));
    const shuffled = [people[2], people[0], people[1]];
    const result = await rebuildFromRegistration(reg, shuffled.map(external));
    expect(result).toMatchObject({ ok: true, indexes: [INDEX, INDEX, INDEX], canonicalOrder: true });
    if (result.ok !== true) return;
    expect(result.vault.payment.hash).toBe(vault.payment.hash);
    expect(result.vault.stake.hash).toBe(vault.stake.hash);
    const own = await deriveParticipantKeyHashes(people[0], INDEX);
    const slot = result.vault.owners.findIndex(o => o.payment === own.payment);
    expect(shuffled[result.owners[slot]]).toBe(people[0]);
  });

  it('accepts a registration with mixed indexes, and a cosigner known only by the keys they sent', async () => {
    const indexes = [21, 1, 0];
    const mixed = await buildVaultFromParticipants({
      template: { kind: 'standard', threshold: 2 },
      owners: people.map((roleKeys, i) => ({ roleKeys, index: indexes[i] })),
    });
    const reg = decoded(fromOffChain(encodeRegistration(mixed)));
    const sent = await deriveVaultPublicKeys(people[1], 1);
    const result = await rebuildFromRegistration(reg, [
      { kind: 'own', roleKeys: people[0], history: { onChain: [...Array(20).keys()].map(i => i + 1), held: [] } },
      { kind: 'vaultKeys', keys: sent },
      external(people[2]),
    ]);
    expect(result).toMatchObject({ ok: true, indexes: [21, undefined, 0] });
    if (result.ok === true) expect(result.vault.payment.hash).toBe(mixed.payment.hash);
  });

  it("the wallet's own scan stops after 20 consecutive indexes neither on chain nor held", async () => {
    const far = await buildVaultFromParticipants({
      template: { kind: 'standard', threshold: 2 },
      owners: [{ roleKeys: people[0], index: 25 }, { roleKeys: people[1], index: 1 }],
      acknowledged: ['ALL_OWNERS_REQUIRED'],
    });
    const reg = decoded(fromOffChain(encodeRegistration(far)));
    const cosigner = external(people[1]);
    expect(await rebuildFromRegistration(reg, [{ kind: 'own', roleKeys: people[0], history: { onChain: [], held: [] } }, cosigner]))
      .toEqual({ ok: false, code: 'PARTICIPANT_NOT_IN_VAULT', participant: 0 });
    const held = { onChain: [1, 2, 3, 4, 5, 6], held: [{ index: 7, kind: 'vault' as const }] };
    expect(await rebuildFromRegistration(reg, [{ kind: 'own', roleKeys: people[0], history: held }, cosigner]))
      .toMatchObject({ ok: true, indexes: [25, 1] });
    // An external wallet is scanned to index 100 and no further.
    const beyond = await buildVaultFromParticipants({
      template: { kind: 'standard', threshold: 2 },
      owners: [{ roleKeys: people[0], index: 101 }, { roleKeys: people[1], index: 1 }],
      acknowledged: ['ALL_OWNERS_REQUIRED'],
    });
    expect(await rebuildFromRegistration(decoded(fromOffChain(encodeRegistration(beyond))), [external(people[0]), cosigner]))
      .toEqual({ ok: false, code: 'PARTICIPANT_NOT_IN_VAULT', participant: 0 });
  });

  it('refuses a participant whose payment and stake keys sit at different indexes', async () => {
    const pay = await deriveParticipantKeyHashes(people[2], INDEX);
    const stake = await deriveParticipantKeyHashes(people[2], INDEX + 1);
    const split = { payment: pay.payment, stake: stake.stake };
    const others = await Promise.all(people.slice(0, 2).map(p => deriveParticipantKeyHashes(p, INDEX)));
    const v = instantiateVaultScripts(
      { template: vault.template, owners: [...others, split] },
      {
        payment: { owners: [...others, split].map(o => o.payment), backups: [] },
        stake: { owners: [...others, split].map(o => o.stake), backups: [] },
      },
    );
    expect(await rebuildFromRegistration(decoded(fromOffChain(encodeRegistration(v))), people.map(external)))
      .toEqual({ ok: false, code: 'ROLE_INDEX_MISMATCH', participant: 2 });
  });

  it('rebuilds the dated backup template and says who holds the backup keys', async () => {
    const reg = decoded(fromOffChain(encodeRegistration(backupVault)));
    const result = await rebuildFromRegistration(reg, people.map(external));
    expect(result).toMatchObject({ ok: true, backups: [2] });
    if (result.ok !== true) return;
    expect(result.vault.template).toEqual({ kind: 'backup', threshold: 2, backupThreshold: 1, backupAfterSlot: 123_456_789 });
  });

  it('accepts a registration in another key order, and says it is not the order Gero writes', async () => {
    const order = (keys: readonly Ed25519KeyHashHex[]) => [...keys].sort().reverse();
    const reordered = instantiateVaultScripts(
      { template: vault.template, owners: vault.owners },
      {
        payment: { owners: order(vault.owners.map(o => o.payment)), backups: [] },
        stake: { owners: order(vault.owners.map(o => o.stake)), backups: [] },
      },
    );
    const result = await rebuildFromRegistration(decoded(fromOffChain(encodeRegistration(reordered))), people.map(external));
    expect(result).toMatchObject({ ok: true, canonicalOrder: false });
  });

  it('refuses keys that are not all the participants, or a participant not in the vault', async () => {
    const reg = decoded(fromOffChain(encodeRegistration(vault)));
    expect(await rebuildFromRegistration(reg, [external(outsider)])).toEqual({ ok: false, code: 'PARTICIPANT_NOT_IN_VAULT', participant: 0 });
    expect(await rebuildFromRegistration(reg, people.slice(0, 2).map(external))).toEqual({ ok: false, code: 'FOREIGN_KEY' });
    expect(await rebuildFromRegistration(reg, [...people, outsider].map(external)))
      .toEqual({ ok: false, code: 'PARTICIPANT_NOT_IN_VAULT', participant: 3 });
    expect(await rebuildFromRegistration(reg, [...people, people[0]].map(external)))
      .toEqual({ ok: false, code: 'DUPLICATE_PARTICIPANT', participant: 3 });
  });

  it('refuses a participant with only one of their two keys in the vault', async () => {
    const other = await buildVaultFromParticipants({ template: vault.template, owners: people.map(at(INDEX + 1)) });
    const half = decoded(fromOffChain(encodeRegistration({ payment: vault.payment, stake: other.stake })));
    expect(await rebuildFromRegistration(half, [{ kind: 'vaultKeys', keys: await deriveVaultPublicKeys(people[0], INDEX) }]))
      .toEqual({ ok: false, code: 'PARTICIPANT_INCOMPLETE', participant: 0 });
    // Scanned, the stake key is found at the next index: a role index mismatch.
    expect(await rebuildFromRegistration(half, people.map(external))).toEqual({ ok: false, code: 'ROLE_INDEX_MISMATCH', participant: 0 });
  });

  it('refuses scripts that are not one of the two templates, or disagree', async () => {
    const keys = vault.owners;
    const allOf = vaultScript(ROLE.PAYMENT, { __type: native, kind: K.RequireAllOf, scripts: keys.map(k => ({ __type: native, kind: K.RequireSignature, keyHash: k.payment })) });
    const unknown = decoded(fromOffChain(encodeRegistration({ payment: allOf, stake: vault.stake })));
    expect(await rebuildFromRegistration(unknown, people.map(external))).toEqual({ ok: false, code: 'UNKNOWN_TEMPLATE' });

    const stake3 = vaultScript(ROLE.STAKE, { ...(vault.stake.script as Cardano.RequireAtLeastScript), required: 3 });
    const disagree = decoded(fromOffChain(encodeRegistration({ payment: vault.payment, stake: stake3 })));
    expect(await rebuildFromRegistration(disagree, people.map(external))).toEqual({ ok: false, code: 'TEMPLATE_MISMATCH' });

    const paymentOnly = decoded({ metadata: { json: { types: [0] } }, nativeScripts: { cbors: [vault.payment.cbor] } });
    expect(await rebuildFromRegistration(paymentOnly, people.map(external))).toEqual({ ok: false, code: 'STAKE_SCRIPT_MISSING' });
  });

  it('a registered vault outside the bounds is refused as such; an all-owners vault carries its warning', async () => {
    const withRequired = (required: number) =>
      vaultScript(ROLE.PAYMENT, { ...(vault.payment.script as Cardano.RequireAtLeastScript), required });
    const stakeWith = (required: number) =>
      vaultScript(ROLE.STAKE, { ...(vault.stake.script as Cardano.RequireAtLeastScript), required });
    const oneOfThree = decoded(fromOffChain(encodeRegistration({ payment: withRequired(1), stake: stakeWith(1) })));
    expect(await rebuildFromRegistration(oneOfThree, people.map(external))).toEqual({ ok: false, code: 'OUTSIDE_POLICY' });
    const threeOfThree = decoded(fromOffChain(encodeRegistration({ payment: withRequired(3), stake: stakeWith(3) })));
    const result = await rebuildFromRegistration(threeOfThree, people.map(external));
    expect(result).toMatchObject({ ok: true, vault: { warnings: ['ALL_OWNERS_REQUIRED'] } });
  });

  it('refuses bad input and never throws', async () => {
    const reg = decoded(fromOffChain(encodeRegistration(vault)));
    expect(await rebuildFromRegistration(reg, [])).toEqual({ ok: false, code: 'INVALID_OPTIONS' });
    expect((await rebuildFromRegistration(null as never, people.map(external))).ok).toBe(false);
    expect((await rebuildFromRegistration(reg, [null] as never)).ok).toBe(false);
    expect((await rebuildFromRegistration(reg, [{ kind: 'external', roleKeys: null }] as never)).ok).toBe(false);
  });
});
