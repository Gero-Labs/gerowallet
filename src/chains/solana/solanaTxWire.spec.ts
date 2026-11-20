import { describe, expect, it } from 'vitest';
import { base58Decode, base58Encode } from './solanaBase58';
import { buildSolTransferMessage, compactU16, signSolanaBytes, verifySolanaSignature } from './solanaTransaction';
import { deriveSolanaKeypairFromMnemonic } from './solanaKeyManager';
import {
  SolanaWireError,
  decodeSolanaTransaction,
  resolveSolanaKeys,
  withSolanaSignature,
} from './solanaTxWire';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  analyzeSolanaInstructions,
} from './solanaTxInstructions';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const wallet = deriveSolanaKeypairFromMnemonic(MNEMONIC, 0);
const other = deriveSolanaKeypairFromMnemonic(MNEMONIC, 1).address;
const pk = (n: number) => base58Encode(new Uint8Array(32).fill(n));
const BLOCKHASH = pk(9);

const cat = (...parts: Array<Uint8Array | number[]>) => {
  const out: number[] = [];
  parts.forEach((p) => out.push(...p));
  return new Uint8Array(out);
};
const keyBytes = (address: string) => Array.from(base58Decode(address));
const u32le = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const u64le = (n: bigint) => Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(8 * i)) & 255n));

/** A wire transaction: one empty signature slot per required signer, then the message. */
const unsigned = (message: Uint8Array, signers = 1) => cat(compactU16(signers), new Array(64 * signers).fill(0), message);

interface Ix { program: number; accounts: number[]; data: number[] }
/** A message: header, keys, blockhash, instructions, and for v0 the lookups. */
function message(opts: {
  v0?: boolean; header: [number, number, number]; keys: string[]; ixs: Ix[];
  lookups?: Array<{ table: string; writable: number[]; readonly: number[] }>;
}): Uint8Array {
  return cat(
    opts.v0 ? [0x80] : [],
    opts.header,
    compactU16(opts.keys.length), ...opts.keys.map(keyBytes),
    keyBytes(BLOCKHASH),
    compactU16(opts.ixs.length),
    ...opts.ixs.map((ix) => cat([ix.program], compactU16(ix.accounts.length), ix.accounts, compactU16(ix.data.length), ix.data)),
    opts.v0 ? cat(compactU16(opts.lookups?.length ?? 0), ...(opts.lookups ?? []).map((l) =>
      cat(keyBytes(l.table), compactU16(l.writable.length), l.writable, compactU16(l.readonly.length), l.readonly))) : [],
  );
}

describe('decodeSolanaTransaction', () => {
  it('decodes Gero’s own transfer and keeps the exact message bytes', () => {
    const msg = buildSolTransferMessage({ from: wallet.address, to: other, lamports: 1000n, recentBlockhash: BLOCKHASH });
    const tx = decodeSolanaTransaction(unsigned(msg));
    expect(tx.message.version).toBe('legacy');
    expect(tx.message.staticKeys[0]).toBe(wallet.address);
    expect(tx.messageBytes).toEqual(msg);
    const keys = resolveSolanaKeys(tx.message, new Map());
    expect(keys[0]).toMatchObject({ address: wallet.address, signer: true, writable: true });
    expect(keys.find((k) => k.address === SYSTEM_PROGRAM)).toMatchObject({ signer: false, writable: false });
  });

  it('decodes v0 and resolves lookup tables in runtime order (writable entries first)', () => {
    const table = pk(7);
    const msg = message({
      v0: true, header: [1, 0, 1], keys: [wallet.address, SYSTEM_PROGRAM],
      ixs: [{ program: 1, accounts: [0, 2, 3], data: [...u32le(2), ...u64le(5n)] }],
      lookups: [{ table, writable: [1], readonly: [0] }],
    });
    const tx = decodeSolanaTransaction(unsigned(msg));
    expect(tx.message.version).toBe(0);
    const keys = resolveSolanaKeys(tx.message, new Map([[table, [pk(20), pk(21)]]]));
    expect(keys.map((k) => [k.address, k.writable, k.fromLookup])).toEqual([
      [wallet.address, true, false], [SYSTEM_PROGRAM, false, false], [pk(21), true, true], [pk(20), false, true],
    ]);
    expect(() => resolveSolanaKeys(tx.message, new Map())).toThrow(SolanaWireError);
    expect(() => resolveSolanaKeys(tx.message, new Map([[table, [pk(20)]]]))).toThrow('Lookup index out of range');
  });

  it('refuses anything it cannot read exactly', () => {
    const msg = buildSolTransferMessage({ from: wallet.address, to: other, lamports: 1n, recentBlockhash: BLOCKHASH });
    const good = unsigned(msg);
    expect(() => decodeSolanaTransaction(cat(good, [0]))).toThrow('Bytes after the message');
    expect(() => decodeSolanaTransaction(good.slice(0, -1))).toThrow(SolanaWireError);
    expect(() => decodeSolanaTransaction(cat(compactU16(1), new Array(64).fill(0), [0x81], msg))).toThrow('Unsupported transaction version');
    expect(() => decodeSolanaTransaction(unsigned(msg, 2))).toThrow('Signature count does not match');
    expect(() => decodeSolanaTransaction(unsigned(message({ header: [1, 0, 0], keys: [wallet.address], ixs: [{ program: 3, accounts: [], data: [] }] }))))
      .toThrow('Program index out of range');
    expect(() => decodeSolanaTransaction(unsigned(message({ header: [1, 0, 1], keys: [wallet.address, SYSTEM_PROGRAM], ixs: [{ program: 1, accounts: [5], data: [] }] }))))
      .toThrow('Account index out of range');
    expect(() => decodeSolanaTransaction(unsigned(message({ header: [1, 1, 0], keys: [wallet.address], ixs: [] }))))
      .toThrow('fee payer is read-only');
    expect(() => decodeSolanaTransaction(new Uint8Array(1233))).toThrow('too large');
  });
});

