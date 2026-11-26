// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16, blake2b as sdkBlake2b } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { CborItem, bytesToHex, hexToBytes, readCbor } from './cbor';
import { decodeRecoveryPayload, encodeRecoveryPayload, manifestHash, RecoveryPackageContents } from './recoveryPayload';
import { vaultScript } from './scripts';
import { ROLE, RoleKeys } from './types';
import { backupContents, plutusContents, standardContents, standardVault, vectorPeople } from './__fixtures__/recoveryPackageVectors';

/** An order-preserving CBOR tree, to write payloads the encoder never would. */
type T =
  | { t: 'int'; v: bigint }
  | { t: 'bytes'; v: Uint8Array }
  | { t: 'text'; v: string }
  | { t: 'array'; v: T[] }
  | { t: 'map'; v: [T, T][] };

const tree = (item: CborItem): T => {
  const v = item.value;
  switch (v.type) {
    case 'array':
      return { t: 'array', v: v.value.map(tree) };
    case 'map':
      return { t: 'map', v: v.value.map(([a, b]) => [tree(a), tree(b)]) };
    default:
      return { t: v.type, v: v.value } as T;
  }
};

function head(major: number, n: bigint): number[] {
  const m = major << 5;
  if (n < 24n) return [m | Number(n)];
  const size = n < 0x100n ? 1 : n < 0x10000n ? 2 : n < 0x100000000n ? 4 : 8;
  const out = [m | (24 + Math.log2(size))];
  for (let i = size - 1; i >= 0; i--) out.push(Number((n >> BigInt(8 * i)) & 0xffn));
  return out;
}

function enc(x: T): number[] {
  switch (x.t) {
    case 'int':
      return x.v >= 0n ? head(0, x.v) : head(1, -1n - x.v);
    case 'bytes':
      return [...head(2, BigInt(x.v.length)), ...x.v];
    case 'text': {
      const b = new TextEncoder().encode(x.v);
      return [...head(3, BigInt(b.length)), ...b];
    }
    case 'array':
      return [...head(4, BigInt(x.v.length)), ...x.v.flatMap(enc)];
    case 'map':
      return [...head(5, BigInt(x.v.length)), ...x.v.flatMap(([a, b]) => [...enc(a), ...enc(b)])];
  }
}

const bytesOf = (x: T) => Uint8Array.from(enc(x));
const int = (n: number | bigint): T => ({ t: 'int', v: BigInt(n) });
const field = (m: T, key: number): T => {
  if (m.t !== 'map') throw new Error('not a map');
  const found = m.v.find(([k]) => k.t === 'int' && k.v === BigInt(key));
  if (!found) throw new Error(`no key ${key}`);
  return found[1];
};
const put = (m: T, key: number, value: T): T => {
  if (m.t !== 'map') throw new Error('not a map');
  const rest = m.v.filter(([k]) => !(k.t === 'int' && k.v === BigInt(key)));
  const out: [T, T][] = [...rest, [int(key), value]];
  return { t: 'map', v: out.sort(([a], [b]) => Number((a as { v: bigint }).v - (b as { v: bigint }).v)) };
};
const drop = (m: T, key: number): T => {
  if (m.t !== 'map') throw new Error('not a map');
  return { t: 'map', v: m.v.filter(([k]) => !(k.t === 'int' && k.v === BigInt(key))) };
};
const at = (a: T, i: number): T => {
  if (a.t !== 'array') throw new Error('not an array');
  return a.v[i];
};
const withItem = (a: T, i: number, value: T): T => {
  if (a.t !== 'array') throw new Error('not an array');
  return { t: 'array', v: a.v.map((x, j) => (j === i ? value : x)) };
};

const LIMITS = { maxDepth: 16, maxItems: 100000 };
const treeOf = (bytes: Uint8Array) => tree(readCbor(bytes, LIMITS));

function refusal(bytes: unknown): string {
  const r = decodeRecoveryPayload(bytes);
  return r.ok === true ? 'ACCEPTED' : r.code;
}

function detail(bytes: unknown): string {
  const r = decodeRecoveryPayload(bytes);
  return r.ok === true ? 'ACCEPTED' : r.detail ?? '';
}

let people: RoleKeys[];
let ownerKeyHash: Ed25519KeyHashHex;
let standard: RecoveryPackageContents;
let backup: RecoveryPackageContents;
let plutus: RecoveryPackageContents;
let standardTree: T;
let backupTree: T;
let plutusTree: T;

