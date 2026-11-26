// Compressed (Bubblegum V1) and Metaplex Core transfers, checked against the layouts of the
// official generated clients: data bytes, accounts in order and their roles, placeholders.
import { describe, expect, it } from 'vitest';
import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { deriveSolanaKeypairFromMnemonic } from './solanaKeyManager';
import { decodeSolanaTransaction } from './solanaTxWire';
import { base58Decode, base58Encode } from './solanaBase58';
import { singleSignerTransaction } from './solanaTokenTransfer';
import { COMPUTE_BUDGET_PROGRAM_ID, SYSTEM_PROGRAM_ID } from './solanaTransaction';
import {
  BUBBLEGUM_PROGRAM_ID,
  MPL_CORE_PROGRAM_ID,
  SPL_ACCOUNT_COMPRESSION_PROGRAM_ID,
  SPL_NOOP_PROGRAM_ID,
  buildCompressedTransferMessage,
  buildCoreTransferMessage,
  estimateAssetTransferFee,
  treeConfigAddress,
} from './solanaAssetTransfer';
import type { SolanaCompressedTransferInputs } from './solanaAssets';

// Fixed test vectors — never used to hold funds.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FROM = deriveSolanaKeypairFromMnemonic(MNEMONIC, 0).address;
const TO = deriveSolanaKeypairFromMnemonic(MNEMONIC, 1).address;
const DELEGATE = deriveSolanaKeypairFromMnemonic(MNEMONIC, 2).address;
const TREE = 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB';
const ASSET = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN';
const COLL = 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So';
const BLOCKHASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const h = (fill: number) => base58Encode(new Uint8Array(32).fill(fill));

const leaf = (fields: Partial<SolanaCompressedTransferInputs> = {}): SolanaCompressedTransferInputs => ({
  kind: 'compressed', id: ASSET, owner: FROM, delegate: FROM, frozen: false, tree: TREE, treeVersion: 1,
  root: h(1), dataHash: h(2), creatorHash: h(3), nonce: 4097n, index: 4097, proof: [h(10), h(11), h(12)], ...fields,
});

function decoded(message: Uint8Array) {
  const { message: m } = decodeSolanaTransaction(singleSignerTransaction(message));
  const writable = (i: number) => (i < m.numRequiredSignatures ? true : i < m.staticKeys.length - m.numReadonlyUnsigned);
  return m.instructions.map((ix) => ({
    program: m.staticKeys[ix.programIdIndex],
    accounts: ix.accountIndexes.map((i) => [m.staticKeys[i], writable(i), i < m.numRequiredSignatures] as [string, boolean, boolean]),
    data: Array.from(ix.data),
  }));
}

describe('Bubblegum transfer', () => {
  it('derives the tree config from the tree alone', async () => {
    const [pda] = await getProgramDerivedAddress({ programAddress: address(BUBBLEGUM_PROGRAM_ID), seeds: [getAddressEncoder().encode(address(TREE))] });
    expect(treeConfigAddress(TREE)).toBe(pda);
  });

  it('names the accounts in the program order, then the proof, with the leaf data', () => {
    const [ix] = decoded(buildCompressedTransferMessage({ from: FROM, recipient: TO, recentBlockhash: BLOCKHASH, leaf: leaf() }));
    expect(ix.program).toBe(BUBBLEGUM_PROGRAM_ID);
    expect(ix.accounts).toEqual([
      [treeConfigAddress(TREE), false, false], // treeConfig
      [FROM, true, true], // leafOwner (the fee payer: writable signer in the message)
      [FROM, true, true], // leafDelegate = owner
      [TO, false, false], // newLeafOwner
      [TREE, true, false], // merkleTree
      [SPL_NOOP_PROGRAM_ID, false, false],
      [SPL_ACCOUNT_COMPRESSION_PROGRAM_ID, false, false],
      [SYSTEM_PROGRAM_ID, false, false],
      [h(10), false, false], [h(11), false, false], [h(12), false, false], // proof, read-only
    ]);
    const nonce = [0x01, 0x10, 0, 0, 0, 0, 0, 0]; // 4097 u64 LE
    const index = [0x01, 0x10, 0, 0]; // 4097 u32 LE
    expect(ix.data).toEqual([
      163, 52, 200, 231, 140, 3, 69, 186,
      ...base58Decode(h(1)), ...base58Decode(h(2)), ...base58Decode(h(3)), ...nonce, ...index,
    ]);
  });

  it('names a delegate apart from the owner', () => {
    const [ix] = decoded(buildCompressedTransferMessage({ from: FROM, recipient: TO, recentBlockhash: BLOCKHASH, leaf: leaf({ delegate: DELEGATE }) }));
    expect(ix.accounts[2]).toEqual([DELEGATE, false, false]);
  });

  it('refuses a V2 tree and a transfer to the sender', () => {
    expect(() => buildCompressedTransferMessage({ from: FROM, recipient: TO, recentBlockhash: BLOCKHASH, leaf: leaf({ treeVersion: 2 }) })).toThrow();
    expect(() => buildCompressedTransferMessage({ from: FROM, recipient: FROM, recentBlockhash: BLOCKHASH, leaf: leaf() })).toThrow();
  });
});

describe('Core TransferV1', () => {
  it.each([[COLL], [null]])('names asset, collection (%s), payer, authority, new owner and the placeholders', (collection) => {
    const ixs = decoded(buildCoreTransferMessage({ from: FROM, recipient: TO, recentBlockhash: BLOCKHASH, asset: ASSET, collection, computeUnitPriceMicroLamports: 1n }));
    expect(ixs.map((ix) => ix.program)).toEqual([COMPUTE_BUDGET_PROGRAM_ID, COMPUTE_BUDGET_PROGRAM_ID, MPL_CORE_PROGRAM_ID]);
    const ix = ixs[2];
    expect(ix.accounts).toEqual([
      [ASSET, true, false], // asset
      [collection ?? MPL_CORE_PROGRAM_ID, false, false], // collection (or none)
      [FROM, true, true], // payer
      [FROM, true, true], // authority
      [TO, false, false], // newOwner
      [MPL_CORE_PROGRAM_ID, false, false], // systemProgram: none
      [MPL_CORE_PROGRAM_ID, false, false], // logWrapper: none
    ]);
    expect(ix.data).toEqual([14, 0]); // TransferV1, compressionProof None
  });

  it('prices the fee on the limit each kind asks for', () => {
    expect(estimateAssetTransferFee('compressed', 0n)).toBe(5000n);
    expect(estimateAssetTransferFee('compressed', 10_000n)).toBe(5000n + 2000n);
    expect(estimateAssetTransferFee('core', 10_000n)).toBe(5000n + 600n);
  });
});
