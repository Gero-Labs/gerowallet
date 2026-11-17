import { describe, expect, it } from 'vitest';
import * as ed25519 from '@noble/ed25519';
import { bytesToHex } from '@noble/hashes/utils.js';
import {
  buildSignedSolTransfer,
  buildSolTransferMessage,
  compactU16,
  estimateSolTransferFee,
  signSolanaMessage,
} from './solanaTransaction';
import { deriveSolanaKeypairFromMnemonic, solanaAddressToBytes } from './solanaKeyManager';
import { formatSol, formatUnits, parseSol, parseUnits, parseRawAmount } from './solanaAmount';

const ABANDON = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const sender = deriveSolanaKeypairFromMnemonic(ABANDON, 0);
const recipient = deriveSolanaKeypairFromMnemonic(ABANDON, 1).address;
const BLOCKHASH = 'EkSnNWid2cvwEVnVx9aBqawnmiCNiDgp3gUdkDPTKN1N';

describe('compact-u16', () => {
  it.each([
    [0, '00'], [1, '01'], [0x7f, '7f'], [0x80, '8001'], [0xff, 'ff01'], [0x3fff, 'ff7f'], [0x4000, '808001'], [0xffff, 'ffff03'],
  ])('%i → %s', (value, hex) => {
    expect(bytesToHex(compactU16(value))).toBe(hex);
  });

  it('rejects out of range', () => {
    expect(() => compactU16(0x10000)).toThrow();
    expect(() => compactU16(-1)).toThrow();
  });
});

describe('SOL transfer message', () => {
  it('lays out a plain transfer', () => {
    const msg = buildSolTransferMessage({ from: sender.address, to: recipient, lamports: 1_500_000_000n, recentBlockhash: BLOCKHASH });
    const hex = bytesToHex(msg);
    // header: 1 signer, 0 read-only signed, 1 read-only unsigned (System program)
    expect(hex.slice(0, 6)).toBe('010001');
    // 3 accounts: sender, recipient, System program
    expect(hex.slice(6, 8)).toBe('03');
    expect(hex.slice(8, 72)).toBe(bytesToHex(sender.publicKey));
    expect(hex.slice(72, 136)).toBe(bytesToHex(solanaAddressToBytes(recipient)));
    expect(hex.slice(136, 200)).toBe('00'.repeat(32));
    expect(hex.slice(200, 264)).toBe(bytesToHex(solanaAddressToBytes(BLOCKHASH)));
    // 1 instruction: program 2, accounts [0,1], 12 bytes data = u32 2 (Transfer) + u64 1.5e9
    expect(hex.slice(264)).toBe('01' + '02' + '02' + '0001' + '0c' + '02000000' + '002f685900000000');
    expect(msg.length).toBe(150);
  });

  it('adds ComputeBudget limit and price instructions when a priority fee is set', () => {
    const msg = buildSolTransferMessage({
      from: sender.address, to: recipient, lamports: 1n, recentBlockhash: BLOCKHASH,
      computeUnitPriceMicroLamports: 10_000n, computeUnitLimit: 600,
    });
    const hex = bytesToHex(msg);
    expect(hex.slice(0, 6)).toBe('010002');
    expect(hex.slice(6, 8)).toBe('04');
    const instructions = hex.slice(8 + 4 * 64 + 64);
    expect(instructions.slice(0, 2)).toBe('03');
    // SetComputeUnitLimit(600) then SetComputeUnitPrice(10000), both program index 3, no accounts.
    expect(instructions.slice(2)).toBe(
      '03' + '00' + '05' + '02' + '58020000'
      + '03' + '00' + '09' + '03' + '1027000000000000'
      + '02' + '02' + '0001' + '0c' + '02000000' + '0100000000000000',
    );
  });

  it('refuses invalid transfers', () => {
    const base = { from: sender.address, to: recipient, lamports: 1n, recentBlockhash: BLOCKHASH };
    expect(() => buildSolTransferMessage({ ...base, lamports: 0n })).toThrow(/positive/);
    expect(() => buildSolTransferMessage({ ...base, to: sender.address })).toThrow(/same/);
    expect(() => buildSolTransferMessage({ ...base, to: 'not-an-address' })).toThrow();
    expect(() => buildSolTransferMessage({ ...base, recentBlockhash: '1111' })).toThrow();
  });
});

describe('signing', () => {
  it('produces a transaction whose signature verifies against the message', () => {
    const message = buildSolTransferMessage({ from: sender.address, to: recipient, lamports: 42n, recentBlockhash: BLOCKHASH });
    const { transaction } = signSolanaMessage(message, sender.secretKey);
    expect(transaction[0]).toBe(1);
    const signature = transaction.slice(1, 65);
    expect(bytesToHex(transaction.slice(65))).toBe(bytesToHex(message));
    expect(ed25519.verify(signature, message, sender.publicKey)).toBe(true);
  });

  it('refuses a key that is not the sender', () => {
    const other = deriveSolanaKeypairFromMnemonic(ABANDON, 2);
    expect(() => buildSignedSolTransfer(
      { from: sender.address, to: recipient, lamports: 1n, recentBlockhash: BLOCKHASH }, other.secretKey,
    )).toThrow(/does not match/);
  });

  it('returns base64 and the base58 signature', () => {
    const { signature, base64 } = buildSignedSolTransfer(
      { from: sender.address, to: recipient, lamports: 1n, recentBlockhash: BLOCKHASH }, sender.secretKey);
    expect(signature.length).toBeGreaterThanOrEqual(86);
    expect(atob(base64).length).toBe(1 + 64 + 150);
  });
});

describe('fees', () => {
  it('base fee only without a priority price', () => {
    expect(estimateSolTransferFee()).toBe(5000n);
  });

  it('adds price × limit / 1e6, rounded up', () => {
    expect(estimateSolTransferFee(10_000n, 600)).toBe(5006n);
    expect(estimateSolTransferFee(1n, 600)).toBe(5001n);
  });
});

describe('amounts', () => {
  it('formats lamports without float error', () => {
    expect(formatSol('1500000000')).toBe('1.5');
    expect(formatSol(1n)).toBe('0.000000001');
    expect(formatSol('0')).toBe('0');
    expect(formatSol('18446744073709551615')).toBe('18446744073.709551615');
    expect(formatUnits('2500000', 6)).toBe('2.5');
    expect(formatUnits('7', 0)).toBe('7');
  });

  it('parses user input', () => {
    expect(parseSol('1.5')).toBe(1_500_000_000n);
    expect(parseSol('.5')).toBe(500_000_000n);
    expect(parseSol('0.000000001')).toBe(1n);
    expect(parseUnits('3', 6)).toBe(3_000_000n);
  });

  it('rejects bad input', () => {
    for (const bad of ['', '.', '-1', '1e9', 'abc', '1.2.3', '0.0000000001']) {
      expect(() => parseSol(bad)).toThrow();
    }
    expect(() => parseRawAmount('18446744073709551616')).toThrow();
    expect(() => parseRawAmount(1.5)).toThrow();
  });
});
