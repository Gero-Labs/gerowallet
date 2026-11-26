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
import { tokenAccountInfo, type SolanaRemoteAccount, type SolanaRemoteSimulation } from '@/chains/solana/solanaNexusAccounts';
import { parseRawAmount } from '@/chains/solana/solanaAmount';
import { SYSTEM_PROGRAM_ID } from '@/chains/solana/solanaTransaction';
import {
  TOKEN_PROGRAMS,
  TOKEN_PROGRAM_ID,
  associatedTokenAddress,
  buildTokenTransferMessage,
  estimateTokenTransferFee,
  singleSignerTransaction,
} from '@/chains/solana/solanaTokenTransfer';
import { priorityPriceFor } from '@/chains/solana/solanaSendRules';
import { bytesToBase64 } from '@/chrome/solanaDappTx';
import type { SolanaNft } from '@/chains/solana/solanaNfts';
import {
  TOKEN_METADATA_PROGRAM_ID,
  buildPnftTransferMessage,
  estimatePnftTransferFee,
  tokenRecordAddress,
} from '@/chains/solana/solanaPnftTransfer';

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
  | 'LOOKUP_FAILED'
  | 'COST_CHANGED';

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
  /**
   * Limits from the review the user approved (decimal strings, optional): the plan is refused if it
   * would cost more SOL (fee plus deposit) or deliver less than that review showed. They can only
   * narrow what is sent, never widen it.
   */
  maxSolCost?: unknown;
  minReceived?: unknown;
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
  /** Lamports the new accounts hold (rent), paid by the sender; 0 without one. */
  rentLamports: bigint;
  feeLamports: bigint;
  /** A programmable NFT, moved by Token Metadata (solanaPnftTransfer.ts). */
  programmable: boolean;
  /** Rent returned to the sender (a programmable NFT's closed token record); 0 otherwise. */
  refundLamports: bigint;
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
  programmable: boolean;
  refundLamports: string;
}

/** Trezor shows the recipient's wallet for a token account it names (display only). */
export interface SolanaTokenAccountInfo {
  baseAddress: string;
  tokenProgram: string;
  tokenMint: string;
  tokenAccount: string;
}

export type SolanaTokenSendApi = Pick<SolanaApi, 'getFees' | 'getChainTip' | 'getAccounts' | 'simulate'>
  & Partial<Pick<SolanaApi, 'getNftMetadata' | 'getAssetTransfer'>>;

/**
 * Rent of a plain token account (165 bytes): used only to tell "not enough SOL" from other
 * failures when the simulation refuses the transfer. The real figure comes from the simulation.
 */
const TOKEN_ACCOUNT_RENT_ESTIMATE = 2_039_280n;
/**
 * The most a new associated token account's deposit can be: a Token-2022 account carrying every
 * account extension a mint can require stays well under 400 bytes. A simulated deposit above it,
 * or below a plain account's, is not believed (the review would show a wrong cost).
 *
 * Both bounds follow from today's rent parameters (3480 lamports per byte-year, 2 years). If the
 * network ever changed them, every send that opens an account would fail closed here with
 * SIMULATION_FAILED: update TOKEN_ACCOUNT_RENT_ESTIMATE and this cap together.
 */
const TOKEN_ACCOUNT_RENT_MAX = 4_000_000n;

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

  // A programmable NFT moves through Token Metadata, never a plain transfer (its account is frozen).
  const nft = decimals === 0 ? await readNft(api, mint) : null;
  if (nft && nft.standard && PROGRAMMABLE.includes(nft.standard)) {
    return planPnftSend({
      from, mint, amount, source, mintAccount, sourceAccount, recipientInput, recipientAccount, senderAccount,
      ruleSet: nft.ruleSet, feeLevel, request, api,
    });
  }

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
    // A token account owned by a program address (a vault) is refused like such a recipient.
    if (!isOnCurveSolanaAddress(pasted.owner)) throw new SolanaTokenSendError('RECIPIENT_NOT_WALLET');
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
  if (!simulation.success || !simulation.after || simulation.after.length < 3) {
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
  if (createsAccount && (rentLamports < TOKEN_ACCOUNT_RENT_ESTIMATE || rentLamports > TOKEN_ACCOUNT_RENT_MAX)) {
    throw new SolanaTokenSendError('SIMULATION_FAILED');
  }

  senderPaysAtMost(simulation, senderAccount, feeLamports + rentLamports);
  holdToReview(request, feeLamports + rentLamports, received);

  return {
    message, mint, tokenProgram, decimals, amount, received, recipient, destination, createsAccount, rentLamports, feeLamports,
    programmable: false, refundLamports: 0n,
  };
}

/**
 * The sender's SOL as simulated: it may drop by at most `bound` (the fee and the deposits the
 * review shows), so the reviewed cost is a simulated limit, not only an estimate. Returns the drop
 * (negative when the sender gains, e.g. a refund larger than what it paid). Whether the simulated
 * state already has the fee taken off does not matter: the bound includes it.
 */