describe('withSolanaSignature', () => {
  it('fills one slot, changes nothing else, and the signature verifies over the message', () => {
    const msg = buildSolTransferMessage({ from: wallet.address, to: other, lamports: 1n, recentBlockhash: BLOCKHASH });
    const bytes = unsigned(msg);
    const tx = decodeSolanaTransaction(bytes);
    const sig = signSolanaBytes(tx.messageBytes, wallet.secretKey);
    const signed = withSolanaSignature(bytes, tx, 0, sig);
    const back = decodeSolanaTransaction(signed);
    expect(back.messageBytes).toEqual(msg);
    expect(verifySolanaSignature(back.signatures[0], back.messageBytes, base58Decode(wallet.address))).toBe(true);
    expect(signed.slice(65)).toEqual(bytes.slice(65));
  });
});

describe('analyzeSolanaInstructions', () => {
  const analyze = (keys: string[], header: [number, number, number], ixs: Ix[]) => {
    const tx = decodeSolanaTransaction(unsigned(message({ header, keys, ixs }), header[0]));
    return analyzeSolanaInstructions(tx.message, resolveSolanaKeys(tx.message, new Map()), wallet.address);
  };

  it('reads a SOL transfer and the fee with a priority price', () => {
    const a = analyze([wallet.address, other, SYSTEM_PROGRAM, COMPUTE_BUDGET_PROGRAM], [1, 0, 2], [
      { program: 3, accounts: [], data: [2, ...u32le(1000)] },
      { program: 3, accounts: [], data: [3, ...u64le(2_000_000n)] },
      { program: 2, accounts: [0, 1], data: [...u32le(2), ...u64le(1_500_000_000n)] },
    ]);
    expect(a.instructions[2]).toEqual({ kind: 'solTransfer', from: wallet.address, to: other, lamports: '1500000000' });
    expect(a.feePayer).toBe(wallet.address);
    // 5000 base + ceil(2_000_000 µ-lamports × 1000 units / 1e6) = 5000 + 2000
    expect(a.feeLamports).toBe(7000n);
    expect(a.warnings).toEqual([]);
    expect(a.unknownPrograms).toEqual([]);
  });

  it('flags handing over a token account, an unlimited delegate and a close to someone else', () => {
    const tokenAcc = pk(30);
    const a = analyze([wallet.address, tokenAcc, other, TOKEN_PROGRAM], [1, 0, 2], [
      { program: 3, accounts: [1, 0], data: [6, 2, 1, ...keyBytes(other)] },
      { program: 3, accounts: [1, 2, 0], data: [4, ...u64le((1n << 64n) - 1n)] },
      { program: 3, accounts: [1, 2, 0], data: [9] },
    ]);
    expect(a.warnings.map((w) => [w.code, w.severity])).toEqual([
      ['GIVES_TOKEN_AUTHORITY', 'critical'], ['TOKEN_DELEGATE', 'critical'], ['CLOSES_TO_OTHER', 'warning'],
    ]);
  });

  it('flags assigning the wallet to another program and a durable nonce', () => {
    const a = analyze([wallet.address, pk(40), SYSTEM_PROGRAM], [1, 0, 1], [
      { program: 2, accounts: [1, 0, 0], data: [...u32le(4)] },
      { program: 2, accounts: [0], data: [...u32le(1), ...keyBytes(pk(41))] },
    ]);
    expect(a.warnings.map((w) => w.code)).toEqual(['DURABLE_NONCE', 'ASSIGNS_WALLET']);
  });

  it('names unknown programs and reads associated-token creation', () => {
    const prog = pk(50);
    const a = analyze([wallet.address, pk(51), other, pk(52), ASSOCIATED_TOKEN_PROGRAM, prog], [1, 0, 2], [
      { program: 4, accounts: [0, 1, 2, 3], data: [1] },
      { program: 5, accounts: [0], data: [7, 7] },
    ]);
    expect(a.instructions[0]).toEqual({ kind: 'createTokenAccount', payer: wallet.address, account: pk(51), owner: other, mint: pk(52) });
    expect(a.unknownPrograms).toEqual([prog]);
  });

  it('does not flag the wallet acting on its own behalf', () => {
    const tokenAcc = pk(30);
    const a = analyze([wallet.address, tokenAcc, TOKEN_PROGRAM], [1, 0, 1], [
      { program: 2, accounts: [1, 0], data: [6, 2, 1, ...keyBytes(wallet.address)] },
      { program: 2, accounts: [1, 0, 0], data: [9] },
    ]);
    expect(a.warnings).toEqual([]);
  });
});

