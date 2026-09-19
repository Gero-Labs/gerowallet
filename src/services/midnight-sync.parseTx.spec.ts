import { describe, expect, it, vi } from 'vitest';

// The service is a singleton that wires a WebSocket on import; keep the
// transport out of a pure-parsing test.
vi.mock('./websocket.service', () => ({ default: { on: vi.fn(), off: vi.fn(), send: vi.fn(), isConnected: () => false } }));
vi.mock('@/api/midnight-api', () => ({ getMidnightApi: () => ({}) }));

import midnightSyncService, { NIGHT_TOKEN_TYPE_NULL } from './midnight-sync.service';
import type { MidnightTransaction } from '@/chains/midnight/midnightTypes';

const ME = 'mn_addr1self';
const OTHER = 'mn_addr1other';
const USDM = 'aa'.repeat(32);
const out = (owner: string, value: string, tokenType = USDM, extra: Record<string, unknown> = {}) =>
  ({ owner, value, tokenType, outputIndex: 0, ...extra });

/** `parseTx` is private; this is the one seam that turns a wire tx into rows. */
function parse(created: object[], spent: object[]): MidnightTransaction[] {
  const svc = midnightSyncService as unknown as { parseTx: (raw: unknown, me: string) => MidnightTransaction[] };
  return svc.parseTx({
    tx_hash: '58d446313e', block_height: 2_599_815, tx_timestamp: 1_758_000_000_000,
    utxo: { unshielded_created_outputs: created, unshielded_spent_outputs: spent },
  }, ME);
}

describe('parseTx: what a row says about who the value went to', () => {
  it('reports a transfer to our own address as a self-transfer, not a 0.00 send', () => {
    // 2026-09-16, block 2,599,815: spent 9.99 USDM, got 2.00 + 7.99 back.
    const rows = parse([out(ME, '2000000'), out(ME, '7990000')], [out(ME, '9990000')]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'self', token: USDM, amount: 0n, counterparty: '', status: 'confirmed' });
  });

  it('still reports a payment to someone else as a send of the net amount', () => {
    const rows = parse([out(OTHER, '2000000'), out(ME, '7990000')], [out(ME, '9990000')]);
    expect(rows[0]).toMatchObject({ type: 'send', amount: 2_000_000n, counterparty: OTHER });
  });

  it('still lets a DUST registration win over the self-transfer shape', () => {
    const night = (owner: string, value: string, extra = {}) => out(owner, value, NIGHT_TOKEN_TYPE_NULL, extra);
    const rows = parse(
      [night(ME, '5000000', { registeredForDustGeneration: true })],
      [night(ME, '5000000')],
    );
    expect(rows[0]).toMatchObject({ type: 'register_dust', token: 'NIGHT' });
  });
});