beforeAll(async () => {
  people = await vectorPeople();
  ownerKeyHash = (await standardVault(people)).owners[0].payment;
  [standard, backup, plutus] = await Promise.all([standardContents(people), backupContents(people), plutusContents(people)]);
  standardTree = treeOf(encodeRecoveryPayload(standard));
  backupTree = treeOf(encodeRecoveryPayload(backup));
  plutusTree = treeOf(encodeRecoveryPayload(plutus));
});

describe('round trip', () => {
  it.each(['standard', 'backup', 'plutus'] as const)('%s contents decode to what was encoded', name => {
    const contents = { standard, backup, plutus }[name];
    const decoded = decodeRecoveryPayload(encodeRecoveryPayload(contents));
    if (decoded.ok !== true) throw new Error(`${decoded.code} ${decoded.detail}`);
    const { version, manifests, ...rest } = decoded.package;
    expect(version).toBe(1);
    expect(rest.network).toBe(contents.network);
    expect(rest.self).toEqual(contents.self);
    expect(rest.participants).toEqual(contents.participants);
    expect(rest.addressBook).toEqual(contents.addressBook);
    expect(rest.proposals).toEqual(contents.proposals);
    expect(rest.referenceScripts).toEqual(contents.referenceScripts);
    expect(manifests.map(({ version: v, cbor }) => ({ version: v, cbor }))).toEqual(contents.manifests);
    if (contents.vault.kind === 'native' && rest.vault.kind === 'native') {
      expect(rest.vault.payment.hash).toBe(contents.vault.payment.hash);
      expect(rest.vault.stake.cbor).toBe(contents.vault.stake.cbor);
      expect(rest.vault.backup).toEqual(contents.vault.backup);
    } else {
      expect(rest.vault).toEqual(contents.vault);
    }
  });

  it('gives each manifest revision its blake2b-256 hash', () => {
    const decoded = decodeRecoveryPayload(encodeRecoveryPayload(backup));
    if (decoded.ok !== true) throw new Error(decoded.code);
    for (const m of decoded.package.manifests) {
      expect(m.hash).toBe(sdkBlake2b.hash(HexBlob(m.cbor), 32));
      expect(manifestHash(m.cbor)).toBe(m.hash);
    }
  });

  it('writes map keys in canonical order whatever order the contents list them in', () => {
    const shuffled = { referenceScripts: standard.referenceScripts, ...standard, network: standard.network };
    expect(bytesToHex(encodeRecoveryPayload(shuffled))).toBe(bytesToHex(encodeRecoveryPayload(standard)));
  });
});

describe('versions', () => {
  it('reports a later payload version as such, whatever else it changed', () => {
    expect(refusal(bytesOf(put(standardTree, 0, int(2))))).toBe('UNKNOWN_PAYLOAD_VERSION');
    expect(refusal(bytesOf({ t: 'map', v: [[int(0), int(7)], [int(99), { t: 'text', v: 'new field' }]] }))).toBe('UNKNOWN_PAYLOAD_VERSION');
    expect(refusal(bytesOf(drop(standardTree, 0)))).toBe('PAYLOAD_INVALID');
    expect(refusal(bytesOf(put(standardTree, 0, { t: 'text', v: '1' })))).toBe('PAYLOAD_INVALID');
  });
});

