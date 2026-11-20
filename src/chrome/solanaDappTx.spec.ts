// The worker's handling of a dApp's Solana transaction: decode, lookup tables, simulation,
// preview, and the check that the panel's signed result changed nothing but the wallet's slot.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { base58Decode, base58Encode } from '@/chains/solana/solanaBase58';
import { buildSolTransferMessage, compactU16, signSolanaBytes } from '@/chains/solana/solanaTransaction';
import { deriveSolanaKeypairFromMnemonic } from '@/chains/solana/solanaKeyManager';
import { decodeSolanaTransaction, withSolanaSignature } from '@/chains/solana/solanaTxWire';
import { SYSTEM_PROGRAM } from '@/chains/solana/solanaTxInstructions';
import type { SolanaRemoteAccount } from '@/chains/solana/solanaNexusAccounts';
import { SolanaDappTxError, isSignedByWalletOnly, prepareSolanaDappTransaction, solanaMessageKey } from './solanaDappTx';
import {
  SOLANA_TX_ALLOWANCE_TTL_MS,
  clearSolanaTxAllowancesForTests,
  grantSolanaTxAllowance,
  hasSolanaTxAllowance,
  releaseSolanaTxAllowance,
} from './solanaTxAllowance';

const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const wallet = deriveSolanaKeypairFromMnemonic(MNEMONIC, 0);
const other = deriveSolanaKeypairFromMnemonic(MNEMONIC, 1);
const pk = (n: number) => base58Encode(new Uint8Array(32).fill(n));
const BLOCKHASH = pk(9);
const cat = (...parts: Array<Uint8Array | number[]>) => {
  const out: number[] = [];
  parts.forEach((p) => out.push(...p));
  return new Uint8Array(out);
};
const unsigned = (message: Uint8Array, signers = 1) => cat(compactU16(signers), new Array(64 * signers).fill(0), message);
const sol = (address: string, lamports: bigint): SolanaRemoteAccount => ({ address, exists: true, lamports, owner: SYSTEM_PROGRAM, program: null, parsed: null });

function api(overrides: Partial<{ getAccounts: () => Promise<SolanaRemoteAccount[]>; simulate: () => Promise<unknown> }> = {}) {
  return {
    getAccounts: vi.fn(overrides.getAccounts ?? (async () => [])),
    simulate: vi.fn(overrides.simulate ?? (async (_tx: string, accounts: string[]) => ({
      success: true, err: null, logs: [], unitsConsumed: 150,
      before: accounts.map((a, i) => sol(a, i === 0 ? 10_000_000n : 0n)),
      after: accounts.map((a, i) => sol(a, i === 0 ? 8_995_000n : 1_000_000n)),
    }))),
  };
}

const transfer = () => unsigned(buildSolTransferMessage({ from: wallet.address, to: other.address, lamports: 1_000_000n, recentBlockhash: BLOCKHASH }));

describe('prepareSolanaDappTransaction', () => {
  it('previews a transfer from the wallet with the simulated balance change and the fee', async () => {
    const nexus = api();
    const prepared = await prepareSolanaDappTransaction(transfer(), wallet.address, nexus as never);
    expect(prepared.signerIndex).toBe(0);
    expect(prepared.preview).toMatchObject({ simulated: true, solChange: '-1005000', feePayerIsWallet: true, requiresAcknowledgement: false });
    expect(prepared.messageKey).toBe(solanaMessageKey(prepared.tx.messageBytes));
    // The wallet first, then the transaction's other writable account; the bytes as sent.
    expect(nexus.simulate).toHaveBeenCalledWith(expect.any(String), [wallet.address, other.address]);
    expect(nexus.getAccounts).not.toHaveBeenCalled();
  });

  it('refuses a transaction the connected account does not sign, and one it cannot read', async () => {
    const theirs = unsigned(buildSolTransferMessage({ from: other.address, to: pk(5), lamports: 1n, recentBlockhash: BLOCKHASH }));
    await expect(prepareSolanaDappTransaction(theirs, wallet.address, api() as never)).rejects.toMatchObject({ reason: 'NOT_SIGNER' });
    await expect(prepareSolanaDappTransaction(cat(transfer(), [0]), wallet.address, api() as never)).rejects.toBeInstanceOf(SolanaDappTxError);
  });

  it('resolves a v0 transaction’s lookup table through Nexus, and refuses one it cannot read', async () => {
    const table = pk(7);
    const msg = cat([0x80, 1, 0, 1], compactU16(2), base58Decode(wallet.address), base58Decode(SYSTEM_PROGRAM), base58Decode(BLOCKHASH),
      compactU16(1), [1], compactU16(2), [0, 2], compactU16(12), [2, 0, 0, 0, 64, 66, 15, 0, 0, 0, 0, 0],
      compactU16(1), base58Decode(table), compactU16(1), [0], compactU16(0), []);
    const tableAccount: SolanaRemoteAccount = {
      address: table, exists: true, lamports: 1n, owner: 'AddressLookupTab1e1111111111111111111111111', program: 'address-lookup-table',
      parsed: { type: 'lookupTable', info: { addresses: [other.address] } },
    };
    const nexus = api({ getAccounts: async () => [tableAccount] });
    const prepared = await prepareSolanaDappTransaction(unsigned(msg), wallet.address, nexus as never);
    expect(nexus.getAccounts).toHaveBeenCalledWith([table]);
    expect(nexus.simulate).toHaveBeenCalledWith(expect.any(String), [wallet.address, other.address]);
    expect(prepared.preview.programs).toEqual([{ address: SYSTEM_PROGRAM, name: 'System' }]);

    const notATable = api({ getAccounts: async () => [{ ...tableAccount, owner: SYSTEM_PROGRAM }] });
    await expect(prepareSolanaDappTransaction(unsigned(msg), wallet.address, notATable as never)).rejects.toMatchObject({ reason: 'LOOKUP_UNAVAILABLE' });
  });

  it('still previews, with a warning, when Nexus cannot simulate', async () => {
    const prepared = await prepareSolanaDappTransaction(transfer(), wallet.address, api({ simulate: async () => { throw new Error('down'); } }) as never);
    expect(prepared.preview.simulated).toBe(false);
    expect(prepared.preview.warnings.map((w) => w.code)).toEqual(['SIMULATION_UNAVAILABLE']);
  });
});

