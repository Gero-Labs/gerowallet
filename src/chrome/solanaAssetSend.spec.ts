// Sending a compressed or Core NFT: what the worker reads, what it refuses, the simulated bound.
import { describe, expect, it, vi } from 'vitest';
import { deriveSolanaKeypairFromMnemonic } from '@/chains/solana/solanaKeyManager';
import type { SolanaRemoteAccount, SolanaRemoteSimulation } from '@/chains/solana/solanaNexusAccounts';
import { decodeSolanaTransaction } from '@/chains/solana/solanaTxWire';
import { singleSignerTransaction } from '@/chains/solana/solanaTokenTransfer';
import { SYSTEM_PROGRAM_ID } from '@/chains/solana/solanaTransaction';
import { base58Encode } from '@/chains/solana/solanaBase58';
import { BUBBLEGUM_PROGRAM_ID, MPL_CORE_PROGRAM_ID } from '@/chains/solana/solanaAssetTransfer';
import type { SolanaAssetTransferInputs } from '@/chains/solana/solanaAssets';
import type { SolanaNft } from '@/chains/solana/solanaNfts';
import { heldSolanaAsset, planSolanaAssetSend } from './solanaAssetSend';

// Fixed test vectors — never used to hold funds.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FROM = deriveSolanaKeypairFromMnemonic(MNEMONIC, 0).address;
const TO = deriveSolanaKeypairFromMnemonic(MNEMONIC, 1).address;
const ASSET = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const TREE = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const PDA = 'GMrwFHibMxDtx4aPznekZ7RoJLZGzzLGRSWeNTf3XV2'; // off-curve
const BLOCKHASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const h = (fill: number) => base58Encode(new Uint8Array(32).fill(fill));

const held = (kind: 'compressed' | 'core'): SolanaNft => ({
  mint: ASSET, kind, standard: null, name: 'A', symbol: null, image: null, animationUrl: null, description: null, externalUrl: null,
  collection: null, ruleSet: null, attributes: [], sellerFeeBasisPoints: null, offChain: true, fetchedAt: 0,
});
const leaf = (fields: Record<string, unknown> = {}): SolanaAssetTransferInputs => ({
  kind: 'compressed', id: ASSET, owner: FROM, delegate: FROM, frozen: false, tree: TREE, treeVersion: 1,
  root: h(1), dataHash: h(2), creatorHash: h(3), nonce: 7n, index: 7, proof: [h(10), h(11)], ...fields,
} as SolanaAssetTransferInputs);
const system = (address: string, lamports = 1_000_000_000n): SolanaRemoteAccount =>
  ({ address, exists: true, lamports, owner: SYSTEM_PROGRAM_ID, program: 'system', parsed: null });
const missing = (address: string): SolanaRemoteAccount => ({ address, exists: false, lamports: null, owner: null, program: null, parsed: null });

function api(inputs: SolanaAssetTransferInputs, opts: { recipient?: SolanaRemoteAccount; senderLamports?: bigint; success?: boolean; spent?: bigint } = {}) {
  const sender = system(FROM, opts.senderLamports ?? 1_000_000_000n);
  return {
    getFees: vi.fn(async () => ({ baseFeeLamportsPerSignature: 5000, slotsSampled: 1, prioritizationFeeMicroLamports: { min: 0, median: 0, p75: 0, p90: 0, max: 0 } })),
    getChainTip: vi.fn(async () => ({ slot: 1, blockHeight: 1, blockhash: BLOCKHASH })),
    getAccounts: vi.fn(async (addresses: string[]) => addresses.map((a) => (a === FROM ? sender : a === TO ? opts.recipient ?? missing(TO) : missing(a)))),
    getAssetTransfer: vi.fn(async () => inputs),
    simulate: vi.fn(async (): Promise<SolanaRemoteSimulation> => (opts.success === false
      ? { success: false, err: 'x', logs: [], unitsConsumed: 1, before: [], after: null }
      : { success: true, err: null, logs: [], unitsConsumed: 1, before: [sender], after: [{ ...sender, lamports: (sender.lamports ?? 0n) - (opts.spent ?? 5000n) }] })),
  };
}

