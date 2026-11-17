import { describe, expect, it } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import * as MS from '@emurgo/cardano-message-signing-browser';
import vectors from './signedResponse.vectors.json';
import { reservedSigningDomain } from './reservedSigningDomains';
import {
  DELEGATION_PREFIX,
  MAX_STATEMENT_BYTES,
  PINNED_ROOT_KEYS,
  REVOCATION_PREFIX,
  buildDelegationStatement,
  buildRevocationStatement,
  delegationResolver,
  parseDelegationStatement,
  pinnedRoots,
  REQUIRED_DELEGATION_APPROVALS,
  rootSigning,
  verifyDelegations,
  verifyRevocationList,
  type Delegation,
  type DelegationFields,
  type SignedStatement,
} from './signedResponseRoots';

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const [KEY_A, KEY_B] = vectors.root.keys;
const SEED_A = hexToBytes(KEY_A.seedHex);
const SEED_B = hexToBytes(KEY_B.seedHex);
const ROOT_A = hexToBytes(KEY_A.publicKeyHex);
const ROOT_B = hexToBytes(KEY_B.publicKeyHex);
const ROOTS = [ROOT_A, ROOT_B];
const OTHER_SEED = new Uint8Array(32).fill(7);

/** A CIP-8 COSE_Sign1 over `statement`, as a hardware wallet's signData returns it. */
async function cip8(statement: string, seed: Uint8Array, opts: { hashed?: boolean; alg?: MS.AlgorithmId } = {}): Promise<string> {
  const protectedMap = MS.HeaderMap.new();
  protectedMap.set_algorithm_id(MS.Label.from_algorithm_id(opts.alg ?? MS.AlgorithmId.EdDSA));
  protectedMap.set_header(MS.Label.new_text('address'), MS.CBORValue.new_bytes(new Uint8Array(29).fill(0xe1)));
  const unprotectedMap = MS.HeaderMap.new();
  const builder = MS.COSESign1Builder.new(
    MS.Headers.new(MS.ProtectedHeaderMap.new(protectedMap), unprotectedMap),
    new TextEncoder().encode(statement),
    false,
  );
  // The builder writes the CIP-8 `hashed` header itself; hash_payload() turns it on.
  if (opts.hashed) builder.hash_payload();
  const signature = await ed25519.signAsync(builder.make_data_to_sign().to_bytes(), seed);
  return toHex(builder.build(signature).to_bytes());
}

/** One entry per signer, as each root holder hands theirs in. */
async function signedBy(statement: string, seeds: Uint8Array[], opts: { hashed?: boolean; alg?: MS.AlgorithmId } = {}): Promise<SignedStatement[]> {
  return Promise.all(seeds.map(async (seed) => ({ statement, coseSign1: await cip8(statement, seed, opts) })));
}

const FIELDS: DelegationFields = {
  kid: 'backend-2026-11',
  service: 'gero-backend',
  host: 'api.gerowallet.io',
  from: '2026-11-01',
  until: '2027-01-30',
  publicKeyHex: vectors.signingPublicKeyHex,
};
const statementWith = (fields: Partial<DelegationFields>) => buildDelegationStatement({ ...FIELDS, ...fields });
/** The statement as it would be with one field replaced verbatim, bypassing the builder's checks. */
const rawStatement = (field: string, value: string) =>
  buildDelegationStatement(FIELDS).replace(new RegExp(`\\|${field}=[^|]*`), `|${field}=${value}`);
const approved = async (entries: SignedStatement[], roots: Uint8Array[] = ROOTS) =>
  (await verifyDelegations(entries, roots)).map((a) => a.delegation);

