// @vitest-environment node
import { beforeAll, describe, expect, it } from 'vitest';
import { Cardano } from '@cardano-sdk/core';
import { Ed25519KeyHashHex, Hash28ByteBase16, blake2b as sdkBlake2b } from '@cardano-sdk/crypto';
import { HexBlob } from '@cardano-sdk/util';
import { CborItem, bytesToHex, hexToBytes, readCbor } from './cbor';
import { MAX_RECOVERY_PAYLOAD_BYTES } from './recoveryFormat';
import {
  MAX_ADDRESS_BOOK_ENTRIES,
  MAX_EXTERNAL_ATTESTATIONS,
  MAX_MANIFEST_BYTES,
  MAX_MANIFEST_REVISIONS,
  MAX_PROPOSAL_BYTES,
  MAX_PROPOSALS,
  RecoveryPackageContents,
  decodeRecoveryPayload,
  encodeRecoveryPayload,
  fitRecoveryHistory,
  manifestRevisionHash,
} from './recoveryPayload';
import { vaultScript } from './scripts';
import { ROLE, RoleKeys } from './types';
import { ENDORSEMENT, EXTERNAL_ATTESTATION, backupContents, plutusContents, standardContents, standardVault, vectorPeople } from './__fixtures__/recoveryPackageVectors';

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

const LIMITS = { maxDepth: 16, maxItems: 1000000 };
const treeOf = (bytes: Uint8Array) => tree(readCbor(bytes, LIMITS));

function refusal(bytes: unknown): string {
  const r = decodeRecoveryPayload(bytes);
  return r.ok === true ? 'ACCEPTED' : r.code;
}

function detail(bytes: unknown): string {
  const r = decodeRecoveryPayload(bytes);
  return r.ok === true ? 'ACCEPTED' : r.detail ?? '';
}

