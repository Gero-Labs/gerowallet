/**
 * Gero's own SPL token send, planned in the worker. The page names only the token (its mint),
 * the recipient, the amount in raw units and a fee level; everything that decides the bytes is
 * read here:
 *
 * - the source token account comes from the worker's own Gero Sync holdings, and Nexus must
 *   confirm it is the wallet's, of that mint, not frozen and holding the amount;
 * - the mint is read on chain: its program (Token or Token-2022) and decimals, and the
 *   Token-2022 extensions that make a plain transfer impossible (non-transferable, a transfer
 *   hook, paused) are refused up front;
 * - the recipient must be a wallet (an on-curve key, unused or owned by the System program),
 *   whose associated token account is used or opened in the same transaction, or a token
 *   account of this very mint;
 * - the exact message is simulated through Nexus. A transfer the network would reject is
 *   refused before anyone signs, and the simulated balances must show the amount leaving the
 *   source and arriving (less any Token-2022 transfer fee) at the destination.
 */
import type { SolanaApi } from '@/api/solana-api';
import { isOnCurveSolanaAddress, isValidSolanaAddress } from '@/chains/solana/solanaKeyManager';
import { tokenAccountInfo, type SolanaRemoteAccount } from '@/chains/solana/solanaNexusAccounts';
import { parseRawAmount } from '@/chains/solana/solanaAmount';
import { SYSTEM_PROGRAM_ID } from '@/chains/solana/solanaTransaction';
import {
  TOKEN_PROGRAMS,
  associatedTokenAddress,
  buildTokenTransferMessage,
  estimateTokenTransferFee,
  singleSignerTransaction,
} from '@/chains/solana/solanaTokenTransfer';
import { priorityPriceFor } from '@/chains/solana/solanaSendRules';
import { bytesToBase64 } from '@/chrome/solanaDappTx';

export type SolanaTokenSendRefusal =
  | 'INVALID_REQUEST'
  | 'INVALID_ADDRESS'
  | 'SAME_ADDRESS'
  | 'INVALID_AMOUNT'
  | 'TOKEN_UNKNOWN'
  | 'TOKEN_BALANCE'
  | 'TOKEN_FROZEN'
  | 'TOKEN_NOT_TRANSFERABLE'
  | 'RECIPIENT_NOT_WALLET'
  | 'RECIPIENT_WRONG_TOKEN'
  | 'INSUFFICIENT_SOL'
  | 'SIMULATION_FAILED'
  | 'LOOKUP_FAILED';

export class SolanaTokenSendError extends Error {
  constructor(readonly code: SolanaTokenSendRefusal) {
    super(code);
  }
}

/** A token the worker holds per Gero Sync (walletStore.solana.tokens). */
export interface SolanaHolding {
  mint: string;
  amount: string | bigint;
  decimals: number;
  tokenAccount?: string;
  programId?: string;
}

export interface SolanaTokenSendRequest {
  mint?: unknown;
  recipientAddress?: unknown;
  /** Raw units, decimal string. */
  amount?: unknown;
  feeLevel?: unknown;
}

export interface SolanaTokenPlan {
  message: Uint8Array;
  mint: string;
  tokenProgram: string;
  decimals: number;
  amount: bigint;
  /** What the destination receives: the amount less any Token-2022 transfer fee. */
  received: bigint;
  /** The recipient's wallet (the destination token account's owner). */
  recipient: string;
  destination: string;
  createsAccount: boolean;
  /** Lamports the new token account holds (rent), paid by the sender; 0 without one. */
  rentLamports: bigint;
  feeLamports: bigint;
}

/** What the page shows for a plan (decimal strings; never the message itself). */
export interface SolanaTokenQuote {
  mint: string;
  decimals: number;
  amount: string;
  received: string;
  createsAccount: boolean;
  rentLamports: string;
  feeLamports: string;
}

/** Trezor shows the recipient's wallet for a token account it names (display only). */
export interface SolanaTokenAccountInfo {
  baseAddress: string;
  tokenProgram: string;
  tokenMint: string;
  tokenAccount: string;
}

export type SolanaTokenSendApi = Pick<SolanaApi, 'getFees' | 'getChainTip' | 'getAccounts' | 'simulate'>;

/**
 * Rent of a plain token account (165 bytes): used only to tell "not enough SOL" from other
 * failures when the simulation refuses the transfer. The real figure comes from the simulation.
 */
const TOKEN_ACCOUNT_RENT_ESTIMATE = 2_039_280n;

