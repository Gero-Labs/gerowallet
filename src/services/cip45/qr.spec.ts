import { describe, it, expect } from 'vitest';
import { parseCip45Input, CIP45_QR_MAX_AGE_MS } from './qr';

const NOW = 1_756_400_000_000;

describe('parseCip45Input', () => {
  it('parses a full QR payload "<peerId>:peerjs:<ts>"', () => {
    expect(parseCip45Input(`dapp-1x2y3z-abc:peerjs:${NOW - 1000}`, NOW))
      .toEqual({ dappPeerId: 'dapp-1x2y3z-abc' });
  });

  it('accepts a bare peer id paste (no staleness check)', () => {
    expect(parseCip45Input('  dapp-1x2y3z-abc  ', NOW)).toEqual({ dappPeerId: 'dapp-1x2y3z-abc' });
  });

  it('rejects a stale QR payload', () => {
    expect(() => parseCip45Input(`dapp-a:peerjs:${NOW - CIP45_QR_MAX_AGE_MS - 1}`, NOW)).toThrow('stale');
  });

  it('rejects a foreign discriminator', () => {
    expect(() => parseCip45Input('dapp-a:meerkat:123', NOW)).toThrow('invalid');
  });

  it('rejects empty and malformed input', () => {
    expect(() => parseCip45Input('', NOW)).toThrow('invalid');
    expect(() => parseCip45Input('a:peerjs:not-a-number', NOW)).toThrow('invalid');
    expect(() => parseCip45Input('a:b:c:d', NOW)).toThrow('invalid');
  });
});