describe('strict decoding of untrusted bytes', () => {
  it('refuses what is not a payload', () => {
    expect(refusal('aa00')).toBe('PAYLOAD_INVALID');
    expect(refusal(new Uint8Array(0))).toBe('PAYLOAD_INVALID');
    expect(refusal(bytesOf({ t: 'array', v: [int(1)] }))).toBe('PAYLOAD_INVALID');
  });

  it('refuses unknown and missing keys at every level', () => {
    expect(refusal(bytesOf(put(standardTree, 10, int(0))))).toBe('PAYLOAD_INVALID');
    for (const key of [1, 2, 3, 4, 5, 6, 7, 8, 9]) expect(refusal(bytesOf(drop(standardTree, key)))).toBe('PAYLOAD_INVALID');
    const vault = field(standardTree, 3);
    expect(refusal(bytesOf(put(standardTree, 3, put(vault, 9, int(0)))))).toBe('PAYLOAD_INVALID');
    const participants = field(standardTree, 5);
    const p0 = at(participants, 0);
    expect(refusal(bytesOf(put(standardTree, 5, withItem(participants, 0, put(p0, 4, int(0))))))).toBe('PAYLOAD_INVALID');
    expect(refusal(bytesOf(put(standardTree, 4, put(field(standardTree, 4), 2, int(0)))))).toBe('PAYLOAD_INVALID');
  });

  it('refuses keys out of canonical order, so one payload has one encoding', () => {
    if (standardTree.t !== 'map') throw new Error('map');
    const swapped: T = { t: 'map', v: [standardTree.v[1], standardTree.v[0], ...standardTree.v.slice(2)] };
    expect(detail(bytesOf(swapped))).toBe('not the canonical encoding');
  });

  it('refuses the encodings the strict reader refuses', () => {
    const canonical = encodeRecoveryPayload(standard);
    const hex = bytesToHex(canonical);
    // aa 00 01 01 01: version 1, network magic 1. Rewrite the magic with a one-byte argument.
    expect(hex.startsWith('aa00010101')).toBe(true);
    expect(detail(hexToBytes(`aa0001011801${hex.slice(10)}`))).toBe('CBOR NON_MINIMAL');
    expect(detail(new Uint8Array([...canonical, 0]))).toBe('CBOR TRAILING_BYTES');
    expect(detail(canonical.subarray(0, canonical.length - 1))).toBe('CBOR TRUNCATED');
    expect(detail(hexToBytes(`aa0001010001${hex.slice(10)}`))).toBe('CBOR DUPLICATE_MAP_KEY');
    // Proposals (key 7) as an indefinite-length list.
    const proposals = hex.indexOf('0780', hex.length - 20);
    expect(detail(hexToBytes(`${hex.slice(0, proposals)}079fff${hex.slice(proposals + 4)}`))).toBe('CBOR INDEFINITE_LENGTH');
    // A tag around the export time.
    expect(detail(hexToBytes(hex.replace('021b000001a21526e400', '02c11b000001a21526e400')))).toBe('CBOR UNSUPPORTED_TYPE');
  });

  it('refuses unknown networks and values out of range', () => {
    expect(refusal(bytesOf(put(standardTree, 1, int(3))))).toBe('PAYLOAD_INVALID');
    expect(refusal(bytesOf(put(standardTree, 2, int(-1))))).toBe('PAYLOAD_INVALID');
    expect(refusal(bytesOf(put(standardTree, 4, put(field(standardTree, 4), 1, int(0x80000000)))))).toBe('PAYLOAD_INVALID');
    expect(refusal(bytesOf(put(standardTree, 4, put(field(standardTree, 4), 0, int(3)))))).toBe('PAYLOAD_INVALID');
    const ref = at(field(plutusTree, 9), 0);
    expect(refusal(bytesOf(put(plutusTree, 9, { t: 'array', v: [withItem(ref, 1, int(65536))] })))).toBe('PAYLOAD_INVALID');
  });

  it('refuses roles and keys that do not fit the vault kind', () => {
    const participants = field(standardTree, 5);
    const p0 = at(participants, 0);
    const withP0 = (p: T) => bytesOf(put(standardTree, 5, withItem(participants, 0, p)));
    expect(detail(withP0(put(p0, 0, int(2))))).toBe('A native vault has no guardians');
    expect(refusal(withP0(put(p0, 0, int(3))))).toBe('PAYLOAD_INVALID');
    expect(detail(withP0(drop(p0, 2)))).toBe('A stake vault key is lowercase hex of the right length');
    expect(detail(withP0(put(p0, 2, field(p0, 1))))).toBe('The same vault key appears twice');
    expect(detail(bytesOf(put(standardTree, 5, withItem(participants, 1, p0))))).toBe('The same vault key appears twice');

    const pp = field(plutusTree, 5);
    const withPlutus = (i: number, p: T) => bytesOf(put(plutusTree, 5, withItem(pp, i, p)));
    expect(detail(withPlutus(0, put(at(pp, 0), 0, int(1))))).toBe('A Plutus vault has no backup holders');
    expect(detail(withPlutus(0, put(at(pp, 0), 2, field(at(field(standardTree, 5), 0), 2))))).toBe('A Plutus vault participant has no stake vault key');
    const external = field(at(field(backupTree, 5), 1), 3);
    expect(detail(withPlutus(2, put(at(pp, 2), 3, external)))).toBe('A guardian signs with a Gero wallet');
  });

  it('refuses an exporter who is not a participant or is an external wallet', () => {
    expect(refusal(bytesOf(put(standardTree, 4, put(field(standardTree, 4), 0, int(3)))))).toBe('PAYLOAD_INVALID');
    expect(detail(bytesOf(put(backupTree, 4, put(field(backupTree, 4), 0, int(1)))))).toBe('The exporter is not an external wallet');
    expect(refusal(bytesOf(put(standardTree, 5, { t: 'array', v: [] })))).toBe('PAYLOAD_INVALID');
  });

  it('refuses malformed external keys', () => {
    const participants = field(backupTree, 5);
    const p1 = at(participants, 1);
    const withExternal = (e: T) => bytesOf(put(backupTree, 5, withItem(participants, 1, put(p1, 3, e))));
    const xpub = at(field(p1, 3), 1);
    expect(refusal(withExternal({ t: 'array', v: [int(1), xpub] }))).toBe('PAYLOAD_INVALID');
    expect(refusal(withExternal({ t: 'array', v: [int(2), xpub] }))).toBe('PAYLOAD_INVALID');
    expect(refusal(withExternal({ t: 'array', v: [int(0), { t: 'bytes', v: new Uint8Array(32) }] }))).toBe('PAYLOAD_INVALID');
    // An account key is accepted in that slot.
    expect(refusal(withExternal({ t: 'array', v: [int(0), xpub] }))).toBe('ACCEPTED');
  });

  it('refuses history and address book entries out of order, repeated or off the network', () => {
    const manifests = field(backupTree, 6);
    if (manifests.t !== 'array') throw new Error('array');
    expect(detail(bytesOf(put(backupTree, 6, { t: 'array', v: [manifests.v[1], manifests.v[0]] })))).toBe('Manifest versions are unsigned and strictly ascending');
    expect(detail(bytesOf(put(backupTree, 6, { t: 'array', v: [manifests.v[0], manifests.v[0]] })))).toBe('Manifest versions are unsigned and strictly ascending');
    const proposals = field(backupTree, 7);
    expect(detail(bytesOf(put(backupTree, 7, { t: 'array', v: [at(proposals, 0), at(proposals, 0)] })))).toBe('The same proposal appears twice');
    const book = field(backupTree, 8);
    const entry = at(book, 0);
    expect(detail(bytesOf(put(backupTree, 8, { t: 'array', v: [entry, entry] })))).toBe('The same address appears twice in the address book');
    const withBook = (e: T) => bytesOf(put(backupTree, 8, { t: 'array', v: [e] }));
    const mainnet = Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Mainnet, {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16('1c'.repeat(28)),
    }).toAddress();
    expect(detail(withBook(withItem(entry, 0, { t: 'bytes', v: hexToBytes(mainnet.toBytes()) as Uint8Array })))).toBe('An address book entry is a Shelley payment address on the vault network');
    const reward = Cardano.RewardAddress.fromCredentials(Cardano.NetworkId.Testnet, {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16('1c'.repeat(28)),
    }).toAddress();
    expect(detail(withBook(withItem(entry, 0, { t: 'bytes', v: hexToBytes(reward.toBytes()) as Uint8Array })))).toBe('An address book entry is a Shelley payment address on the vault network');
    expect(refusal(withBook(withItem(entry, 0, { t: 'bytes', v: new Uint8Array(29) })))).toBe('PAYLOAD_INVALID');
    expect(refusal(withBook(withItem(entry, 1, { t: 'text', v: '' })))).toBe('PAYLOAD_INVALID');
    expect(refusal(withBook(withItem(entry, 1, { t: 'text', v: 'x'.repeat(65) })))).toBe('PAYLOAD_INVALID');
    expect(refusal(withBook(withItem(entry, 1, { t: 'text', v: 'x'.repeat(64) })))).toBe('ACCEPTED');
    const refs = field(backupTree, 9);
    expect(detail(bytesOf(put(backupTree, 9, { t: 'array', v: [at(refs, 0), at(refs, 0)] })))).toBe('The same reference script UTxO appears twice');
  });

  it('refuses scripts that are not canonical, not native vault scripts, or not a script at all', () => {
    const vault = field(standardTree, 3);
    const withPayment = (b: Uint8Array) => bytesOf(put(standardTree, 3, put(vault, 1, { t: 'bytes', v: b })));
    const payment = (field(vault, 1) as { v: Uint8Array }).v;
    // The same script with its threshold written with a one-byte argument.
    const loose = hexToBytes(bytesToHex(payment).replace(/^830302/, '83031802')) as Uint8Array;
    expect(detail(withPayment(loose))).toBe('A vault script is refused: MALFORMED_CBOR');
    expect(detail(withPayment(Uint8Array.of(0x82, 0x07, 0x00)))).toBe('A vault script is refused: UNKNOWN_SCRIPT_KIND');
    expect(detail(withPayment(Uint8Array.of(0x01)))).toBe('A vault script is refused: SCRIPT_INVALID');
    // A key repeated inside a script would count one signature twice.
    const sig: Cardano.NativeScript = { __type: Cardano.ScriptType.Native, kind: Cardano.NativeScriptKind.RequireSignature, keyHash: ownerKeyHash };
    const k = vaultScript(ROLE.PAYMENT, { __type: Cardano.ScriptType.Native, kind: Cardano.NativeScriptKind.RequireNOf, required: 2, scripts: [sig, sig] });
    expect(detail(withPayment(hexToBytes(k.cbor) as Uint8Array))).toBe('A vault script is refused: DUPLICATE_SCRIPT_KEY');
  });

  it('refuses nesting deeper than the schema', () => {
    let deep: T = int(0);
    for (let i = 0; i < 8; i++) deep = { t: 'array', v: [deep] };
    expect(detail(bytesOf(put(standardTree, 7, deep)))).toBe('CBOR TOO_DEEP');
  });

  it('never throws on mutated or random bytes, and accepts only canonical payloads', () => {
    let seed = 0x1854;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const sources = [standard, backup, plutus].map(c => encodeRecoveryPayload(c));
    for (let round = 0; round < 600; round++) {
      const source = sources[round % sources.length];
      const bytes = round % 5 === 0 ? Uint8Array.from({ length: rand() % 300 }, () => rand() & 0xff) : Uint8Array.from(source);
      if (round % 5 !== 0) for (let n = 0; n <= rand() % 4; n++) bytes[rand() % bytes.length] = rand() & 0xff;
      const result = decodeRecoveryPayload(bytes);
      if (result.ok === true) expect(bytesToHex(encodeRecoveryPayload(result.package))).toBe(bytesToHex(bytes));
      else expect(['PAYLOAD_INVALID', 'UNKNOWN_PAYLOAD_VERSION']).toContain(result.code);
    }
  });
});