describe('isSignedByWalletOnly', () => {
  const prepare = () => {
    const bytes = transfer();
    return { bytes, tx: decodeSolanaTransaction(bytes), signerIndex: 0 };
  };

  it('accepts the transaction with only the wallet’s valid signature added', () => {
    const p = prepare();
    const signed = withSolanaSignature(p.bytes, p.tx, 0, signSolanaBytes(p.tx.messageBytes, wallet.secretKey));
    expect(isSignedByWalletOnly(p, signed, wallet.address)).toBe(true);
  });

  it('refuses another key’s signature, a changed message, or garbage', () => {
    const p = prepare();
    expect(isSignedByWalletOnly(p, withSolanaSignature(p.bytes, p.tx, 0, signSolanaBytes(p.tx.messageBytes, other.secretKey)), wallet.address)).toBe(false);
    const changed = unsigned(buildSolTransferMessage({ from: wallet.address, to: other.address, lamports: 2n, recentBlockhash: BLOCKHASH }));
    const changedTx = decodeSolanaTransaction(changed);
    expect(isSignedByWalletOnly(p, withSolanaSignature(changed, changedTx, 0, signSolanaBytes(changedTx.messageBytes, wallet.secretKey)), wallet.address)).toBe(false);
    expect(isSignedByWalletOnly(p, new Uint8Array([1, 2, 3]), wallet.address)).toBe(false);
  });

  it('refuses a change to another signer’s slot', () => {
    const msg = buildSolTransferMessage({ from: wallet.address, to: other.address, lamports: 1n, recentBlockhash: BLOCKHASH });
    // Two signers (the wallet and the recipient's key): the recipient's slot must not change.
    const twoSlots = cat(compactU16(2), new Array(128).fill(0), [2], msg.slice(1));
    const tx = decodeSolanaTransaction(twoSlots);
    const p = { tx, signerIndex: 0 };
    const signed = withSolanaSignature(twoSlots, tx, 0, signSolanaBytes(tx.messageBytes, wallet.secretKey));
    const tampered = withSolanaSignature(signed, tx, 1, new Uint8Array(64).fill(1));
    expect(isSignedByWalletOnly(p, tampered, wallet.address)).toBe(false);
  });
});

describe('solana transaction allowance', () => {
  beforeEach(() => clearSolanaTxAllowancesForTests());

  it('holds while its prompt is open, for that wallet only, until it expires', () => {
    grantSolanaTxAllowance(1, 'k', 0);
    expect(hasSolanaTxAllowance(2, 'k', 1)).toBe(false);
    // Checking spends nothing: a wrong password can be retried.
    expect(hasSolanaTxAllowance(1, 'k', 1)).toBe(true);
    expect(hasSolanaTxAllowance(1, 'k', 2)).toBe(true);
    expect(hasSolanaTxAllowance(1, 'k', SOLANA_TX_ALLOWANCE_TTL_MS)).toBe(false);
    releaseSolanaTxAllowance(1, 'k');
    expect(hasSolanaTxAllowance(1, 'k', 1)).toBe(false);
  });

  it('counts prompts: the same bytes sent twice keep the second prompt’s allowance when the first settles', () => {
    grantSolanaTxAllowance(1, 'k', 0);
    grantSolanaTxAllowance(1, 'k', 0);
    releaseSolanaTxAllowance(1, 'k');
    expect(hasSolanaTxAllowance(1, 'k', 1)).toBe(true);
    releaseSolanaTxAllowance(1, 'k');
    expect(hasSolanaTxAllowance(1, 'k', 1)).toBe(false);
  });
});