export function senderPaysAtMost(simulation: SolanaRemoteSimulation, senderAccount: SolanaRemoteAccount, bound: bigint): bigint {
  const before = simulation.before[0]?.lamports ?? senderAccount.lamports;
  const after = simulation.after?.[0]?.lamports;
  if (before === null || before === undefined || after === null || after === undefined) throw new SolanaTokenSendError('SIMULATION_FAILED');
  const spent = before - after;
  if (spent > bound) throw new SolanaTokenSendError('SIMULATION_FAILED');
  return spent;
}

/** The limits from the review the user approved: never more SOL, never less received. */
export function holdToReview(request: SolanaTokenSendRequest, solCost: bigint, received: bigint): void {
  const { maxSolCost, minReceived } = request;
  if (maxSolCost !== undefined) {
    if (typeof maxSolCost !== 'string' || !/^\d+$/.test(maxSolCost)) throw new SolanaTokenSendError('INVALID_REQUEST');
    if (solCost > BigInt(maxSolCost)) throw new SolanaTokenSendError('COST_CHANGED');
  }
  if (minReceived !== undefined) {
    if (typeof minReceived !== 'string' || !/^\d+$/.test(minReceived)) throw new SolanaTokenSendError('INVALID_REQUEST');
    if (received < BigInt(minReceived)) throw new SolanaTokenSendError('COST_CHANGED');
  }
}

const PROGRAMMABLE: readonly string[] = ['programmableNonFungible', 'programmableNonFungibleEdition'];

/**
 * The NFT's standard and rule set per Nexus. Unreadable reads as "not programmable": the plain
 * transfer then refuses a programmable NFT's frozen account itself, so nothing is lost.
 */
async function readNft(api: SolanaTokenSendApi, mint: string): Promise<SolanaNft | null> {
  if (!api.getNftMetadata) return null;
  try {
    const [row] = await api.getNftMetadata([mint]);
    return row || null;
  } catch {
    return null;
  }
}

/** A created account's rent as simulated: within what such an account can cost, or not believed. */
function createdRent(after: SolanaRemoteAccount | null | undefined): bigint {
  const lamports = after?.lamports ?? 0n;
  if (lamports < CREATED_ACCOUNT_RENT_MIN || lamports > TOKEN_ACCOUNT_RENT_MAX) throw new SolanaTokenSendError('SIMULATION_FAILED');
  return lamports;
}

/** The rent of the smallest account the runtime accepts (0 data bytes). */
const CREATED_ACCOUNT_RENT_MIN = 890_880n;
/** A token record's rent (80 bytes), only to tell "not enough SOL" from other failures. */
const TOKEN_RECORD_RENT_ESTIMATE = 1_447_680n;

interface PnftContext {
  from: string;
  mint: string;
  amount: bigint;
  source: string;
  mintAccount: SolanaRemoteAccount;
  sourceAccount: SolanaRemoteAccount;
  recipientInput: string;
  recipientAccount: SolanaRemoteAccount;
  senderAccount: SolanaRemoteAccount;
  ruleSet: string | null;
  feeLevel: 'standard' | 'fast';
  request: SolanaTokenSendRequest;
  api: SolanaTokenSendApi;
}

/**
 * A programmable NFT: Token Metadata TransferV1 from the sender's associated account to the
 * recipient's (opened by the program when missing), with both token records and the rule set.
 * Only to a wallet; the simulation must show exactly the one NFT moving.
 */