const RLO = String.fromCharCode(0x202e);
const UNASSIGNED = String.fromCharCode(0x0378);

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
    const p = decoded.package;
    expect(p.version).toBe(1);
    expect(p.network).toBe(contents.network);
    expect(p.self).toEqual(contents.self);
    expect(p.participants).toEqual(contents.participants);
    expect(p.addressBook).toEqual(contents.addressBook);
    expect(p.proposals).toEqual(contents.proposals);
    expect(p.referenceScripts).toEqual(contents.referenceScripts);
    expect(p.proposalsDropped).toBe(0);
    expect(p.proposalHistoryTruncated).toBe(false);
    expect(p.addressBookDropped).toBe(0);
    expect(p.addressBookTruncated).toBe(false);
    expect(p.manifestsDropped).toBe(0);
    expect(p.endorsements).toEqual(contents.endorsements ?? []);
    expect(p.externalAttestations).toEqual(contents.externalAttestations ?? []);
    expect(p.manifests.map(({ version, cbor }) => ({ version, cbor }))).toEqual(contents.manifests);
    if (contents.vault.kind === 'native' && p.vault.kind === 'native') {
      expect(p.vault.payment.hash).toBe(contents.vault.payment.hash);
      expect(p.vault.stake.cbor).toBe(contents.vault.stake.cbor);
      expect(p.vault.backup).toEqual(contents.vault.backup);
    } else {
      expect(p.vault).toEqual(contents.vault);
    }
  });

  it('gives each manifest revision its tagged blake2b-256 hash', () => {
    const decoded = decodeRecoveryPayload(encodeRecoveryPayload(backup));
    if (decoded.ok !== true) throw new Error(decoded.code);
    const tag = Buffer.from('gero-vault/v1|manifest|', 'utf8').toString('hex');
    for (const m of decoded.package.manifests) {
      expect(m.hash).toBe(sdkBlake2b.hash(HexBlob(`${tag}${m.cbor}`), 32));
      expect(manifestRevisionHash(m.cbor)).toBe(m.hash);
    }
    expect(manifestRevisionHash('AB')).toBeUndefined();
    expect(manifestRevisionHash('abc')).toBeUndefined();
    expect(manifestRevisionHash(42)).toBeUndefined();
  });

  it('writes map keys in canonical order whatever order the contents list them in', () => {
    const shuffled = { referenceScripts: standard.referenceScripts, ...standard, network: standard.network };
    expect(bytesToHex(encodeRecoveryPayload(shuffled))).toBe(bytesToHex(encodeRecoveryPayload(standard)));
  });

  it('does not alias its input: changing the bytes after decoding changes nothing', () => {
    const bytes = encodeRecoveryPayload(backup);
    const decoded = decodeRecoveryPayload(bytes);
    if (decoded.ok !== true) throw new Error(decoded.code);
    const snapshot = JSON.stringify(decoded.package);
    bytes.fill(0);
    expect(JSON.stringify(decoded.package)).toBe(snapshot);
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
  it('refuses what is not a payload, readable bytes or not, without throwing', () => {
    const bytes = encodeRecoveryPayload(standard);
    expect(refusal('aa00')).toBe('PAYLOAD_INVALID');
    expect(refusal(new Uint8Array(0))).toBe('PAYLOAD_INVALID');
    expect(refusal(bytesOf({ t: 'array', v: [int(1)] }))).toBe('PAYLOAD_INVALID');
    for (const input of [null, bytes.buffer, new DataView(bytes.buffer), Object.create(Uint8Array.prototype), new Proxy(Uint8Array.from(bytes), {})]) {
      expect(() => decodeRecoveryPayload(input)).not.toThrow();
      expect(refusal(input)).toBe('PAYLOAD_INVALID');
    }
    expect(refusal(Buffer.from(bytes))).toBe('ACCEPTED');
  });

  it('refuses unknown and missing keys at every level', () => {
    expect(refusal(bytesOf(put(standardTree, 15, int(0))))).toBe('PAYLOAD_INVALID');
    for (const key of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]) expect(refusal(bytesOf(drop(standardTree, key)))).toBe('PAYLOAD_INVALID');
    const vault = field(standardTree, 3);
    expect(refusal(bytesOf(put(standardTree, 3, put(vault, 9, int(0)))))).toBe('PAYLOAD_INVALID');
    const participants = field(standardTree, 5);
    const p0 = at(participants, 0);
    expect(refusal(bytesOf(put(standardTree, 5, withItem(participants, 0, put(p0, 5, int(0))))))).toBe('PAYLOAD_INVALID');
    expect(refusal(bytesOf(put(standardTree, 4, put(field(standardTree, 4), 2, int(0)))))).toBe('PAYLOAD_INVALID');
    // The backup terms are a threshold and a slot only: a date beside them is an unknown key.
    const terms = field(field(backupTree, 3), 3);
    expect(detail(bytesOf(put(backupTree, 3, put(field(backupTree, 3), 3, put(terms, 2, int(1858852800000))))))).toBe('backup terms has an unknown key');
    // A Plutus vault carries no recorded hash beside its validator.
    expect(detail(bytesOf(put(plutusTree, 3, put(field(plutusTree, 3), 4, { t: 'bytes', v: new Uint8Array(28) }))))).toBe('plutus vault has an unknown key');
    expect(detail(bytesOf(put(plutusTree, 3, drop(field(plutusTree, 3), 3))))).toBe('plutus vault lacks key 3');
  });

  it('refuses keys out of canonical order, so one payload has one encoding', () => {
    if (standardTree.t !== 'map') throw new Error('map');
    const swapped: T = { t: 'map', v: [standardTree.v[1], standardTree.v[0], ...standardTree.v.slice(2)] };
    expect(detail(bytesOf(swapped))).toBe('not the canonical encoding');
  });

  it('refuses the encodings the strict reader refuses', () => {
    const canonical = encodeRecoveryPayload(standard);
    const hex = bytesToHex(canonical);
    // af 00 01 01 01: fifteen keys, version 1, network magic 1. Rewrite the magic with a one-byte argument.
    expect(hex.startsWith('af00010101')).toBe(true);
    expect(detail(hexToBytes(`af0001011801${hex.slice(10)}`))).toBe('CBOR NON_MINIMAL');
    expect(detail(new Uint8Array([...canonical, 0]))).toBe('CBOR TRAILING_BYTES');
    expect(detail(canonical.subarray(0, canonical.length - 1))).toBe('CBOR TRUNCATED');
    expect(detail(hexToBytes(`af0001010001${hex.slice(10)}`))).toBe('CBOR DUPLICATE_MAP_KEY');
    // Proposals (key 7) as an indefinite-length list.
    const proposals = hex.indexOf('0780', hex.length - 40);
    expect(detail(hexToBytes(`${hex.slice(0, proposals)}079fff${hex.slice(proposals + 4)}`))).toBe('CBOR INDEFINITE_LENGTH');
    // A tag around the export time.
    expect(detail(hexToBytes(hex.replace('021b000001a21526e400', '02c11b000001a21526e400')))).toBe('CBOR UNSUPPORTED_TYPE');
  });

  it('refuses unknown networks and values out of range', () => {
    expect(refusal(bytesOf(put(standardTree, 1, int(3))))).toBe('PAYLOAD_INVALID');
    expect(refusal(bytesOf(put(standardTree, 2, int(-1))))).toBe('PAYLOAD_INVALID');
    expect(refusal(bytesOf(put(standardTree, 10, int(-1))))).toBe('PAYLOAD_INVALID');
    expect(refusal(bytesOf(put(standardTree, 11, int(-1))))).toBe('PAYLOAD_INVALID');
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
    for (const i of [0, 2]) {
      expect(detail(withPlutus(i, put(at(pp, i), 2, field(p0, 2))))).toBe('A Plutus vault participant has no stake vault key');
    }
    const external = field(at(field(backupTree, 5), 1), 3);
    expect(detail(withPlutus(2, put(at(pp, 2), 3, external)))).toBe('A guardian signs with a Gero wallet');
    // An external owner of a Plutus vault is allowed.
    expect(refusal(withPlutus(1, put(at(pp, 1), 3, external)))).toBe('ACCEPTED');
  });

  it('refuses labels that are empty, too long or carry control characters', () => {
    const participants = field(backupTree, 5);
    const p0 = at(participants, 0);
    const withLabel = (text: string) => bytesOf(put(backupTree, 5, withItem(participants, 0, put(p0, 4, { t: 'text', v: text }))));
    expect(refusal(withLabel('x'.repeat(64)))).toBe('ACCEPTED');
    for (const bad of ['', 'x'.repeat(65), 'line\nbreak', 'nul\u0000']) expect(refusal(withLabel(bad))).toBe('PAYLOAD_INVALID');
    // The reader needs no Unicode tables: format and unassigned code points are read as stored.
    for (const stored of ['Alice' + RLO + 'ecila', 'new' + UNASSIGNED]) expect(refusal(withLabel(stored))).toBe('ACCEPTED');
  });

  it('refuses endorsements and external attestations of the wrong shape, and repeated ones', () => {
    const endorsements = field(backupTree, 12);
    const one = at(endorsements, 0);
    expect(detail(bytesOf(put(backupTree, 12, { t: 'array', v: [one, one] })))).toBe('The same entry appears twice in the endorsements');
    expect(refusal(bytesOf(put(backupTree, 12, { t: 'array', v: [withItem(one, 3, { t: 'bytes', v: new Uint8Array(32) })] })))).toBe('PAYLOAD_INVALID');
    expect(refusal(bytesOf(put(backupTree, 12, { t: 'array', v: [withItem(one, 4, { t: 'bytes', v: new Uint8Array(63) })] })))).toBe('PAYLOAD_INVALID');
    const attestation = at(field(backupTree, 13), 0);
    expect(refusal(bytesOf(put(backupTree, 13, { t: 'array', v: [withItem(attestation, 1, { t: 'bytes', v: new Uint8Array(4097) })] })))).toBe('PAYLOAD_INVALID');
    expect(refusal(bytesOf(put(backupTree, 13, { t: 'array', v: [withItem(attestation, 0, int(256))] })))).toBe('PAYLOAD_INVALID');
    expect(refusal(bytesOf(put(backupTree, 13, { t: 'array', v: [withItem(attestation, 1, { t: 'bytes', v: new Uint8Array(4096) })] })))).toBe('ACCEPTED');
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

  it('survives structural mutations: whatever it accepts round-trips and does not alias the input', () => {
    let seed = 0xc0ffee;
    const rand = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed;
    };
    const pick = <X>(a: readonly X[]): X => a[rand() % a.length];
    const random = (depth: number): T => {
      switch (rand() % (depth > 3 ? 3 : 5)) {
        case 0: return int(pick([0n, 1n, 2n, 23n, 24n, 255n, 256n, 65535n, 65536n, 0xffffffffn, 2n ** 53n, 2n ** 64n - 1n, -1n, BigInt(rand())]));
        case 1: return { t: 'bytes', v: Uint8Array.from({ length: pick([0, 1, 28, 29, 32, 33, 64, 65, rand() % 100]) }, () => rand() & 0xff) };
        case 2: return { t: 'text', v: pick(['', 'a', 'x'.repeat(64), 'x'.repeat(65), '\u00E9', '\u{1F600}']) };
        case 3: return { t: 'array', v: Array.from({ length: rand() % 4 }, () => random(depth + 1)) };
        default: return { t: 'map', v: Array.from({ length: rand() % 4 }, (_, i) => [int(i), random(depth + 1)] as [T, T]) };
      }
    };
    const clone = (x: T): T =>
      x.t === 'array' ? { t: 'array', v: x.v.map(clone) }
        : x.t === 'map' ? { t: 'map', v: x.v.map(([a, b]) => [clone(a), clone(b)] as [T, T]) }
          : x.t === 'bytes' ? { t: 'bytes', v: Uint8Array.from(x.v) } : { ...x };
    const nodes = (x: T, set: (n: T) => void, out: { node: T; set: (n: T) => void }[] = []) => {
      out.push({ node: x, set });
      if (x.t === 'array') x.v.forEach((c, i) => nodes(c, n => { x.v[i] = n; }, out));
      if (x.t === 'map') x.v.forEach(e => { nodes(e[0], n => { e[0] = n; }, out); nodes(e[1], n => { e[1] = n; }, out); });
      return out;
    };
    const trees = [standardTree, backupTree, plutusTree];
    for (let round = 0; round < 3000; round++) {
      const holder = { root: clone(trees[round % 3]) };
      const all = nodes(holder.root, n => { holder.root = n; });
      for (let s = 0; s <= rand() % 3; s++) {
        const { node, set } = pick(all);
        switch (rand() % 8) {
          case 0: set(random(2)); break;
          case 1: if (node.t === 'int') set(int(node.v + BigInt(pick([1, -1, 255, 1000000])))); break;
          case 2: if (node.t === 'bytes' && node.v.length) { const b = Uint8Array.from(node.v); b[rand() % b.length] ^= 1 << (rand() % 8); set({ t: 'bytes', v: b }); } break;
          case 3: if (node.t === 'array' && node.v.length) node.v.push(clone(pick(node.v))); break;
          case 4: if (node.t === 'array' && node.v.length) node.v.splice(rand() % node.v.length, 1); break;
          case 5: if (node.t === 'map' && node.v.length) node.v.splice(rand() % node.v.length, 1); break;
          case 6: if (node.t === 'map') node.v.push([int(rand() % 70), random(3)]); break;
          default: if (node.t === 'map' && node.v.length > 1) { const i = rand() % node.v.length; const j = rand() % node.v.length; [node.v[i], node.v[j]] = [node.v[j], node.v[i]]; } break;
        }
      }
      const bytes = bytesOf(holder.root);
      let r: ReturnType<typeof decodeRecoveryPayload>;
      expect(() => { r = decodeRecoveryPayload(bytes); }).not.toThrow();
      r = decodeRecoveryPayload(bytes);
      if (r.ok === true) {
        expect(bytesToHex(encodeRecoveryPayload(r.package))).toBe(bytesToHex(bytes));
        const snapshot = JSON.stringify(r.package);
        bytes.fill(0);
        expect(JSON.stringify(r.package)).toBe(snapshot);
      }
    }
  });
});

