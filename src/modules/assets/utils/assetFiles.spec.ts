// The files an NFT's detail shows, read from its CIP-25 metadata: the main `image`, then `files`.
// CIP-25 caps a metadata string at 64 bytes, so a longer source (a data URI, a long URL) is an
// array of chunks to join. An inline SVG is an image like any other.
import { describe, expect, it } from 'vitest';
import { assetFilesOf, isImageMediaType } from './assetFiles';

const SVG = `data:image/svg+xml;base64,${'A'.repeat(150)}`;
const chunks = SVG.match(/.{1,64}/g)!;

describe('assetFilesOf', () => {
  it('joins an image given as 64-byte chunks', () => {
    expect(assetFilesOf({ image: chunks, mediaType: 'image/svg+xml' })).toEqual([{ src: SVG, mediaType: 'image/svg+xml' }]);
  });

  it('keeps a plain image string as it is', () => {
    expect(assetFilesOf({ image: 'ipfs://Qm123', mediaType: 'image/png' })).toEqual([{ src: 'ipfs://Qm123', mediaType: 'image/png' }]);
  });

  it('joins chunked file sources too, and does not repeat the main image', () => {
    const files = [{ src: chunks, mediaType: 'image/svg+xml' }, { src: 'ipfs://Qm456', mediaType: 'video/mp4' }];
    expect(assetFilesOf({ image: chunks, mediaType: 'image/svg+xml', files })).toEqual([
      { src: SVG, mediaType: 'image/svg+xml' },
      { src: 'ipfs://Qm456', mediaType: 'video/mp4' },
    ]);
  });

  it('leaves out a source that is neither a string nor a list of strings', () => {
    expect(assetFilesOf({ image: { not: 'a source' }, files: [{ src: 42, mediaType: 'image/png' }, { mediaType: 'image/png' }] })).toEqual([]);
    expect(assetFilesOf({ image: ['ok', 7] })).toEqual([]);
  });

  it('has no files without metadata', () => {
    expect(assetFilesOf(undefined)).toEqual([]);
  });
});

describe('isImageMediaType', () => {
  it('counts SVG, the common raster types and a missing type as images', () => {
    for (const type of ['', 'image/svg+xml', 'image/png', 'image/webp', 'image/jpeg', 'image/gif']) {
      expect(isImageMediaType(type), type).toBe(true);
    }
  });

  it('does not count audio, video or anything else', () => {
    for (const type of ['audio/mpeg', 'video/mp4', 'text/html', 'application/pdf']) {
      expect(isImageMediaType(type), type).toBe(false);
    }
  });
});
