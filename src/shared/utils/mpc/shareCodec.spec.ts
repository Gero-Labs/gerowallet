import { describe, it, expect } from 'vitest';
import { encodeShare, decodeShare } from './shareCodec';
import { ShareRole, ShareDecodeError } from './types';

const sampleShare = () => crypto.getRandomValues(new Uint8Array(33)); // 32 secret + 1 index byte

describe('shareCodec', () => {
  it('round-trips a share and preserves role + bytes', () => {
    const share = sampleShare();
    const encoded = encodeShare(ShareRole.Recovery, share);
    const decoded = decodeShare(encoded);
    expect(decoded.role).toBe(ShareRole.Recovery);
    expect(Array.from(decoded.share)).toEqual(Array.from(share));
  });

  it('produces the versioned prefix', () => {
    const encoded = encodeShare(ShareRole.Device, sampleShare());
    expect(encoded.startsWith('gmpc1.01.')).toBe(true);
  });

  it('throws on a bad format', () => {
    expect(() => decodeShare('not-a-share')).toThrow(ShareDecodeError);
  });

  it('throws on a tampered checksum', () => {
    const encoded = encodeShare(ShareRole.Login, sampleShare());
    const parts = encoded.split('.');
    parts[2] = parts[2].slice(0, -2) + (parts[2].endsWith('A') ? 'BB' : 'AA'); // corrupt payload
    expect(() => decodeShare(parts.join('.'))).toThrow(ShareDecodeError);
  });
});
