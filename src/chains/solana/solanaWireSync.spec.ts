import { describe, expect, it } from 'vitest';
import { mergeSolanaTransactions, parseSolanaSyncMessage } from './solanaWireSync';
import { parseBalance, nexusSolanaNetwork } from '@/api/solana-api';

// Shapes from gero-sync docs/solana-wire.md.
const SYNC = {
  type: 'SYNC',
  chain: 'SOLANA',
  success: true,
  block: { height: 312345700, slot: 312345700, hash: null, epoch: 0, time: 1731456000, epoch_slot: 0 },
  transactions: [
    { tx_hash: 'sigA', block_height: 312345690, absolute_slot: 312345690, tx_timestamp: 1731455990, solana_success: true, solana_fee: 5000 },
    { tx_hash: 'sigB', block_height: 312345700, absolute_slot: 312345700, tx_timestamp: 0, solana_success: false },
  ],
  account: { controlled_amount: '1500000000' },
  solana_lamports: '1500000000',
  solana_tokens: [
    { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', owner: 'x', token_account: null, amount: '2500000', decimals: 6, program_id: null },
  ],
  solana_signatures: ['sigB', 'sigA'],
  solana_slot: 312345712,
};

describe('parseSolanaSyncMessage', () => {
  it('converts a SYNC', () => {
    const update = parseSolanaSyncMessage(SYNC);
    expect(update.transactions).toEqual([
      { signature: 'sigA', slot: 312345690, blockTime: 1731455990, success: true, fee: 5000 },
      { signature: 'sigB', slot: 312345700, blockTime: 0, success: false, fee: undefined },
    ]);
    expect(update.lamports).toBe(1_500_000_000n);
    expect(update.tokens).toEqual([
      { mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', amount: 2_500_000n, decimals: 6, tokenAccount: undefined, programId: undefined },
    ]);
    expect(update.cursorSlot).toBe(312345700);
    expect(update.tipSlot).toBe(312345712);
    expect(update.historyTruncated).toBe(false);
  });

  it('keeps unknown balance and tokens undefined, never zero', () => {
    const update = parseSolanaSyncMessage({ type: 'SYNC', transactions: [] });
    expect(update.lamports).toBeUndefined();
    expect(update.tokens).toBeUndefined();
    expect(update.cursorSlot).toBeUndefined();
  });

  it('an empty token list means none held', () => {
    expect(parseSolanaSyncMessage({ type: 'SYNC_CHECK_OK', solana_tokens: [] }).tokens).toEqual([]);
  });

  it('does not move the cursor on CATCH_UP_COMPLETE / SYNC_CHECK_OK (their block is the tip)', () => {
    const msg = { ...SYNC, type: 'CATCH_UP_COMPLETE' };
    expect(parseSolanaSyncMessage(msg).cursorSlot).toBeUndefined();
    expect(parseSolanaSyncMessage({ type: 'SYNC_CHECK_OK', block: { slot: 9, height: 9 } }).cursorSlot).toBeUndefined();
  });

  it('flags truncated history', () => {
    expect(parseSolanaSyncMessage({ ...SYNC, solana_history_truncated: true }).historyTruncated).toBe(true);
  });

  it('keeps u64 lamports exact', () => {
    expect(parseSolanaSyncMessage({ type: 'SYNC', solana_lamports: '18446744073709551615' }).lamports).toBe(18446744073709551615n);
  });
});

describe('mergeSolanaTransactions', () => {
  it('dedupes by signature, newest first, newer copy wins', () => {
    const held = [
      { signature: 'a', slot: 10, blockTime: 0, success: true },
      { signature: 'b', slot: 20, blockTime: 0, success: true },
    ];
    const merged = mergeSolanaTransactions(held, [
      { signature: 'b', slot: 20, blockTime: 1700000000, success: true, fee: 5000 },
      { signature: 'c', slot: 30, blockTime: 0, success: false },
    ]);
    expect(merged.map((t) => t.signature)).toEqual(['c', 'b', 'a']);
    expect(merged[1]).toEqual({ signature: 'b', slot: 20, blockTime: 1700000000, success: true, fee: 5000 });
  });
});

describe('solana-api helpers', () => {
  it('maps wallet networks to Nexus network names', () => {
    expect(nexusSolanaNetwork('Mainnet')).toBe('solana-mainnet');
    expect(nexusSolanaNetwork('Devnet')).toBe('solana-devnet');
    expect(nexusSolanaNetwork('solana-devnet')).toBe('solana-devnet');
    expect(() => nexusSolanaNetwork('Preprod')).toThrow();
  });

  it('parses a balance without losing u64 precision', () => {
    expect(parseBalance('{"address":"x","lamports":18446744073709551615,"slot":5}'))
      .toEqual({ address: 'x', lamports: 18446744073709551615n, slot: 5 });
    expect(parseBalance('{"address":"x","lamports":0,"slot":5}').lamports).toBe(0n);
  });
});