describe('encoder', () => {
  const throwsInvalid = (contents: unknown) =>
    expect(() => encodeRecoveryPayload(contents as RecoveryPackageContents)).toThrow(expect.objectContaining({ code: 'INVALID_PACKAGE' }));

  it('refuses contents that break a rule, naming it', () => {
    throwsInvalid(undefined);
    throwsInvalid({ ...standard, network: 'sanchonet' });
    throwsInvalid({ ...standard, exportedAtMs: -1 });
    throwsInvalid({ ...standard, exportedAtMs: 1.5 });
    throwsInvalid({ ...standard, vault: { ...standard.vault, kind: 'other' } });
    throwsInvalid({ ...standard, self: { position: 0, index: -1 } });
    throwsInvalid({ ...standard, participants: [{ ...standard.participants[0], payment: standard.participants[0].payment.toUpperCase() }, ...standard.participants.slice(1)] });
    throwsInvalid({ ...standard, manifests: [{ version: 0, cbor: '' }] });
    throwsInvalid({ ...standard, proposals: [{ id: 'zz', cbor: '00' }] });
    throwsInvalid({ ...standard, addressBook: [{ address: 'addr_test1notanaddress', label: 'x' }] });
    throwsInvalid({ ...standard, referenceScripts: [{ txId: 'ab'.repeat(32), index: 1.5 }] });
    throwsInvalid({ ...plutus, vault: { ...plutus.vault, templateVersion: 2 ** 32 } });
    throwsInvalid({ ...plutus, vault: { ...plutus.vault, scriptHash: 'ab' } });
  });

  it('refuses a script record whose hash is not its bytes', () => {
    if (standard.vault.kind !== 'native' || backup.vault.kind !== 'native') throw new Error('native');
    throwsInvalid({ ...standard, vault: { ...standard.vault, payment: { ...standard.vault.payment, hash: backup.vault.payment.hash } } });
  });
});
