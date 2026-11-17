import { describe, expect, it } from 'vitest';
import {
  checkSolTransfer,
  maxSendableLamports,
  priorityPriceFor,
  solanaSendErrorKey,
  MAX_PRIORITY_MICRO_LAMPORTS,
  SOLANA_RENT_EXEMPT_MINIMUM,
} from './solanaSendRules';
import { estimateSolTransferFee } from './solanaTransaction';
import { solscanUrl } from './solanaExplorer';

const FROM = 'HAgk14JpMQLgt6rVgv7cBQFJWFto5Dqxi472uT3DKpqk';
const TO = 'BLeUXTx9thHGT7VJUtF9vHEmfMDgW1nnKZ9UVer2CoLX';
const SOL = 1_000_000_000n;
const base = { from: FROM, to: TO, lamports: SOL, balance: 2n * SOL, priorityMicroLamports: 0n };

describe('checkSolTransfer', () => {
  it('passes an ordinary transfer', () => {
    expect(checkSolTransfer(base)).toBeNull();
  });

  it('refuses a bad or own address, and a non-positive amount', () => {
    expect(checkSolTransfer({ ...base, to: 'not-an-address' })).toBe('INVALID_ADDRESS');
    expect(checkSolTransfer({ ...base, to: FROM })).toBe('SAME_ADDRESS');
    expect(checkSolTransfer({ ...base, lamports: 0n })).toBe('INVALID_AMOUNT');
  });

  it('never treats an unknown balance as enough (or as 0)', () => {
    expect(checkSolTransfer({ ...base, balance: null })).toBe('BALANCE_UNKNOWN');
  });

  it('counts the fee, priority included', () => {
    const fee = estimateSolTransferFee(1_000_000n);
    expect(checkSolTransfer({ ...base, balance: SOL + fee - 1n, priorityMicroLamports: 1_000_000n })).toBe('INSUFFICIENT_FUNDS');
    expect(checkSolTransfer({ ...base, balance: SOL + fee, priorityMicroLamports: 1_000_000n })).toBeNull();
  });

  it('lets the sender close the account, but not leave dust below rent', () => {
    const fee = estimateSolTransferFee(0n);
    expect(checkSolTransfer({ ...base, balance: SOL + fee + 1n })).toBe('SENDER_BELOW_RENT');
    expect(checkSolTransfer({ ...base, balance: SOL + fee + SOLANA_RENT_EXEMPT_MINIMUM })).toBeNull();
  });

  it('refuses opening an empty recipient below rent; an unknown recipient is not blocked', () => {
    const small = { ...base, lamports: SOLANA_RENT_EXEMPT_MINIMUM - 1n };
    expect(checkSolTransfer({ ...small, recipientBalance: 0n })).toBe('RECIPIENT_BELOW_RENT');
    expect(checkSolTransfer({ ...small, recipientBalance: 5n })).toBeNull();
    expect(checkSolTransfer({ ...small, recipientBalance: null })).toBeNull();
  });
});

describe('fees and max', () => {
  it('picks the level, caps it, and ignores junk', () => {
    expect(priorityPriceFor('standard', { median: 1000.2, p75: 5000 })).toBe(1001n);
    expect(priorityPriceFor('fast', { median: 1000, p75: 5000 })).toBe(5000n);
    expect(priorityPriceFor('fast', { median: 0, p75: 1e15 })).toBe(MAX_PRIORITY_MICRO_LAMPORTS);
    expect(priorityPriceFor('fast', undefined)).toBe(0n);
    expect(priorityPriceFor('standard', { median: Number.NaN, p75: 1 })).toBe(0n);
  });

  it('max sends everything but the fee, and passes the rules', () => {
    const max = maxSendableLamports(2n * SOL, 0n);
    expect(max).toBe(2n * SOL - 5000n);
    expect(checkSolTransfer({ ...base, lamports: max })).toBeNull();
    expect(maxSendableLamports(null, 0n)).toBe(0n);
    expect(maxSendableLamports(10n, 0n)).toBe(0n);
  });
});

describe('page text and links', () => {
  it('maps every code to a key, unknown to the generic one', () => {
    expect(solanaSendErrorKey('SUBMIT_FAILED')).toBe('solana.submitFailed');
    expect(solanaSendErrorKey('INSUFFICIENT_FUNDS')).toBe('send.insufficientBalance');
    expect(solanaSendErrorKey('whatever the server said')).toBe('solana.sendFailed');
  });

  it('builds Solscan links only for real ids', () => {
    expect(solscanUrl('account', FROM, 'Mainnet')).toBe(`https://solscan.io/account/${FROM}`);
    expect(solscanUrl('account', FROM, 'Devnet')).toBe(`https://solscan.io/account/${FROM}?cluster=devnet`);
    const sig = '5'.repeat(88);
    expect(solscanUrl('tx', sig, 'Devnet')).toBe(`https://solscan.io/tx/${sig}?cluster=devnet`);
    expect(solscanUrl('tx', 'javascript:alert(1)', 'Mainnet')).toBe('');
    expect(solscanUrl('account', '../x', 'Mainnet')).toBe('');
  });
});
