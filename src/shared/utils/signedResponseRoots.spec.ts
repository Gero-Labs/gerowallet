import { describe, expect, it } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import * as MS from '@emurgo/cardano-message-signing-browser';
import vectors from './signedResponse.vectors.json';
import {
  DELEGATION_PREFIX,
  PINNED_ROOT_KEYS,
  REVOCATION_PREFIX,
  delegationResolver,
  pinnedRoots,
  verifyDelegation,
  verifyRevocationList,
  type Delegation,
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

const delegationStatement = (fields: Record<string, unknown>) =>
  DELEGATION_PREFIX +
  JSON.stringify({
    kid: 'backend-2026-11',
    pub: vectors.signingPublicKeyHex,
    service: 'gero-backend',
    hosts: ['api.gerowallet.io'],
    notBefore: '2026-11-01T00:00:00Z',
    notAfter: '2027-05-01T00:00:00Z',
    ...fields,
  });

describe('signed-response roots', () => {
  it('pins no root key until the key ceremony, and never a test key', () => {
    expect(PINNED_ROOT_KEYS).toEqual([]);
    expect(PINNED_ROOT_KEYS).not.toContain(vectors.root.publicKeyHex);
    expect(pinnedRoots()).toEqual([]);
  });

  it('accepts the shared vector delegation signed by a root', async () => {
    const delegation = await verifyDelegation(vectors.root.delegation.statement, vectors.root.delegation.coseSign1, [ROOT]);
    expect(delegation).toMatchObject({ kid: vectors.keyid, service: 'gero-backend', hosts: ['api.gerowallet.io'] });
    expect(toHex(delegation!.publicKey)).toBe(vectors.signingPublicKeyHex);
  });

  it('refuses a delegation with no roots, a wrong root or a changed statement', async () => {
    const { statement, coseSign1 } = vectors.root.delegation;
    expect(await verifyDelegation(statement, coseSign1, [])).toBeUndefined();
    expect(await verifyDelegation(statement, coseSign1, [await ed25519.getPublicKeyAsync(OTHER_SEED)])).toBeUndefined();
    expect(await verifyDelegation(statement.replace('api.gerowallet.io', 'evil.example'), coseSign1, [ROOT])).toBeUndefined();
  });

  it('accepts either of two roots', async () => {
    const statement = delegationStatement({});
    const other = await ed25519.getPublicKeyAsync(OTHER_SEED);
    expect(await verifyDelegation(statement, await cip8(statement, OTHER_SEED), [ROOT, other])).toBeDefined();
  });

  it('refuses a signature made for another purpose, hashed payloads and other algorithms', async () => {
    const plain = JSON.stringify({ kid: 'x' });
    expect(await verifyDelegation(plain, await cip8(plain, ROOT_SEED), [ROOT])).toBeUndefined();
    const statement = delegationStatement({});
    expect(await verifyDelegation(statement, await cip8(statement, ROOT_SEED, { hashed: true }), [ROOT])).toBeUndefined();
    expect(await verifyDelegation(statement, await cip8(statement, ROOT_SEED, { alg: MS.AlgorithmId.ChaCha20Poly1305 }), [ROOT])).toBeUndefined();
    const revocation = `${REVOCATION_PREFIX}{"issued":"2026-11-01T00:00:00Z","revoked":[]}`;
    expect(await verifyDelegation(revocation, await cip8(revocation, ROOT_SEED), [ROOT])).toBeUndefined();
  });

  it('refuses malformed delegation fields', async () => {
    const bad = [
      { service: 'nexus-admin' },
      { pub: 'abcd' },
      { kid: 'has space' },
      { hosts: [] },
      { hosts: ['API.GEROWALLET.IO'] },
      { notBefore: '2026-11-01' },
      { notAfter: '2026-10-01T00:00:00Z' },
      { notAfter: '2027-11-01T00:00:00Z' }, // a year: longer than six months
    ];
    for (const fields of bad) {
      const statement = delegationStatement(fields);
      expect(await verifyDelegation(statement, await cip8(statement, ROOT_SEED), [ROOT])).toBeUndefined();
    }
  });

  it('verifies a revocation list', async () => {
    const statement = `${REVOCATION_PREFIX}{"issued":"2026-11-15T00:00:00Z","revoked":["backend-2026-11"]}`;
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
      const resolver = delegationResolver('gero-backend', [delegation], { issued: 1, revoked: new Set(['backend-2026-11']) });
      expect(resolver.resolve('backend-2026-11', 'api.gerowallet.io', 1500)).toBeUndefined();
    });
  });
});