describe('encoder', () => {
  const throwsInvalid = (contents: unknown) =>
    expect(() => encodeRecoveryPayload(contents as RecoveryPackageContents)).toThrow(expect.objectContaining({ code: 'INVALID_PACKAGE' }));

  it('refuses contents that break a rule, naming it, and never throws anything but its own error', () => {
    throwsInvalid(undefined);
    throwsInvalid({ ...standard, network: 'sanchonet' });
    throwsInvalid({ ...standard, exportedAtMs: -1 });
    throwsInvalid({ ...standard, exportedAtMs: 1.5 });
    throwsInvalid({ ...standard, proposalsDropped: -1 });
    throwsInvalid({ ...standard, addressBookDropped: 1.5 });
    throwsInvalid({ ...standard, vault: { ...standard.vault, kind: 'other' } });
    throwsInvalid({ ...standard, vault: 'native' });
    throwsInvalid({ ...standard, self: { position: 0, index: -1 } });
    throwsInvalid({ ...standard, self: undefined });
    throwsInvalid({ ...standard, participants: [{ ...standard.participants[0], payment: standard.participants[0].payment.toUpperCase() }, ...standard.participants.slice(1)] });
    throwsInvalid({ ...standard, participants: [{ ...standard.participants[0], external: 'acct_shared_xvk1abc' }, ...standard.participants.slice(1)] });
    throwsInvalid({ ...standard, participants: [standard.participants[0], { ...standard.participants[1], external: 'acct_shared_xvk1abc' }, standard.participants[2]] });
    throwsInvalid({ ...standard, participants: [null, ...standard.participants.slice(1)] });
    throwsInvalid({ ...standard, manifests: [{ version: 0, cbor: '' }] });
    throwsInvalid({ ...standard, manifests: [{ version: 1, cbor: 'AB' }] });
    throwsInvalid({ ...standard, manifests: [{ version: 1, cbor: 'ab'.repeat(MAX_MANIFEST_BYTES + 1) }] });
    throwsInvalid({ ...standard, proposals: [{ id: 'zz', cbor: '00' }] });
    throwsInvalid({ ...standard, proposals: [{ id: 'aa', cbor: 'ab'.repeat(MAX_PROPOSAL_BYTES + 1) }] });
    throwsInvalid({ ...standard, proposals: [null] });
    throwsInvalid({ ...standard, addressBook: [{ address: 'addr_test1notanaddress', label: 'x' }] });
    throwsInvalid({ ...standard, referenceScripts: [{ txId: 'ab'.repeat(32), index: 1.5 }] });
    throwsInvalid({ ...standard, referenceScripts: ['ab'] });
    throwsInvalid({ ...plutus, vault: { ...plutus.vault, templateVersion: 2 ** 32 } });
    throwsInvalid({ ...plutus, vault: { ...plutus.vault, validator: undefined } });
    throwsInvalid({ ...plutus, vault: { ...plutus.vault, validator: 'XY' } });
    throwsInvalid({ ...backup, vault: { ...backup.vault, backup: 'soon' } });
  });

  it('refuses a script record whose hash is not its bytes', () => {
    if (standard.vault.kind !== 'native' || backup.vault.kind !== 'native') throw new Error('native');
    throwsInvalid({ ...standard, vault: { ...standard.vault, payment: { ...standard.vault.payment, hash: backup.vault.payment.hash } } });
  });
});

