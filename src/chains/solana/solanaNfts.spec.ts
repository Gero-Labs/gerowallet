// Solana NFTs: candidates, strict reading of Nexus rows, and collections that never group an
// unverified NFT under a name it chose itself.
import { describe, expect, it } from 'vitest';
import {
  SOLANA_NFT_RETRY_MS,
  isProgrammableSolanaNft,
  parseSolanaNftRows,
  solanaNftCandidates,
  solanaNftCollections,
  solanaNftMintsToRead,
  solanaNftName,
  solanaNftUrl,
  type SolanaNft,
} from './solanaNfts';

const A = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const B = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const C = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const COLL = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';

function nft(mint: string, fields: Partial<SolanaNft> = {}): SolanaNft {
  return {
    mint, standard: 'nonFungible', name: null, symbol: null, image: null, animationUrl: null, description: null,
    externalUrl: null, collection: null, ruleSet: null, attributes: [], sellerFeeBasisPoints: null, offChain: true, fetchedAt: 0, ...fields,
  };
}

describe('Solana NFT candidates', () => {
  it('are held tokens with 0 decimals and exactly one unit', () => {
    expect(solanaNftCandidates([
      { mint: A, amount: '1', decimals: 0 },
      { mint: B, amount: '2', decimals: 0 },
      { mint: C, amount: '1', decimals: 6 },
      { mint: A, amount: '1', decimals: 0 },
      { mint: 'not-a-mint', amount: '1', decimals: 0 },
    ])).toEqual([A]);
    expect(solanaNftCandidates(null)).toEqual([]);
  });

  it('asks Nexus about unknown mints, and about incomplete ones after the retry delay', () => {
    const known = { [A]: nft(A), [B]: nft(B, { offChain: false, fetchedAt: 1000 }), [C]: false as const };
    expect(solanaNftMintsToRead([A, B, C, COLL], known, 1000)).toEqual([COLL]);
    expect(solanaNftMintsToRead([A, B, C, COLL], known, 1000 + SOLANA_NFT_RETRY_MS)).toEqual([B, COLL]);
  });
});

describe('Nexus NFT rows', () => {
  it('reads each row strictly, for the mint asked', () => {
    const rows = parseSolanaNftRows({
      nfts: [
        {
          mint: A, nft: true, standard: 'programmableNonFungible', name: '  Lad #1 ', image: 'https://arweave.net/a.png',
          animationUrl: 'javascript:alert(1)', description: 'x'.repeat(3000), externalUrl: 'data:text/html,hi',
          collection: { address: COLL, verified: true }, sellerFeeBasisPoints: 500, offChain: true, ruleSet: COLL,
          attributes: [{ traitType: 'Hat', value: 'Cap' }, { traitType: 'Bad', value: { nested: 1 } }, ...Array.from({ length: 40 }, (_, i) => ({ value: `v${i}` }))],
        },
        { mint: B, nft: false },
        { mint: A, nft: true },
      ],
    }, [A, B, C], 42);
    const first = rows[0] as SolanaNft;
    expect(first).toMatchObject({
      mint: A, standard: 'programmableNonFungible', name: 'Lad #1', image: 'https://arweave.net/a.png', ruleSet: COLL,
      animationUrl: null, externalUrl: null, collection: { address: COLL, verified: true }, sellerFeeBasisPoints: 500,
      offChain: true, fetchedAt: 42,
    });
    expect(first.description).toHaveLength(2000);
    expect(first.attributes[0]).toEqual({ traitType: 'Hat', value: 'Cap' });
    expect(first.attributes).toHaveLength(31); // 32 read, the non-text one dropped
    expect(rows[1]).toBe(false);
    expect(rows[2]).toBeUndefined(); // another mint's row
  });

  it('refuses an answer that does not match the request', () => {
    expect(() => parseSolanaNftRows({ nfts: [] }, [A], 0)).toThrow();
    expect(() => parseSolanaNftRows(null, [A], 0)).toThrow();
  });

  it('keeps only URLs the image proxy can load', () => {
    expect(solanaNftUrl('ipfs://bafy/1.png')).toBe('ipfs://bafy/1.png');
    expect(solanaNftUrl('ar://tx')).toBe('ar://tx');
    expect(solanaNftUrl('HTTPS://a.b/c')).toBe('HTTPS://a.b/c');
    for (const bad of ['data:image/png;base64,AA', 'javascript:x', 'https://a.b/"x', 'https://a.b/ x', 'ftp://a', 7]) {
      expect(solanaNftUrl(bad)).toBeNull();
    }
  });
});

describe('Solana NFT collections', () => {
  it('groups a verified collection and leaves every unverified NFT on its own', () => {
    const collections = solanaNftCollections([
      nft(A, { name: 'Mad Lad #12', collection: { address: COLL, verified: true }, image: 'https://x/12.png' }),
      nft(B, { name: 'Mad Lad #3', collection: { address: COLL, verified: true } }),
      // Claims the same collection without its authority's signature.
      nft(C, { name: 'Mad Lad #1', collection: { address: COLL, verified: false } }),
    ]);
    expect(collections.map((c) => [c.id, c.name, c.verified, c.items.length])).toEqual([
      [COLL, 'Mad Lad', true, 2],
      [C, 'Mad Lad #1', false, 1],
    ]);
    // Items in natural order; the collection shows the first image there is.
    expect(collections[0].items.map((i) => i.name)).toEqual(['Mad Lad #3', 'Mad Lad #12']);
    expect(collections[0].image).toBe('https://x/12.png');
  });

  it('names an NFT without a name by its mint', () => {
    expect(solanaNftName(nft(A))).toBe('DezX…B263');
  });

  it('tells programmable NFTs apart', () => {
    expect(isProgrammableSolanaNft(nft(A))).toBe(false);
    expect(isProgrammableSolanaNft(nft(A, { standard: null }))).toBe(false);
    expect(isProgrammableSolanaNft(nft(A, { standard: 'programmableNonFungible' }))).toBe(true);
    expect(isProgrammableSolanaNft(nft(A, { standard: 'programmableNonFungibleEdition' }))).toBe(true);
  });
});