async function planPnftSend(ctx: PnftContext): Promise<SolanaTokenPlan> {
  const { from, mint, source, api } = ctx;
  if (ctx.amount !== 1n) throw new SolanaTokenSendError('INVALID_AMOUNT');
  // Programmable NFTs are SPL Token mints held in the owner's associated account.
  if (ctx.mintAccount.owner !== TOKEN_PROGRAM_ID) throw new SolanaTokenSendError('TOKEN_NOT_TRANSFERABLE');
  if (source !== associatedTokenAddress(from, mint, TOKEN_PROGRAM_ID)) throw new SolanaTokenSendError('TOKEN_UNKNOWN');
  const src = tokenAccount(ctx.sourceAccount, TOKEN_PROGRAM_ID);
  if (!src || src.mint !== mint || src.owner !== from) throw new SolanaTokenSendError('TOKEN_UNKNOWN');
  if (src.amount < 1n) throw new SolanaTokenSendError('TOKEN_BALANCE');
  if (ctx.ruleSet !== null && !isValidSolanaAddress(ctx.ruleSet)) throw new SolanaTokenSendError('LOOKUP_FAILED');

  const plainWallet = !ctx.recipientAccount.exists || ctx.recipientAccount.owner === SYSTEM_PROGRAM_ID;
  if (!plainWallet || !isOnCurveSolanaAddress(ctx.recipientInput)) throw new SolanaTokenSendError('RECIPIENT_NOT_WALLET');
  const recipient = ctx.recipientInput;
  const destination = associatedTokenAddress(recipient, mint, TOKEN_PROGRAM_ID);
  const ownerRecord = tokenRecordAddress(mint, source);
  const destinationRecord = tokenRecordAddress(mint, destination);
  const [destinationAccount, ownerRecordAccount, destinationRecordAccount] = await readAccounts(api, [destination, ownerRecord, destinationRecord]);
  let destinationBefore = 0n;
  if (destinationAccount.exists) {
    const dst = tokenAccount(destinationAccount, TOKEN_PROGRAM_ID);
    if (!dst || dst.mint !== mint || dst.owner !== recipient) throw new SolanaTokenSendError('RECIPIENT_WRONG_TOKEN');
    destinationBefore = dst.amount;
  }
  if (!ownerRecordAccount.exists || ownerRecordAccount.owner !== TOKEN_METADATA_PROGRAM_ID) throw new SolanaTokenSendError('TOKEN_UNKNOWN');

  const fees = await api.getFees().catch(() => undefined);
  const priority = priorityPriceFor(ctx.feeLevel, fees?.prioritizationFeeMicroLamports);
  let message: Uint8Array;
  try {
    const tip = await api.getChainTip();
    message = buildPnftTransferMessage({
      from, source, destination, recipient, mint, ruleSet: ctx.ruleSet, recentBlockhash: tip.blockhash,
      computeUnitPriceMicroLamports: priority,
    });
  } catch {
    throw new SolanaTokenSendError('LOOKUP_FAILED');
  }
  const feeLamports = estimatePnftTransferFee(priority);

  let simulation;
  try {
    simulation = await api.simulate(bytesToBase64(singleSignerTransaction(message)), [from, source, destination, ownerRecord, destinationRecord]);
  } catch {
    throw new SolanaTokenSendError('LOOKUP_FAILED');
  }
  if (!simulation.success || !simulation.after || simulation.after.length < 5) {
    const needed = feeLamports
      + (destinationAccount.exists ? 0n : TOKEN_ACCOUNT_RENT_ESTIMATE)
      + (destinationRecordAccount.exists ? 0n : TOKEN_RECORD_RENT_ESTIMATE);
    if (ctx.senderAccount.lamports === null || ctx.senderAccount.lamports < needed) throw new SolanaTokenSendError('INSUFFICIENT_SOL');
    throw new SolanaTokenSendError('SIMULATION_FAILED');
  }
  // Exactly the one NFT leaves the sender's account and arrives in the recipient's.
  const srcAfter = tokenAccount(simulation.after[1], TOKEN_PROGRAM_ID);
  const dstAfter = tokenAccount(simulation.after[2], TOKEN_PROGRAM_ID);
  if (!srcAfter || srcAfter.amount !== src.amount - 1n || !dstAfter || dstAfter.mint !== mint || dstAfter.owner !== recipient
    || dstAfter.amount !== destinationBefore + 1n) {
    throw new SolanaTokenSendError('SIMULATION_FAILED');
  }
  const createsAccount = !destinationAccount.exists;
  const rentLamports = (createsAccount ? createdRent(simulation.after[2]) : 0n)
    + (destinationRecordAccount.exists ? 0n : createdRent(simulation.after[4]));
  // The sender's token record is closed; its rent returns to the payer (the sender).
  const ownerRecordAfter = simulation.after[3];
  const recordRent = !ownerRecordAfter.exists || (ownerRecordAfter.lamports ?? 0n) === 0n ? ownerRecordAccount.lamports ?? 0n : 0n;
  const spent = senderPaysAtMost(simulation, ctx.senderAccount, feeLamports + rentLamports);
  // Shown as returned only when the simulated SOL shows it came back to the sender.
  const refundLamports = recordRent > 0n && spent <= feeLamports + rentLamports - recordRent ? recordRent : 0n;

  holdToReview(ctx.request, feeLamports + rentLamports, 1n);
  return {
    message, mint, tokenProgram: TOKEN_PROGRAM_ID, decimals: 0, amount: 1n, received: 1n, recipient, destination, createsAccount,
    rentLamports, feeLamports, programmable: true, refundLamports,
  };
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
    programmable: plan.programmable,
    refundLamports: plan.refundLamports.toString(),
  };
}

export function solanaTokenAccountInfos(plan: SolanaTokenPlan): SolanaTokenAccountInfo[] {
  // A compressed or Core NFT names no token account.
  if (!plan.tokenProgram) return [];
  return [{ baseAddress: plan.recipient, tokenProgram: plan.tokenProgram, tokenMint: plan.mint, tokenAccount: plan.destination }];
}
