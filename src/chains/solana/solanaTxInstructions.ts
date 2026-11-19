// What a dApp transaction's instructions say, for the programs a wallet meets most: System,
// Compute Budget, SPL Token / Token-2022, Associated Token and Memo. Pure and static: it reads
// the instruction bytes only. What the transaction actually does to the wallet's balances comes
// from the simulation (solanaTxPreview.ts); this adds the intent the simulation cannot show,
// such as handing over an authority, and the fee.
import type { SolanaResolvedKey, SolanaWireMessage } from './solanaTxWire';
import { base58Encode } from './solanaBase58';

export const SYSTEM_PROGRAM = '11111111111111111111111111111111';
export const COMPUTE_BUDGET_PROGRAM = 'ComputeBudget111111111111111111111111111111';
export const TOKEN_PROGRAM = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
export const TOKEN_2022_PROGRAM = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSOCIATED_TOKEN_PROGRAM = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
export const MEMO_PROGRAM = 'MemoSq4gqABAXKb96qnH8TysNcWxMyWCqXgDLGmfcHr';
export const MEMO_V1_PROGRAM = 'Memo1UhkJRfHyvLMcVucJwxXeuD728EqVDDwQDxFMNo';

/** Programs the preview names; any other is listed as a program the wallet cannot read. */
export const KNOWN_PROGRAMS: Readonly<Record<string, string>> = {
  [SYSTEM_PROGRAM]: 'System',
  [COMPUTE_BUDGET_PROGRAM]: 'Compute Budget',
  [TOKEN_PROGRAM]: 'Token',
  [TOKEN_2022_PROGRAM]: 'Token-2022',
  [ASSOCIATED_TOKEN_PROGRAM]: 'Associated Token',
  [MEMO_PROGRAM]: 'Memo',
  [MEMO_V1_PROGRAM]: 'Memo',
};

/** The base fee per signature, in lamports (a protocol constant). */
export const LAMPORTS_PER_SIGNATURE = 5000n;
const DEFAULT_UNITS_PER_INSTRUCTION = 200_000n;
const MAX_COMPUTE_UNITS = 1_400_000n;
const U64_MAX = (1n << 64n) - 1n;

/**
 * Static findings. `critical` ones hand over control of the wallet's account or tokens and need
 * the user's explicit acknowledgement before signing; `warning` ones are shown prominently.
 */
export type SolanaStaticWarning =
  | { code: 'ASSIGNS_WALLET'; severity: 'critical'; program: string }
  | { code: 'GIVES_TOKEN_AUTHORITY'; severity: 'critical'; account: string; newAuthority: string | null }
  | { code: 'NONCE_AUTHORITY'; severity: 'critical'; nonceAccount: string; newAuthority: string }
  | { code: 'TOKEN_DELEGATE'; severity: 'critical' | 'warning'; account: string; delegate: string; amount: string; unlimited: boolean }
  | { code: 'CLOSES_TO_OTHER'; severity: 'warning'; account: string; destination: string }
  | { code: 'DURABLE_NONCE'; severity: 'warning'; nonceAccount: string };

export type SolanaInstructionSummary =
  | { kind: 'solTransfer'; from: string; to: string; lamports: string }
  | { kind: 'createAccount'; from: string; account: string; lamports: string; owner: string }
  | { kind: 'tokenTransfer'; source: string; destination: string; authority: string; amount: string; mint?: string; decimals?: number }
  | { kind: 'tokenApprove'; source: string; delegate: string; owner: string; amount: string }
  | { kind: 'tokenRevoke'; source: string; owner: string }
  | { kind: 'tokenSetAuthority'; account: string; current: string; newAuthority: string | null; authorityType: number }
  | { kind: 'tokenClose'; account: string; destination: string; owner: string }
  | { kind: 'tokenBurn'; account: string; owner: string; amount: string }
  | { kind: 'createTokenAccount'; payer: string; account: string; owner: string; mint: string }
  | { kind: 'computeBudget' }
  | { kind: 'memo'; text: string }
  | { kind: 'other'; program: string; known: boolean };

export interface SolanaStaticAnalysis {
  instructions: SolanaInstructionSummary[];
  warnings: SolanaStaticWarning[];
  /** Programs called, in order of first use. */
  programs: string[];
  unknownPrograms: string[];
  /** The fee payer (account 0). */
  feePayer: string;
  /** Base plus priority fee in lamports, as the instructions set it. */
  feeLamports: bigint;
}

const u32 = (data: Uint8Array, at: number): number | null =>
  at + 4 <= data.length ? new DataView(data.buffer, data.byteOffset + at, 4).getUint32(0, true) : null;
const u64 = (data: Uint8Array, at: number): bigint | null =>
  at + 8 <= data.length ? new DataView(data.buffer, data.byteOffset + at, 8).getBigUint64(0, true) : null;
const key = (data: Uint8Array, at: number): string | null =>
  at + 32 <= data.length ? base58Encode(data.slice(at, at + 32)) : null;

