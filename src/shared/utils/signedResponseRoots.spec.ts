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
  rootSigning,
  verifyDelegation,
  verifyRevocationList,
  type Delegation,
  type DelegationFields,
} from './signedResponseRoots';

const hexToBytes = (hex: string) => Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));
const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const ROOT_SEED = hexToBytes(vectors.root.seedHex);
const ROOT = hexToBytes(vectors.root.publicKeyHex);
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

const FIELDS: DelegationFields = {
  kid: 'backend-2026-11',
  service: 'gero-backend',
  hosts: ['api.gerowallet.io'],
  from: '2026-11-01',
  until: '2027-01-30',
  publicKeyHex: vectors.signingPublicKeyHex,
};
const statementWith = (fields: Partial<DelegationFields>) => buildDelegationStatement({ ...FIELDS, ...fields });
/** The statement as it would be with one field replaced verbatim, bypassing the builder's checks. */
const rawStatement = (field: string, value: string) =>
  buildDelegationStatement(FIELDS).replace(new RegExp(`\\|${field}=[^|]*`), `|${field}=${value}`);

describe('signed-response roots', () => {
  it('pins no root key until the key ceremony, and never a test key', () => {
    expect(PINNED_ROOT_KEYS).toEqual([]);
    expect(PINNED_ROOT_KEYS).not.toContain(vectors.root.publicKeyHex);
    expect(pinnedRoots()).toEqual([]);
  });

  it('accepts the shared vector delegation signed by a root', async () => {
    const delegation = await verifyDelegation(vectors.root.delegation.statement, vectors.root.delegation.coseSign1, [ROOT]);
    expect(delegation).toMatchObject({
      kid: vectors.keyid,
      service: 'gero-backend',
      hosts: ['api.gerowallet.io'],
      notBefore: Date.parse('2025-10-01T00:00:00Z') / 1000,
      notAfter: Date.parse('2025-12-30T00:00:00Z') / 1000,
    });
    expect(toHex(delegation!.publicKey)).toBe(vectors.signingPublicKeyHex);
    expect(delegation!.notBefore).toBeLessThanOrEqual(vectors.created);
    expect(vectors.expires).toBeLessThan(delegation!.notAfter);
  });

  it('accepts the shared vector revocation', async () => {
    const list = await verifyRevocationList(vectors.root.revocation.statement, vectors.root.revocation.coseSign1, [ROOT]);
    expect(list).toEqual({ issued: Date.parse('2025-11-15T00:00:00Z') / 1000, revoked: new Set(['backend-2025-08', 'backend-2025-05']) });
  });

  it('keeps every statement short enough for a Ledger to show and sign unhashed', () => {
    expect(new TextEncoder().encode(vectors.root.delegation.statement).length).toBeLessThanOrEqual(MAX_STATEMENT_BYTES);
    expect(MAX_STATEMENT_BYTES).toBeLessThan(198);
    expect(() => statementWith({ kid: 'k'.repeat(32), hosts: ['api.gerowallet.io', 'api2.gerowallet.io'] })).toThrow(/Ledger/);
  });

  it('is a reserved signing domain, so no dApp can get it signed through Gero', () => {
    const hex = (text: string) => toHex(new TextEncoder().encode(text));
    expect(reservedSigningDomain(hex(vectors.root.delegation.statement))).not.toBeNull();
    expect(reservedSigningDomain(hex(vectors.root.revocation.statement))).not.toBeNull();
    expect(reservedSigningDomain(hex(DELEGATION_PREFIX))).not.toBeNull();
  });

  it('refuses a delegation with no roots, a wrong root or a changed statement', async () => {
    const { statement, coseSign1 } = vectors.root.delegation;
    expect(await verifyDelegation(statement, coseSign1, [])).toBeUndefined();
    expect(await verifyDelegation(statement, coseSign1, [await ed25519.getPublicKeyAsync(OTHER_SEED)])).toBeUndefined();
    expect(await verifyDelegation(statement.replace('api.gerowallet.io', 'api.evil.example'), coseSign1, [ROOT])).toBeUndefined();
    expect(await verifyDelegation(statement.replace('until=2025-12-30', 'until=2025-12-31'), coseSign1, [ROOT])).toBeUndefined();
    expect(await verifyDelegation(statement, coseSign1.slice(0, -2) + (coseSign1.endsWith('00') ? '01' : '00'), [ROOT])).toBeUndefined();
    expect(await verifyDelegation(statement, 'zz', [ROOT])).toBeUndefined();
    expect(await verifyDelegation(statement, '', [ROOT])).toBeUndefined();
  });

  it('accepts either of two roots and says which one signed', async () => {
    const statement = statementWith({});
    const other = await ed25519.getPublicKeyAsync(OTHER_SEED);
    const coseSign1 = await cip8(statement, OTHER_SEED);
    expect(await verifyDelegation(statement, coseSign1, [ROOT, other])).toBeDefined();
    expect(await rootSigning(statement, coseSign1, [ROOT, other])).toBe(other);
  });

  it('refuses a signature made for another purpose, hashed payloads and other algorithms', async () => {
    const plain = '{"kid":"x"}';
    expect(await verifyDelegation(plain, await cip8(plain, ROOT_SEED), [ROOT])).toBeUndefined();
    const statement = statementWith({});
    expect(await verifyDelegation(statement, await cip8(statement, ROOT_SEED, { hashed: true }), [ROOT])).toBeUndefined();
    expect(await verifyDelegation(statement, await cip8(statement, ROOT_SEED, { alg: MS.AlgorithmId.ChaCha20Poly1305 }), [ROOT])).toBeUndefined();
    // A revocation is not a delegation, nor the other way round.
    const { revocation, delegation } = vectors.root;
    expect(await verifyDelegation(revocation.statement, revocation.coseSign1, [ROOT])).toBeUndefined();
    expect(await verifyRevocationList(delegation.statement, delegation.coseSign1, [ROOT])).toBeUndefined();
  });

  it('refuses a signature over the hash of a statement sent as a plain message', async () => {
    // A hashed CIP-8 signature is a signature over these 28 bytes; it must not count either way.
    const { blake2b } = await import('@noble/hashes/blake2.js');
    const statement = statementWith({});
    const digest = blake2b(new TextEncoder().encode(statement), { dkLen: 28 });
    const overDigest = await cip8(new TextDecoder('latin1').decode(digest), ROOT_SEED);
    expect(await verifyDelegation(statement, overDigest, [ROOT])).toBeUndefined();
  });

  it('refuses malformed delegation fields', () => {
    const bad = [
      rawStatement('service', 'nexus-admin'),
      rawStatement('key', 'abcd'),
      rawStatement('key', vectors.signingPublicKeyHex.toUpperCase()),
      rawStatement('kid', 'has space'),
      rawStatement('kid', 'k'.repeat(33)),
      rawStatement('hosts', ''),
      rawStatement('hosts', 'API.GEROWALLET.IO'),
      rawStatement('hosts', 'api.gerowallet.io,api.gerowallet.io'),
      rawStatement('hosts', '-api.gerowallet.io'),
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
    expect(parseDelegationStatement(statementWith({ kid: 's1', hosts: ['sync.gerowallet.io', 'b.example'], service: 'gero-sync' }))).toMatchObject({
      kid: 's1',
      hosts: ['sync.gerowallet.io', 'b.example'],
      service: 'gero-sync',
    });
    expect(statementWith({ publicKeyHex: vectors.signingPublicKeyHex.toUpperCase() })).toContain(`key=${vectors.signingPublicKeyHex}`);
    for (const fields of [{ kid: 'has space' }, { hosts: [] }, { from: '2026-13-01' }, { until: '2027-06-01' }, { publicKeyHex: 'ab' }]) {
      expect(() => statementWith(fields)).toThrow();
    }
    expect(() => buildRevocationStatement('2026-11-15', [])).toThrow();
    expect(() => buildRevocationStatement('2026-11-15', ['ok', 'not ok'])).toThrow();
    expect(buildRevocationStatement('2026-11-15', ['a', 'b'])).toBe(`${REVOCATION_PREFIX}issued=2026-11-15|revoked=a,b`);
  });

  it('verifies a revocation list only from a root', async () => {
    const statement = buildRevocationStatement('2026-11-15', ['backend-2026-11']);
    const list = await verifyRevocationList(statement, await cip8(statement, ROOT_SEED), [ROOT]);
    expect(list?.revoked.has('backend-2026-11')).toBe(true);
    expect(await verifyRevocationList(statement, await cip8(statement, OTHER_SEED), [ROOT])).toBeUndefined();
  });

  describe('delegationResolver', () => {
    const delegation: Delegation = {
      kid: 'backend-2026-11',
      publicKey: hexToBytes(vectors.signingPublicKeyHex),
      service: 'gero-backend',
      hosts: ['api.gerowallet.io'],
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