describe('fitting the history into one package', () => {
  const proposal = (i: number, bytes = 4) => ({ id: i.toString(16).padStart(8, '0'), cbor: 'ab'.repeat(bytes) });
  /** A distinct enterprise address on preprod for each i. */
  const entry = (i: number) => ({
    address: Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Testnet, {
      type: Cardano.CredentialType.KeyHash,
      hash: Hash28ByteBase16(i.toString(16).padStart(56, '0')),
    }).toAddress().toBech32(),
    label: `Payee ${i}`,
  });

  it('leaves the oldest address book entries out beyond the count bound and counts them', () => {
    const book = Array.from({ length: MAX_ADDRESS_BOOK_ENTRIES + 6 }, (_, i) => entry(i));
    const { contents: fitted } = fitRecoveryHistory({ ...standard, addressBook: book });
    expect(fitted.addressBook).toHaveLength(MAX_ADDRESS_BOOK_ENTRIES);
    expect(fitted.addressBook[0]).toEqual(book[6]);
    expect(fitted.addressBook[MAX_ADDRESS_BOOK_ENTRIES - 1]).toEqual(book[book.length - 1]);
    expect(fitted.addressBookDropped).toBe(6);
    expect(fitted.proposalsDropped).toBe(0);
    const decoded = decodeRecoveryPayload(encodeRecoveryPayload(fitted));
    expect(decoded).toMatchObject({ ok: true, package: { addressBookDropped: 6, addressBookTruncated: true, proposalHistoryTruncated: false } });
    expect(fitRecoveryHistory({ ...standard, addressBook: book, addressBookDropped: 2 }).contents.addressBookDropped).toBe(8);
  });

  it('leaves the oldest address book entries out to fit the size bound, after the proposals', () => {
    // Manifests that leave about 21 KB, less than 1 024 entries need.
    const manifests = [
      ...Array.from({ length: 63 }, (_, i) => ({ version: i + 1, cbor: 'cd'.repeat(MAX_MANIFEST_BYTES) })),
      { version: 64, cbor: 'cd'.repeat(240000) },
    ];
    const book = Array.from({ length: MAX_ADDRESS_BOOK_ENTRIES }, (_, i) => entry(i));
    // A proposal that would fit the room alone, but not beside the address book.
    const proposals = [proposal(1, 15000)];
    const { contents: fitted } = fitRecoveryHistory({ ...standard, manifests, addressBook: book, proposals });
    expect(fitted.manifests).toHaveLength(64);
    expect(fitted.addressBook.length).toBeGreaterThan(0);
    expect(fitted.addressBook.length).toBeLessThan(MAX_ADDRESS_BOOK_ENTRIES);
    expect(fitted.addressBook[fitted.addressBook.length - 1]).toEqual(book[book.length - 1]);
    expect(fitted.addressBookDropped).toBe(MAX_ADDRESS_BOOK_ENTRIES - fitted.addressBook.length);
    // The address book took the room first, so the proposal was left out.
    expect(fitted.proposals).toEqual([]);
    expect(fitted.proposalsDropped).toBe(1);
    expect(fitRecoveryHistory({ ...standard, manifests, proposals }).contents.proposals).toEqual(proposals);
    expect(encodeRecoveryPayload(fitted).length).toBeLessThanOrEqual(MAX_RECOVERY_PAYLOAD_BYTES);
  });

  it('leaves the oldest proposals out beyond the count bound and counts them', () => {
    const many = Array.from({ length: MAX_PROPOSALS + 3 }, (_, i) => proposal(i));
    const { contents: fitted } = fitRecoveryHistory({ ...standard, proposals: many });
    expect(fitted.proposals).toHaveLength(MAX_PROPOSALS);
    expect(fitted.proposals[0]).toEqual(many[3]);
    expect(fitted.proposals[MAX_PROPOSALS - 1]).toEqual(many[many.length - 1]);
    expect(fitted.proposalsDropped).toBe(3);
    const decoded = decodeRecoveryPayload(encodeRecoveryPayload(fitted));
    expect(decoded).toMatchObject({ ok: true, package: { proposalsDropped: 3, proposalHistoryTruncated: true } });
    // Earlier drops add up.
    expect(fitRecoveryHistory({ ...standard, proposals: many, proposalsDropped: 5 }).contents.proposalsDropped).toBe(8);
    expect(fitRecoveryHistory(standard)).toMatchObject({ contents: { proposals: [], proposalsDropped: 0 }, skipped: { manifests: 0, proposals: 0, addressBook: 0, participantLabels: 0 } });
  });

  it('leaves the oldest proposals out to fit the size bound, keeping every manifest revision', () => {
    const manifest = 'cd'.repeat(MAX_MANIFEST_BYTES);
    const manifests = Array.from({ length: 60 }, (_, i) => ({ version: i + 1, cbor: manifest }));
    const proposals = Array.from({ length: 40 }, (_, i) => proposal(i, MAX_PROPOSAL_BYTES));
    const { contents: fitted } = fitRecoveryHistory({ ...standard, manifests, proposals });
    expect(fitted.manifests).toHaveLength(60);
    expect(fitted.proposals.length).toBeGreaterThan(0);
    expect(fitted.proposals.length).toBeLessThan(40);
    expect(fitted.proposals[fitted.proposals.length - 1]).toEqual(proposals[39]);
    expect(fitted.proposalsDropped).toBe(40 - fitted.proposals.length);
    const bytes = encodeRecoveryPayload(fitted);
    expect(bytes.length).toBeLessThanOrEqual(MAX_RECOVERY_PAYLOAD_BYTES);
    // One more proposal would not have fitted.
    expect(() => encodeRecoveryPayload({ ...fitted, proposals: proposals.slice(39 - fitted.proposals.length) }))
      .toThrow(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
  });

  it('leaves out, and counts, entries that cannot be carried, keeping the newest copy of each', () => {
    const contents: RecoveryPackageContents = {
      ...standard,
      manifests: [
        { version: 3, cbor: 'a3' },
        { version: 1, cbor: 'a1' },
        { version: 2, cbor: 'NOT HEX' },
        { version: 1, cbor: 'b1' },
        { version: -1, cbor: 'a0' },
        { version: 4, cbor: 'cd'.repeat(MAX_MANIFEST_BYTES + 1) },
      ],
      proposals: [
        proposal(1),
        { id: proposal(2).id, cbor: 'ab'.repeat(MAX_PROPOSAL_BYTES + 1) },
        { id: 'XY', cbor: '80' },
        { ...proposal(1), cbor: 'cdcd' },
        proposal(3),
      ],
      addressBook: [
        entry(1),
        { ...entry(1), label: 'Payee one, renamed' },
        { address: 'addr_test1notanaddress', label: 'broken' },
        { ...entry(2), label: 'x'.repeat(65) },
        { ...entry(3), label: 'Alice' + RLO + 'ecila' },
        { address: Cardano.EnterpriseAddress.fromCredentials(Cardano.NetworkId.Mainnet, { type: Cardano.CredentialType.KeyHash, hash: Hash28ByteBase16('1c'.repeat(28)) }).toAddress().toBech32(), label: 'mainnet' },
        { ...entry(4), label: 'Ame' + String.fromCharCode(0x301) + 'lie' },
      ],
      participants: [{ ...standard.participants[0], label: 'Bob' + RLO }, { ...standard.participants[1], label: 'Carol' }, standard.participants[2]],
    };
    const { contents: fitted, skipped } = fitRecoveryHistory(contents);
    expect(skipped).toEqual({ manifests: 4, proposals: 3, addressBook: 5, participantLabels: 1 });
    expect(fitted.manifests).toEqual([{ version: 1, cbor: 'b1' }, { version: 3, cbor: 'a3' }]);
    expect(fitted.proposals).toEqual([{ ...proposal(1), cbor: 'cdcd' }, proposal(3)]);
    expect(fitted.addressBook).toEqual([{ ...entry(1), label: 'Payee one, renamed' }, { ...entry(4), label: 'Am' + String.fromCharCode(0xe9) + 'lie' }]);
    expect(fitted.participants[0].label).toBeUndefined();
    expect(fitted.participants[1].label).toBe('Carol');
    expect({ m: fitted.manifestsDropped, p: fitted.proposalsDropped, a: fitted.addressBookDropped }).toEqual({ m: 4, p: 3, a: 5 });
    const decoded = decodeRecoveryPayload(encodeRecoveryPayload(fitted));
    expect(decoded).toMatchObject({ ok: true, package: { manifestsDropped: 4, proposalHistoryTruncated: true, addressBookTruncated: true } });
  });

  it('never leaves out endorsements or external attestations, merging repeated copies', () => {
    const { contents: fitted } = fitRecoveryHistory({ ...backup, endorsements: [ENDORSEMENT, ENDORSEMENT], externalAttestations: [EXTERNAL_ATTESTATION, EXTERNAL_ATTESTATION] });
    expect(fitted.endorsements).toEqual([ENDORSEMENT]);
    expect(fitted.externalAttestations).toEqual([EXTERNAL_ATTESTATION]);
    expect(() => fitRecoveryHistory({ ...backup, endorsements: [{ ...ENDORSEMENT, signature: 'ab' }] })).toThrow(expect.objectContaining({ code: 'INVALID_PACKAGE' }));
    // They count toward the bound like the manifests: a package that cannot hold them is refused.
    const manifests = Array.from({ length: 63 }, (_, i) => ({ version: i + 1, cbor: 'cd'.repeat(MAX_MANIFEST_BYTES) }));
    const attestations = Array.from({ length: MAX_EXTERNAL_ATTESTATIONS }, (_, i) => ({ method: 1, proof: i.toString(16).padStart(4, '0') + 'ab'.repeat(4094) }));
    expect(() => fitRecoveryHistory({ ...backup, manifests, externalAttestations: attestations })).toThrow(expect.objectContaining({
      code: 'HISTORY_TOO_LARGE',
      message: expect.stringContaining(`${MAX_EXTERNAL_ATTESTATIONS} external attestations`),
    }));
  });

  it('refuses with the sizes when the manifests alone do not fit', () => {
    const manifest = 'cd'.repeat(MAX_MANIFEST_BYTES);
    const manifests = Array.from({ length: 70 }, (_, i) => ({ version: i + 1, cbor: manifest }));
    expect(() => fitRecoveryHistory({ ...standard, manifests, proposals: [proposal(1)] })).toThrow(expect.objectContaining({
      code: 'HISTORY_TOO_LARGE',
      message: expect.stringContaining(`70 manifest revisions are ${70 * MAX_MANIFEST_BYTES} bytes`),
    }));
    const tooMany = Array.from({ length: MAX_MANIFEST_REVISIONS + 1 }, (_, i) => ({ version: i, cbor: 'a0' }));
    expect(() => fitRecoveryHistory({ ...standard, manifests: tooMany })).toThrow(expect.objectContaining({
      code: 'HISTORY_TOO_LARGE',
      message: expect.stringContaining(`${MAX_MANIFEST_REVISIONS + 1} revisions`),
    }));
  });
});
