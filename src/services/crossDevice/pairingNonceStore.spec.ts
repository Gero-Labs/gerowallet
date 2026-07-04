import { describe, it, expect } from 'vitest';
import { mintPairingNonce, consumePairingNonce, type NonceStorage } from './pairingNonceStore';

function memStorage(): NonceStorage & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {};
  return {
    data,
    get: async (k) => data[k],
    set: async (k, v) => {
      data[k] = v;
    },
  };
}

// Distinct 16-byte outputs per call (first byte = a counter), so minted nonces differ.
function seqBytes(): (n: number) => Uint8Array {
  let c = 1;
  return (n: number) => {
    const a = new Uint8Array(n);
    a[0] = c++;
    return a;
  };
}

const STAKE = 'stake1uxyz';
const OTHER_STAKE = 'stake1uother';

describe('mintPairingNonce', () => {
  it('mints a 32-hex-char nonce with exp = now + ttl and persists it unused', async () => {
    const s = memStorage();
    const { nonce, exp } = await mintPairingNonce(STAKE, 1000, seqBytes(), 180, s);
    expect(nonce).toMatch(/^[0-9a-f]{32}$/);
    expect(exp).toBe(1180);
    const stored = (s.data['crossDevicePairingNonces'] as Record<string, unknown>)[nonce];
    expect(stored).toEqual({ exp: 1180, used: false, stake: STAKE });
  });

  it('mints distinct nonces on successive calls', async () => {
    const s = memStorage();
    const rb = seqBytes();
    const a = await mintPairingNonce(STAKE, 1000, rb, 180, s);
    const b = await mintPairingNonce(STAKE, 1000, rb, 180, s);
    expect(a.nonce).not.toBe(b.nonce);
  });

  it('prunes expired entries on mint so storage does not grow unbounded', async () => {
    const s = memStorage();
    const rb = seqBytes();
    const stale = await mintPairingNonce(STAKE, 1000, rb, 180, s); // exp 1180
    await mintPairingNonce(STAKE, 5000, rb, 180, s); // now well past 1180 -> prunes stale
    const all = s.data['crossDevicePairingNonces'] as Record<string, unknown>;
    expect(all[stale.nonce]).toBeUndefined();
    expect(Object.keys(all)).toHaveLength(1);
  });
});

describe('consumePairingNonce (single-use, TTL, wallet-bound)', () => {
  it('consumes a fresh nonce exactly once', async () => {
    const s = memStorage();
    const { nonce } = await mintPairingNonce(STAKE, 1000, seqBytes(), 180, s);
    expect(await consumePairingNonce(nonce, STAKE, 1050, s)).toBe(true);
    // replay within TTL -> rejected as used
    expect(await consumePairingNonce(nonce, STAKE, 1051, s)).toBe(false);
  });

  it('rejects an expired nonce', async () => {
    const s = memStorage();
    const { nonce } = await mintPairingNonce(STAKE, 1000, seqBytes(), 180, s); // exp 1180
    expect(await consumePairingNonce(nonce, STAKE, 1181, s)).toBe(false);
  });

  it('rejects a nonce minted under a different wallet', async () => {
    const s = memStorage();
    const { nonce } = await mintPairingNonce(STAKE, 1000, seqBytes(), 180, s);
    expect(await consumePairingNonce(nonce, OTHER_STAKE, 1050, s)).toBe(false);
    // still consumable under the correct wallet (the failed attempt didn't burn it)
    expect(await consumePairingNonce(nonce, STAKE, 1050, s)).toBe(true);
  });

  it('rejects an unknown nonce', async () => {
    const s = memStorage();
    expect(await consumePairingNonce('deadbeef'.repeat(4), STAKE, 1000, s)).toBe(false);
  });

  it('burns the nonce before returning, so a concurrent replay cannot double-pin', async () => {
    const s = memStorage();
    const { nonce } = await mintPairingNonce(STAKE, 1000, seqBytes(), 180, s);
    const [a, b] = await Promise.all([
      consumePairingNonce(nonce, STAKE, 1050, s),
      consumePairingNonce(nonce, STAKE, 1050, s),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1); // exactly one wins the CAS
  });
});