/** Token-2022 extensions under which a plain TransferChecked cannot succeed. */
function blockingExtension(mint: SolanaRemoteAccount): boolean {
  const info = mint.parsed?.info as Record<string, unknown> | undefined;
  const extensions = Array.isArray(info?.['extensions']) ? info['extensions'] as Array<Record<string, unknown>> : [];
  return extensions.some((ext) => {
    const name = ext?.['extension'];
    const state = (ext?.['state'] ?? {}) as Record<string, unknown>;
    if (name === 'nonTransferable') return true;
    if (name === 'transferHook') return isValidSolanaAddress(state['programId']);
    if (name === 'pausableConfig') return state['paused'] === true;
    return false;
  });
}

function mintDecimals(mint: SolanaRemoteAccount): number | null {
  if (!mint.exists || !mint.owner || !TOKEN_PROGRAMS.includes(mint.owner) || mint.parsed?.type !== 'mint') return null;
  const decimals = (mint.parsed.info as Record<string, unknown> | undefined)?.['decimals'];
  return typeof decimals === 'number' && Number.isInteger(decimals) && decimals >= 0 && decimals <= 255 ? decimals : null;
}

function isFrozen(account: SolanaRemoteAccount): boolean {
  return (account.parsed?.info as Record<string, unknown> | undefined)?.['state'] === 'frozen';
}

/** The account as a token account of `tokenProgram`, or null. */
function tokenAccount(account: SolanaRemoteAccount, tokenProgram: string) {
  return account.owner === tokenProgram ? tokenAccountInfo(account) : null;
}

async function readAccounts(api: SolanaTokenSendApi, addresses: string[]): Promise<SolanaRemoteAccount[]> {
  try {
    return await api.getAccounts(addresses);
  } catch {
    throw new SolanaTokenSendError('LOOKUP_FAILED');
  }
}