describe('signed-response roots', () => {
  it('pins no root key until the key ceremony, and never a test key', () => {
    expect(PINNED_ROOT_KEYS).toEqual([]);
    for (const key of vectors.root.keys) expect(PINNED_ROOT_KEYS).not.toContain(key.publicKeyHex);
    expect(pinnedRoots()).toEqual([]);
    expect(new Set(PINNED_ROOT_KEYS.map((key) => key.toLowerCase())).size).toBe(PINNED_ROOT_KEYS.length);
  });

  it('accepts the shared vector delegation once both roots have signed it', async () => {
    expect(REQUIRED_DELEGATION_APPROVALS).toBe(2);
    const [delegation, ...more] = await approved(vectors.root.delegation.entries);
    expect(more).toEqual([]);
    expect(delegation).toMatchObject({
      kid: vectors.keyid,
      service: 'gero-backend',
      host: 'api.gerowallet.io',
      notBefore: Date.parse('2025-10-01T00:00:00Z') / 1000,
      notAfter: Date.parse('2025-12-30T00:00:00Z') / 1000,
    });
    expect(toHex(delegation!.publicKey)).toBe(vectors.signingPublicKeyHex);
    expect(delegation!.notBefore).toBeLessThanOrEqual(vectors.created);
    expect(vectors.expires).toBeLessThan(delegation!.notAfter);
    // The vector entries are one per root, in order.
    expect(await rootSigning(vectors.root.delegation.statement, vectors.root.delegation.entries[0].coseSign1, ROOTS)).toEqual(ROOT_A);
    expect(await rootSigning(vectors.root.delegation.statement, vectors.root.delegation.entries[1].coseSign1, ROOTS)).toEqual(ROOT_B);
  });

  it('refuses a delegation only one root signed, however often', async () => {
    const [a, b] = vectors.root.delegation.entries;
    expect(await approved([a])).toEqual([]);
    expect(await approved([b])).toEqual([]);
    expect(await approved([a, a])).toEqual([]);
    // Two different signatures from the same root are still one approval.
    const again = await signedBy(vectors.root.delegation.statement, [SEED_A]);
    expect(again[0].coseSign1).not.toBe(a.coseSign1);
    expect(await approved([a, ...again])).toEqual([]);
    // Fewer than two pinned roots can never approve anything.
    expect(await approved([a, b], [ROOT_A])).toEqual([]);
    expect(await approved([a, b], [])).toEqual([]);
    expect(await approved([a, b], [ROOT_A, ROOT_A])).toEqual([]);
  });

  it('counts approvals per exact statement', async () => {
    const one = statementWith({});
    const other = statementWith({ until: '2027-01-31' });
    expect(await approved([...(await signedBy(one, [SEED_A])), ...(await signedBy(other, [SEED_B]))])).toEqual([]);
    const both = await approved([...(await signedBy(one, [SEED_A, SEED_B])), ...(await signedBy(other, [SEED_B]))]);
    expect(both.map((d) => d.notAfter)).toEqual([Date.parse('2027-01-30T00:00:00Z') / 1000]);
  });

  it('accepts any two of the pinned roots', async () => {
    const third = await ed25519.getPublicKeyAsync(OTHER_SEED);
    const statement = statementWith({});
    expect(await approved(await signedBy(statement, [SEED_B, OTHER_SEED]), [ROOT_A, ROOT_B, third])).toHaveLength(1);
    expect(await approved(await signedBy(statement, [SEED_A, OTHER_SEED]), ROOTS)).toEqual([]);
  });

  it('accepts the shared vector revocation from one root', async () => {
    const list = await verifyRevocationList(vectors.root.revocation.statement, vectors.root.revocation.coseSign1, ROOTS);
    expect(list).toEqual({ issued: Date.parse('2025-11-15T00:00:00Z') / 1000, revoked: new Set(['backend-2025-08', 'backend-2025-05']) });
  });

  it('keeps every statement short enough for a Ledger to show and sign unhashed', () => {
    expect(new TextEncoder().encode(vectors.root.delegation.statement).length).toBeLessThanOrEqual(MAX_STATEMENT_BYTES);
    expect(MAX_STATEMENT_BYTES).toBeLessThan(198);
    expect(() => statementWith({ kid: 'k'.repeat(32) })).toThrow(/Ledger/);
  });

  it('is a reserved signing domain, so no dApp can get it signed through Gero', () => {
    const hex = (text: string) => toHex(new TextEncoder().encode(text));
    expect(reservedSigningDomain(hex(vectors.root.delegation.statement))).not.toBeNull();
    expect(reservedSigningDomain(hex(vectors.root.revocation.statement))).not.toBeNull();
    expect(reservedSigningDomain(hex(DELEGATION_PREFIX))).not.toBeNull();
  });

  it('refuses a wrong root, a changed statement or a broken signature', async () => {
    const { statement, entries } = vectors.root.delegation;
    const [a, b] = entries;
    const swapped = (change: (e: SignedStatement) => SignedStatement) => approved([change(a), b]);
    expect(await approved(entries, [ROOT_A, await ed25519.getPublicKeyAsync(OTHER_SEED)])).toEqual([]);
    expect(await swapped((e) => ({ ...e, statement: statement.replace('api.gerowallet.io', 'api.evil.example') }))).toEqual([]);
    expect(await swapped((e) => ({ ...e, statement: statement.replace('until=2025-12-30', 'until=2025-12-31') }))).toEqual([]);
    expect(await swapped((e) => ({ ...e, coseSign1: e.coseSign1.slice(0, -2) + (e.coseSign1.endsWith('00') ? '01' : '00') }))).toEqual([]);
    expect(await swapped((e) => ({ ...e, coseSign1: 'zz' }))).toEqual([]);
    expect(await swapped((e) => ({ ...e, coseSign1: '' }))).toEqual([]);
  });

  it('says which root signed', async () => {
    const statement = statementWith({});
    const other = await ed25519.getPublicKeyAsync(OTHER_SEED);
    const coseSign1 = await cip8(statement, OTHER_SEED);
    expect(await rootSigning(statement, coseSign1, [ROOT_A, other])).toBe(other);
    expect(await rootSigning(statement, coseSign1, ROOTS)).toBeUndefined();
  });

  it('refuses a signature made for another purpose, hashed payloads and other algorithms', async () => {
    const plain = '{"kid":"x"}';
    expect(await approved(await signedBy(plain, [SEED_A, SEED_B]))).toEqual([]);
    const statement = statementWith({});
    expect(await approved(await signedBy(statement, [SEED_A, SEED_B], { hashed: true }))).toEqual([]);
    expect(await approved(await signedBy(statement, [SEED_A, SEED_B], { alg: MS.AlgorithmId.ChaCha20Poly1305 }))).toEqual([]);
    // A revocation is not a delegation, nor the other way round.
    const { revocation, delegation } = vectors.root;
    expect(await approved([revocation, { ...revocation, coseSign1: await cip8(revocation.statement, SEED_B) }])).toEqual([]);
    expect(await verifyRevocationList(delegation.statement, delegation.entries[0].coseSign1, ROOTS)).toBeUndefined();
  });

  it('refuses a signature over the hash of a statement sent as a plain message', async () => {
    // A hashed CIP-8 signature is a signature over these 28 bytes; it must not count either way.
    const { blake2b } = await import('@noble/hashes/blake2.js');
    const statement = statementWith({});
    const digest = blake2b(new TextEncoder().encode(statement), { dkLen: 28 });
    const message = new TextDecoder('latin1').decode(digest);
    const overDigest = await Promise.all([SEED_A, SEED_B].map((seed) => cip8(message, seed)));
    expect(await approved(overDigest.map((coseSign1) => ({ statement, coseSign1 })))).toEqual([]);
  });

  it('refuses malformed delegation fields', () => {
    const bad = [
      rawStatement('service', 'nexus-admin'),
      rawStatement('key', 'abcd'),
      rawStatement('key', vectors.signingPublicKeyHex.toUpperCase()),
      rawStatement('kid', 'has space'),
      rawStatement('kid', 'k'.repeat(33)),
      rawStatement('host', ''),
      rawStatement('host', 'API.GEROWALLET.IO'),
      rawStatement('host', 'api.gerowallet.io,api2.gerowallet.io'),
      rawStatement('host', '-api.gerowallet.io'),
      buildDelegationStatement(FIELDS).replace('|host=', '|hosts='),
      rawStatement('from', '2026-11-01T00:00:00Z'),
      rawStatement('from', '2026-02-30'),
      rawStatement('until', '2026-10-01'), // before from
      rawStatement('until', '2026-11-01'), // equal to from
      rawStatement('until', '2027-02-10'), // 101 days
      `${buildDelegationStatement(FIELDS)}|extra=1`,
      ` ${buildDelegationStatement(FIELDS)}`,
      buildDelegationStatement(FIELDS).replace('gero-signing/v1', 'gero-signing/v2'),
    ];
    for (const statement of bad) expect(parseDelegationStatement(statement), statement).toBeUndefined();
    expect(parseDelegationStatement(rawStatement('until', '2027-02-09'))).toBeDefined(); // 100 days
  });

  it('builds only statements it would accept', () => {
    expect(parseDelegationStatement(statementWith({ kid: 's1', host: 'sync.gerowallet.io', service: 'gero-sync' }))).toMatchObject({
      kid: 's1',
      host: 'sync.gerowallet.io',
      service: 'gero-sync',
    });
    expect(statementWith({ publicKeyHex: vectors.signingPublicKeyHex.toUpperCase() })).toContain(`key=${vectors.signingPublicKeyHex}`);
    for (const fields of [{ kid: 'has space' }, { host: '' }, { host: 'a.example,b.example' }, { from: '2026-13-01' }, { until: '2027-06-01' }, { publicKeyHex: 'ab' }]) {
      expect(() => statementWith(fields)).toThrow();
    }
    expect(() => buildRevocationStatement('2026-11-15', [])).toThrow();
    expect(() => buildRevocationStatement('2026-11-15', ['ok', 'not ok'])).toThrow();
    expect(buildRevocationStatement('2026-11-15', ['a', 'b'])).toBe(`${REVOCATION_PREFIX}issued=2026-11-15|revoked=a,b`);
  });

  it('verifies a revocation list only from a root', async () => {
    const statement = buildRevocationStatement('2026-11-15', ['backend-2026-11']);
    const list = await verifyRevocationList(statement, await cip8(statement, SEED_B), ROOTS);
    expect(list?.revoked.has('backend-2026-11')).toBe(true);
    expect(await verifyRevocationList(statement, await cip8(statement, OTHER_SEED), ROOTS)).toBeUndefined();
  });

  describe('delegationResolver', () => {
    const delegation: Delegation = {
      kid: 'backend-2026-11',
      publicKey: hexToBytes(vectors.signingPublicKeyHex),
      service: 'gero-backend',
      host: 'api.gerowallet.io',
      notBefore: 1000,
      notAfter: 2000,
    };

    it('resolves a current delegation for its service and host only', () => {
      const resolver = delegationResolver('gero-backend', [delegation]);
      expect(resolver.resolve('backend-2026-11', 'api.gerowallet.io', 1500)).toBe(delegation.publicKey);
      expect(resolver.resolve('backend-2026-11', 'API.gerowallet.io', 1500)).toBe(delegation.publicKey);
      expect(resolver.resolve('backend-2026-11', 'sync.gerowallet.io', 1500)).toBeUndefined();
      expect(resolver.resolve('backend-2026-11', 'api.gerowallet.io', 999)).toBeUndefined();
      expect(resolver.resolve('backend-2026-11', 'api.gerowallet.io', 2000)).toBeUndefined();
      expect(resolver.resolve('other', 'api.gerowallet.io', 1500)).toBeUndefined();
      expect(delegationResolver('gero-sync', [delegation]).resolve('backend-2026-11', 'api.gerowallet.io', 1500)).toBeUndefined();
    });

    it('drops a revoked key', () => {
      const resolver = delegationResolver('gero-backend', [delegation], new Set(['backend-2026-11']));
      expect(resolver.resolve('backend-2026-11', 'api.gerowallet.io', 1500)).toBeUndefined();
    });
  });
});
