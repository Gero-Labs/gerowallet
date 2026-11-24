// Programmable NFT transfers: Token Metadata TransferV1, checked against the layout of
// mpl-token-metadata's generated `transferV1` (data bytes, the 17 accounts in order, their
// roles, and the program id standing in for an absent optional account).
import { describe, expect, it } from 'vitest';
import { address, getAddressEncoder, getProgramDerivedAddress } from '@solana/kit';
import { deriveSolanaKeypairFromMnemonic } from './solanaKeyManager';
import { decodeSolanaTransaction } from './solanaTxWire';
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_PROGRAM_ID, associatedTokenAddress, singleSignerTransaction } from './solanaTokenTransfer';
import { COMPUTE_BUDGET_PROGRAM_ID, SYSTEM_PROGRAM_ID } from './solanaTransaction';
import {
  AUTHORIZATION_RULES_PROGRAM_ID,
  PNFT_TRANSFER_COMPUTE_UNITS,
  SYSVAR_INSTRUCTIONS_ID,
  TOKEN_METADATA_PROGRAM_ID,
  buildPnftTransferMessage,
  editionAddress,
  estimatePnftTransferFee,
  metadataAddress,
  tokenRecordAddress,
} from './solanaPnftTransfer';

// Fixed test vectors — never used to hold funds.
const MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const FROM = deriveSolanaKeypairFromMnemonic(MNEMONIC, 0).address;
const TO = deriveSolanaKeypairFromMnemonic(MNEMONIC, 1).address;
const MINT = 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263';
const RULE_SET = 'eBJLFYPxJmMGKuFwpDWkzxZeUrad92kZRC5BJLpzyT9';
const BLOCKHASH = 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG';
const SOURCE = associatedTokenAddress(FROM, MINT, TOKEN_PROGRAM_ID);
const DEST = associatedTokenAddress(TO, MINT, TOKEN_PROGRAM_ID);

const enc = getAddressEncoder();
const META = address(TOKEN_METADATA_PROGRAM_ID);
const pda = async (...seeds: Array<string | ArrayLike<number>>) =>
  (await getProgramDerivedAddress({ programAddress: META, seeds: seeds.map((s) => (typeof s === 'string' ? s : Uint8Array.from(s))) }))[0] as string;

function decoded(message: Uint8Array) {
  const { message: m } = decodeSolanaTransaction(singleSignerTransaction(message));
  const writable = (i: number) => (i < m.numRequiredSignatures
    ? i < m.numRequiredSignatures - m.numReadonlySigned
    : i < m.staticKeys.length - m.numReadonlyUnsigned);
  return {
    keys: m.staticKeys,
    instructions: m.instructions.map((ix) => ({
      program: m.staticKeys[ix.programIdIndex],
      accounts: ix.accountIndexes.map((i) => ({ address: m.staticKeys[i], writable: writable(i), signer: i < m.numRequiredSignatures })),
      data: Array.from(ix.data),
    })),
  };
}

describe('Token Metadata addresses', () => {
  it('derives metadata, edition and token records with the program seeds', async () => {
    const mint = enc.encode(address(MINT));
    expect(metadataAddress(MINT)).toBe(await pda('metadata', enc.encode(META), mint));
    expect(editionAddress(MINT)).toBe(await pda('metadata', enc.encode(META), mint, 'edition'));
    expect(tokenRecordAddress(MINT, SOURCE)).toBe(await pda('metadata', enc.encode(META), mint, 'token_record', enc.encode(address(SOURCE))));
  });
});

describe('TransferV1', () => {
  const params = { from: FROM, source: SOURCE, destination: DEST, recipient: TO, mint: MINT, recentBlockhash: BLOCKHASH };

  /** The accounts in mpl-token-metadata's order: [address, writable, signer]. */
  const expected = (ruleSet: string | null): Array<[string, boolean, boolean]> => [
    [SOURCE, true, false], // token
    [FROM, true, true], // tokenOwner (also the payer: writable signer in the message)
    [DEST, true, false], // destinationToken
    [TO, false, false], // destinationOwner
    [MINT, false, false], // mint
    [metadataAddress(MINT), true, false], // metadata
    [editionAddress(MINT), false, false], // edition
    [tokenRecordAddress(MINT, SOURCE), true, false], // tokenRecord
    [tokenRecordAddress(MINT, DEST), true, false], // destinationTokenRecord
    [FROM, true, true], // authority
    [FROM, true, true], // payer
    [SYSTEM_PROGRAM_ID, false, false],
    [SYSVAR_INSTRUCTIONS_ID, false, false],
    [TOKEN_PROGRAM_ID, false, false],
    [ASSOCIATED_TOKEN_PROGRAM_ID, false, false],
    [ruleSet ? AUTHORIZATION_RULES_PROGRAM_ID : TOKEN_METADATA_PROGRAM_ID, false, false], // authorizationRulesProgram
    [ruleSet ?? TOKEN_METADATA_PROGRAM_ID, false, false], // authorizationRules
  ];

  it.each([[null], [RULE_SET]])('names every account in order, with its role (rule set %s)', (ruleSet) => {
    const { instructions } = decoded(buildPnftTransferMessage({ ...params, ruleSet }));
    expect(instructions).toHaveLength(1);
    const [ix] = instructions;
    expect(ix.program).toBe(TOKEN_METADATA_PROGRAM_ID);
    expect(ix.accounts.map((a) => [a.address, a.writable, a.signer])).toEqual(expected(ruleSet));
    // Transfer (49), V1 (0), amount 1 (u64 LE), authorization data None.
    expect(ix.data).toEqual([49, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it('sets the compute limit and price first when there is a priority price', () => {
    const { instructions, keys } = decoded(buildPnftTransferMessage({ ...params, computeUnitPriceMicroLamports: 20_000n }));
    expect(instructions.map((ix) => ix.program)).toEqual([COMPUTE_BUDGET_PROGRAM_ID, COMPUTE_BUDGET_PROGRAM_ID, TOKEN_METADATA_PROGRAM_ID]);
    expect(instructions[0].data).toEqual([2, ...new Uint8Array(new Uint32Array([PNFT_TRANSFER_COMPUTE_UNITS]).buffer)]);
    expect(keys[0]).toBe(FROM);
    expect(estimatePnftTransferFee(20_000n)).toBe(5000n + 8000n);
    expect(estimatePnftTransferFee(0n)).toBe(5000n);
  });

  it('refuses a transfer to the sender or between the same account', () => {
    expect(() => buildPnftTransferMessage({ ...params, recipient: FROM })).toThrow();
    expect(() => buildPnftTransferMessage({ ...params, destination: SOURCE })).toThrow();
    expect(() => buildPnftTransferMessage({ ...params, recentBlockhash: 'short' })).toThrow();
  });

  it('fits in one transaction', () => {
    const tx = singleSignerTransaction(buildPnftTransferMessage({ ...params, ruleSet: RULE_SET, computeUnitPriceMicroLamports: 1n }));
    expect(tx.length).toBeLessThanOrEqual(1232);
  });
});