/** Every check, the message, its simulation. Throws SolanaTokenSendError with the first refusal. */
export async function planSolanaTokenSend(
  sender: { publicKey: string },
  request: SolanaTokenSendRequest,
  holdings: readonly SolanaHolding[] | null | undefined,
  api: SolanaTokenSendApi,
): Promise<SolanaTokenPlan> {
  const from = sender.publicKey;
  const { mint, recipientAddress: recipientInput, amount: rawAmount, feeLevel } = request;
  if (typeof mint !== 'string' || !isValidSolanaAddress(mint)) throw new SolanaTokenSendError('INVALID_REQUEST');
  if (typeof rawAmount !== 'string' || !/^\d+$/.test(rawAmount)) throw new SolanaTokenSendError('INVALID_REQUEST');
  if (feeLevel !== 'standard' && feeLevel !== 'fast') throw new SolanaTokenSendError('INVALID_REQUEST');
  if (typeof recipientInput !== 'string' || !isValidSolanaAddress(recipientInput)) throw new SolanaTokenSendError('INVALID_ADDRESS');
  if (recipientInput === from) throw new SolanaTokenSendError('SAME_ADDRESS');
  let amount: bigint;
  try {
    amount = parseRawAmount(rawAmount);
  } catch {
    throw new SolanaTokenSendError('INVALID_AMOUNT');
  }
  if (amount <= 0n) throw new SolanaTokenSendError('INVALID_AMOUNT');

  // The source: the wallet's own holding of this mint that covers the amount (the largest).
  // A row without its token account is the wallet's associated account under its program.
  const accountOf = (row: SolanaHolding): string | null => {
    if (isValidSolanaAddress(row.tokenAccount ?? '')) return row.tokenAccount as string;
    return row.programId && TOKEN_PROGRAMS.includes(row.programId) ? associatedTokenAddress(from, mint, row.programId) : null;
  };
  const held = (row: SolanaHolding) => {
    try {
      return parseRawAmount(typeof row.amount === 'bigint' ? row.amount : String(row.amount));
    } catch {
      return 0n;
    }
  };
  const rows = (holdings ?? []).filter((row) => row.mint === mint && accountOf(row));
  if (!rows.length) throw new SolanaTokenSendError('TOKEN_UNKNOWN');
  const source = accountOf(rows.reduce((a, b) => (held(b) > held(a) ? b : a))) as string;

  const [mintAccount, sourceAccount, recipientAccount, senderAccount] = await readAccounts(api, [mint, source, recipientInput, from]);
  const decimals = mintDecimals(mintAccount);
  if (decimals === null) throw new SolanaTokenSendError('TOKEN_UNKNOWN');
  const tokenProgram = mintAccount.owner as string;
  if (blockingExtension(mintAccount)) throw new SolanaTokenSendError('TOKEN_NOT_TRANSFERABLE');

  const src = tokenAccount(sourceAccount, tokenProgram);
  if (!src || src.mint !== mint || src.owner !== from) throw new SolanaTokenSendError('TOKEN_UNKNOWN');
  if (isFrozen(sourceAccount)) throw new SolanaTokenSendError('TOKEN_FROZEN');
  if (src.amount < amount) throw new SolanaTokenSendError('TOKEN_BALANCE');

  // The destination: a token account of this mint the user pasted, or the recipient's ATA.
  let recipient: string;
  let destination: string;
  let destinationAccount: SolanaRemoteAccount;
  const pasted = recipientAccount.exists && recipientAccount.owner && TOKEN_PROGRAMS.includes(recipientAccount.owner)
    ? tokenAccountInfo(recipientAccount) : null;
  if (pasted) {
    if (pasted.mint !== mint || recipientAccount.owner !== tokenProgram) throw new SolanaTokenSendError('RECIPIENT_WRONG_TOKEN');
    if (pasted.owner === from) throw new SolanaTokenSendError('SAME_ADDRESS');
    recipient = pasted.owner;
    destination = recipientInput;
    destinationAccount = recipientAccount;
  } else {
    // A wallet: a key someone holds, unused or a plain System account. Anything else (a program,
    // a vault, another program's account) could leave the tokens where nobody can move them.
    const plainWallet = !recipientAccount.exists || recipientAccount.owner === SYSTEM_PROGRAM_ID;
    if (!plainWallet || !isOnCurveSolanaAddress(recipientInput)) throw new SolanaTokenSendError('RECIPIENT_NOT_WALLET');
    recipient = recipientInput;
    destination = associatedTokenAddress(recipient, mint, tokenProgram);
    [destinationAccount] = await readAccounts(api, [destination]);
  }
  if (destination === source) throw new SolanaTokenSendError('SAME_ADDRESS');
  const createsAccount = !destinationAccount.exists;
  let destinationBefore = 0n;
  if (!createsAccount) {
    const dst = tokenAccount(destinationAccount, tokenProgram);
    if (!dst || dst.mint !== mint || dst.owner !== recipient) throw new SolanaTokenSendError('RECIPIENT_WRONG_TOKEN');
    if (isFrozen(destinationAccount)) throw new SolanaTokenSendError('TOKEN_FROZEN');
    destinationBefore = dst.amount;
  }

  const fees = await api.getFees().catch(() => undefined);
  const priority = priorityPriceFor(feeLevel, fees?.prioritizationFeeMicroLamports);
  let message: Uint8Array;
  try {
    const tip = await api.getChainTip();
    message = buildTokenTransferMessage({
      from, source, destination, mint, tokenProgram, amount, decimals, recentBlockhash: tip.blockhash,
      computeUnitPriceMicroLamports: priority, ...(createsAccount ? { createDestinationFor: recipient } : {}),
    });
  } catch {
    throw new SolanaTokenSendError('LOOKUP_FAILED');
  }
  const feeLamports = estimateTokenTransferFee(priority, createsAccount);

  let simulation;
  try {
    simulation = await api.simulate(bytesToBase64(singleSignerTransaction(message)), [from, source, destination]);
  } catch {
    throw new SolanaTokenSendError('LOOKUP_FAILED');
  }
  if (!simulation.success || !simulation.after) {
    const needed = feeLamports + (createsAccount ? TOKEN_ACCOUNT_RENT_ESTIMATE : 0n);
    if (senderAccount.lamports === null || senderAccount.lamports < needed) throw new SolanaTokenSendError('INSUFFICIENT_SOL');
    throw new SolanaTokenSendError('SIMULATION_FAILED');
  }
  // The simulated balances must show exactly this transfer.
  const srcAfter = tokenAccount(simulation.after[1], tokenProgram);
  const dstAfter = tokenAccount(simulation.after[2], tokenProgram);
  if (!srcAfter || !dstAfter || srcAfter.amount !== src.amount - amount || dstAfter.mint !== mint || dstAfter.owner !== recipient) {
    throw new SolanaTokenSendError('SIMULATION_FAILED');
  }
  const received = dstAfter.amount - destinationBefore;
  if (received <= 0n || received > amount) throw new SolanaTokenSendError('SIMULATION_FAILED');
  const rentLamports = createsAccount ? simulation.after[2].lamports ?? 0n : 0n;

  return { message, mint, tokenProgram, decimals, amount, received, recipient, destination, createsAccount, rentLamports, feeLamports };
}

export function solanaTokenQuote(plan: SolanaTokenPlan): SolanaTokenQuote {
  return {
    mint: plan.mint,
    decimals: plan.decimals,
    amount: plan.amount.toString(),
    received: plan.received.toString(),
    createsAccount: plan.createsAccount,
    rentLamports: plan.rentLamports.toString(),
    feeLamports: plan.feeLamports.toString(),
  };
}

export function solanaTokenAccountInfos(plan: SolanaTokenPlan): SolanaTokenAccountInfo[] {
  return [{ baseAddress: plan.recipient, tokenProgram: plan.tokenProgram, tokenMint: plan.mint, tokenAccount: plan.destination }];
}