const request = { mint: ASSET, recipientAddress: TO, amount: '1', feeLevel: 'standard' };
const plan = (kind: 'compressed' | 'core', inputs: SolanaAssetTransferInputs, opts: Parameters<typeof api>[1] = {}, r: Record<string, unknown> = request) =>
  planSolanaAssetSend({ publicKey: FROM }, r, held(kind), api(inputs, opts));

describe('sending a compressed or Core NFT', () => {
  it('finds only an asset the worker itself lists for the account', () => {
    expect(heldSolanaAsset(request, [held('compressed')])?.mint).toBe(ASSET);
    expect(heldSolanaAsset(request, [])).toBeNull();
    expect(heldSolanaAsset({ ...request, mint: TREE }, [held('core')])).toBeNull();
  });

  it('moves a compressed NFT through Bubblegum with the fresh proof, for the fee only', async () => {
    const p = await plan('compressed', leaf());
    expect(p).toMatchObject({ amount: 1n, received: 1n, recipient: TO, rentLamports: 0n, feeLamports: 5000n, programmable: false });
    const m = decodeSolanaTransaction(singleSignerTransaction(p.message)).message;
    expect(m.staticKeys).toEqual(expect.arrayContaining([BUBBLEGUM_PROGRAM_ID, TREE, h(10), h(11)]));
  });

  it('moves a Core asset with its collection', async () => {
    const p = await plan('core', { kind: 'core', id: ASSET, owner: FROM, frozen: false, collection: PDA });
    expect(decodeSolanaTransaction(singleSignerTransaction(p.message)).message.staticKeys).toEqual(expect.arrayContaining([MPL_CORE_PROGRAM_ID, PDA, ASSET]));
  });

  it.each([
    ['another owner', leaf({ owner: TO }), 'TOKEN_UNKNOWN'],
    ['a frozen asset', leaf({ frozen: true }), 'TOKEN_FROZEN'],
    ['a V2 tree', leaf({ treeVersion: 2 }), 'TOKEN_NOT_TRANSFERABLE'],
    ['a proof too long for one transaction', leaf({ proof: Array.from({ length: 30 }, (_, i) => h(20 + i)) }), 'TOKEN_NOT_TRANSFERABLE'],
  ])('refuses %s', async (_, inputs, code) => {
    await expect(plan('compressed', inputs)).rejects.toMatchObject({ code });
  });

  it('refuses a kind that changed, a recipient that is not a wallet, and an amount other than one', async () => {
    await expect(plan('core', leaf())).rejects.toMatchObject({ code: 'TOKEN_UNKNOWN' });
    await expect(plan('compressed', leaf(), {}, { ...request, recipientAddress: PDA })).rejects.toMatchObject({ code: 'RECIPIENT_NOT_WALLET' });
    const program = { ...system(TO), owner: BUBBLEGUM_PROGRAM_ID };
    await expect(plan('compressed', leaf(), { recipient: program })).rejects.toMatchObject({ code: 'RECIPIENT_NOT_WALLET' });
    await expect(plan('compressed', leaf(), {}, { ...request, amount: '2' })).rejects.toMatchObject({ code: 'INVALID_AMOUNT' });
    await expect(plan('compressed', leaf(), {}, { ...request, recipientAddress: FROM })).rejects.toMatchObject({ code: 'SAME_ADDRESS' });
  });

  it('refuses what the simulation would not send, or that costs more than the fee', async () => {
    await expect(plan('compressed', leaf(), { success: false })).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
    await expect(plan('compressed', leaf(), { success: false, senderLamports: 100n })).rejects.toMatchObject({ code: 'INSUFFICIENT_SOL' });
    await expect(plan('compressed', leaf(), { spent: 5001n })).rejects.toMatchObject({ code: 'SIMULATION_FAILED' });
    await expect(plan('compressed', leaf(), {}, { ...request, maxSolCost: '4999' })).rejects.toMatchObject({ code: 'COST_CHANGED' });
  });

  it('says LOOKUP_FAILED when Nexus cannot answer', async () => {
    const a = api(leaf());
    a.getAssetTransfer.mockRejectedValueOnce(new Error('503'));
    await expect(planSolanaAssetSend({ publicKey: FROM }, request, held('compressed'), a)).rejects.toMatchObject({ code: 'LOOKUP_FAILED' });
  });
});