/** Reads the instructions of `message` against its resolved accounts, from `wallet`'s side. */
export function analyzeSolanaInstructions(message: SolanaWireMessage, keys: readonly SolanaResolvedKey[], wallet: string): SolanaStaticAnalysis {
  const instructions: SolanaInstructionSummary[] = [];
  const warnings: SolanaStaticWarning[] = [];
  const programs: string[] = [];
  let unitLimit: bigint | null = null;
  let unitPrice = 0n;
  let nonBudget = 0n;

  message.instructions.forEach((ix, position) => {
    const program = keys[ix.programIdIndex].address;
    if (!programs.includes(program)) programs.push(program);
    const acc = (i: number) => keys[ix.accountIndexes[i]]?.address ?? '';
    const data = ix.data;
    if (program !== COMPUTE_BUDGET_PROGRAM) nonBudget += 1n;

    if (program === COMPUTE_BUDGET_PROGRAM) {
      if (data[0] === 2) unitLimit = BigInt(u32(data, 1) ?? 0);
      if (data[0] === 3) unitPrice = u64(data, 1) ?? 0n;
      instructions.push({ kind: 'computeBudget' });
      return;
    }

    if (program === SYSTEM_PROGRAM) {
      const tag = u32(data, 0);
      if (tag === 2) {
        instructions.push({ kind: 'solTransfer', from: acc(0), to: acc(1), lamports: (u64(data, 4) ?? 0n).toString() });
      } else if (tag === 0) {
        instructions.push({ kind: 'createAccount', from: acc(0), account: acc(1), lamports: (u64(data, 4) ?? 0n).toString(), owner: key(data, 20) ?? '' });
      } else if (tag === 11) {
        instructions.push({ kind: 'solTransfer', from: acc(0), to: acc(2), lamports: (u64(data, 4) ?? 0n).toString() });
      } else if (tag === 1) {
        const owner = key(data, 4) ?? '';
        if (acc(0) === wallet && owner !== SYSTEM_PROGRAM) warnings.push({ code: 'ASSIGNS_WALLET', severity: 'critical', program: owner });
        instructions.push({ kind: 'other', program, known: true });
      } else if (tag === 4) {
        // AdvanceNonceAccount first: the transaction never expires.
        if (position === 0) warnings.push({ code: 'DURABLE_NONCE', severity: 'warning', nonceAccount: acc(0) });
        instructions.push({ kind: 'other', program, known: true });
      } else if (tag === 7) {
        const newAuthority = key(data, 4) ?? '';
        if (acc(1) === wallet && newAuthority !== wallet) {
          warnings.push({ code: 'NONCE_AUTHORITY', severity: 'critical', nonceAccount: acc(0), newAuthority });
        }
        instructions.push({ kind: 'other', program, known: true });
      } else {
        instructions.push({ kind: 'other', program, known: true });
      }
      return;
    }

    if (program === TOKEN_PROGRAM || program === TOKEN_2022_PROGRAM) {
      const tag = data[0];
      if (tag === 3 || tag === 12) {
        const checked = tag === 12;
        instructions.push({
          kind: 'tokenTransfer',
          source: acc(0),
          destination: checked ? acc(2) : acc(1),
          authority: checked ? acc(3) : acc(2),
          amount: (u64(data, 1) ?? 0n).toString(),
          ...(checked ? { mint: acc(1), decimals: data[9] } : {}),
        });
      } else if (tag === 4 || tag === 13) {
        const checked = tag === 13;
        const owner = checked ? acc(3) : acc(2);
        const delegate = checked ? acc(2) : acc(1);
        const amount = u64(data, 1) ?? 0n;
        if (owner === wallet && delegate !== wallet) {
          const unlimited = amount === U64_MAX;
          warnings.push({ code: 'TOKEN_DELEGATE', severity: unlimited ? 'critical' : 'warning', account: acc(0), delegate, amount: amount.toString(), unlimited });
        }
        instructions.push({ kind: 'tokenApprove', source: acc(0), delegate, owner, amount: amount.toString() });
      } else if (tag === 5) {
        instructions.push({ kind: 'tokenRevoke', source: acc(0), owner: acc(1) });
      } else if (tag === 6) {
        const authorityType = data[1] ?? 0;
        const newAuthority = data[2] === 1 ? key(data, 3) : null;
        if (acc(1) === wallet && newAuthority !== wallet) {
          warnings.push({ code: 'GIVES_TOKEN_AUTHORITY', severity: 'critical', account: acc(0), newAuthority });
        }
        instructions.push({ kind: 'tokenSetAuthority', account: acc(0), current: acc(1), newAuthority, authorityType });
      } else if (tag === 9) {
        if (acc(2) === wallet && acc(1) !== wallet) {
          warnings.push({ code: 'CLOSES_TO_OTHER', severity: 'warning', account: acc(0), destination: acc(1) });
        }
        instructions.push({ kind: 'tokenClose', account: acc(0), destination: acc(1), owner: acc(2) });
      } else if (tag === 8 || tag === 15) {
        instructions.push({ kind: 'tokenBurn', account: acc(0), owner: acc(2), amount: (u64(data, 1) ?? 0n).toString() });
      } else {
        instructions.push({ kind: 'other', program, known: true });
      }
      return;
    }

    if (program === ASSOCIATED_TOKEN_PROGRAM && (data.length === 0 || data[0] === 0 || data[0] === 1)) {
      instructions.push({ kind: 'createTokenAccount', payer: acc(0), account: acc(1), owner: acc(2), mint: acc(3) });
      return;
    }

    if (program === MEMO_PROGRAM || program === MEMO_V1_PROGRAM) {
      let text = '';
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(data);
      } catch { /* a memo that is not text is shown as unreadable */ }
      instructions.push({ kind: 'memo', text });
      return;
    }

    instructions.push({ kind: 'other', program, known: program in KNOWN_PROGRAMS });
  });

  const limit = unitLimit ?? (nonBudget * DEFAULT_UNITS_PER_INSTRUCTION > MAX_COMPUTE_UNITS ? MAX_COMPUTE_UNITS : nonBudget * DEFAULT_UNITS_PER_INSTRUCTION);
  const priority = (unitPrice * limit + 999_999n) / 1_000_000n;
  const feeLamports = LAMPORTS_PER_SIGNATURE * BigInt(message.numRequiredSignatures) + priority;
  return {
    instructions,
    warnings,
    programs,
    unknownPrograms: programs.filter((p) => !(p in KNOWN_PROGRAMS)),
    feePayer: keys[0].address,
    feeLamports,
  };
}
