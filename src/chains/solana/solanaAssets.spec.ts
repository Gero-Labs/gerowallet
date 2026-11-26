// Nexus's compressed and Core NFT answers, read strictly.
import { describe, expect, it } from 'vitest';
import { base58Encode } from './solanaBase58';
import { parseSolanaAssetTransfer, parseSolanaAssets } from './solanaAssets';

const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const B = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const OWNER = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const COLL = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So';
const h = (fill: number) => base58Encode(new Uint8Array(32).fill(fill));

describe('the asset list', () => {
  it('keeps compressed and Core rows, strictly', () => {
    const rows = parseSolanaAssets({
      assets: [
        { id: A, kind: 'compressed', name: ' Lad #1 ', image: 'https://arweave.net/1.png', animationUrl: 'javascript:x',
          collection: { address: COLL, verified: true }, attributes: [{ traitType: 'Hat', value: 'Cap' }, { value: { x: 1 } }] },
        { id: B, kind: 'core', name: 'Core #2' },
        { id: A, kind: 'compressed' }, // a repeat
        { id: 'nope', kind: 'core' },
        { id: COLL, kind: 'token' },
      ],
    }, 9);
    expect(rows.map((r) => [r.mint, r.kind])).toEqual([[A, 'compressed'], [B, 'core']]);
    expect(rows[0]).toMatchObject({
      name: 'Lad #1', image: 'https://arweave.net/1.png', animationUrl: null, standard: null,
      collection: { address: COLL, verified: true }, attributes: [{ traitType: 'Hat', value: 'Cap' }], fetchedAt: 9,
    });
    expect(() => parseSolanaAssets({}, 0)).toThrow();
  });
});

describe('transfer inputs', () => {
  const compressed = {
    id: A, kind: 'compressed', owner: OWNER, delegate: OWNER, frozen: false, tree: COLL, treeVersion: 1,
    root: h(1), dataHash: h(2), creatorHash: h(3), nonce: 4097, index: 4097, proof: [h(10), h(11)],
  };

  it('reads a compressed leaf and a Core asset', () => {
    expect(parseSolanaAssetTransfer(compressed, A)).toMatchObject({ kind: 'compressed', nonce: 4097n, index: 4097, proof: [h(10), h(11)] });
    expect(parseSolanaAssetTransfer({ id: B, kind: 'core', owner: OWNER, frozen: true, collection: COLL }, B))
      .toEqual({ kind: 'core', id: B, owner: OWNER, frozen: true, collection: COLL });
    expect(parseSolanaAssetTransfer({ id: B, kind: 'core', owner: OWNER }, B)).toMatchObject({ collection: null, frozen: false });
  });

  it.each([
    ['another asset', { ...compressed, id: B }],
    ['a bad owner', { ...compressed, owner: 'x' }],
    ['a bad proof node', { ...compressed, proof: ['x'] }],
    ['too long a proof', { ...compressed, proof: Array.from({ length: 31 }, (_, i) => h(i)) }],
    ['a negative index', { ...compressed, index: -1 }],
    ['a fractional nonce', { ...compressed, nonce: 1.5 }],
    ['a bad root', { ...compressed, root: 'x' }],
    ['an unknown kind', { ...compressed, kind: 'token' }],
  ])('refuses %s', (_, body) => {
    expect(() => parseSolanaAssetTransfer(body, A)).toThrow();
  });
});
